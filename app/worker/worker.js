/**
 * Hidden worker window — the app's "engine room".
 *
 * It runs the very same pipeline code the browser extension ran in its
 * offscreen document + service worker:
 *   fetch public viewer → auto-extract static key → WASM decrypt .binz →
 *   (textures: descramble / ORM pack) → osgjs→GLB → ZIP → file on disk.
 *
 * It also serves the two preview stages for the 3D panel:
 *   stage "mesh"     – GLB without textures (fast, ~1 s after decrypt)
 *   stage "textures" – GLB rebuilt with ≤1K texture maps
 */
import "../shim.js";

import {
  extractUid,
  fetchViewerInfo,
  fetchAnimations,
  fetchTextures,
  getDiterB,
  isBinzFormat,
  modelBinzUrls,
  parseViewerMaterials,
  sanitizeName,
  extractStaticKey,
  viewerOrientation,
} from "../lib/sf-api.js";
import { decryptBinzBytes, loadWasmBytes, outNameFor } from "../lib/decrypt.js";
import { convertOsgjsToGlbFromFiles } from "../lib/osgjs2gltf.js";
import { downloadModel, packOrmMaps } from "../lib/pipeline.js";
import { formatSessionLog } from "../lib/devlog.js";

const W = window.sfWorker;

/** Preview textures are capped so the side panel opens fast. */
const PREVIEW_MAX_EDGE = 1024;
/** Keep the last decrypted model so "add textures" doesn't re-download it. */
const coreCache = new Map();

let cancelFlag = false;
let mediaDirCache = "";

function emit(ev) {
  W.event(ev);
}

function progress(id, text) {
  emit({ type: "progress", id, text: String(text == null ? "" : text) });
}

function checkCanceled() {
  if (cancelFlag) {
    const e = new Error("canceled");
    e.canceled = true;
    throw e;
  }
}

async function mediaDir() {
  if (!mediaDirCache) mediaDirCache = await W.mediaDir();
  return mediaDirCache;
}

/* ------------------------------------------------------------------ *
 * Model metadata (for the header card + suggested file name)
 * ------------------------------------------------------------------ */

function metaFromInfo(info, uid) {
  const src = info || {};
  const images = (src.thumbnails && src.thumbnails.images) || [];
  let thumb = "";
  let best = -1;
  for (const im of images) {
    const area = (Number(im.width) || 0) * (Number(im.height) || 0);
    if (area > best) {
      best = area;
      thumb = im.url || "";
    }
  }
  const user = src.user || {};
  const avatars = (user.avatars && user.avatars.images) || [];
  const license = src.license || {};
  return {
    uid,
    name: src.name || uid,
    author: user.displayName || user.username || "unknown",
    avatar: avatars.length ? avatars[avatars.length - 1].url : "",
    thumb,
    vertexCount: Number(src.vertexCount) || 0,
    faceCount: Number(src.faceCount) || 0,
    animationCount: Number(src.animationCount) || 0,
    likeCount: Number(src.likeCount) || 0,
    viewCount: Number(src.viewCount) || 0,
    license: license.label || license.fullname || license.fullName || "",
    licenseRequirements: license.requirements || "",
    publishedAt: src.publishedAt || "",
    description: String(src.description || "").slice(0, 600),
    viewerUrl: src.viewerUrl || `https://sketchfab.com/3d-models/${uid}`,
    downloadType: src.downloadType || "",
    restricted: !!src.isRestricted,
  };
}

async function probeModel(url) {
  const uid = extractUid(url);
  if (!uid) throw new Error("No Sketchfab model id in that link");
  const { info } = await fetchViewerInfo(uid);
  return metaFromInfo(info, uid);
}

/* ------------------------------------------------------------------ *
 * Decrypt core (shared by both preview stages)
 * ------------------------------------------------------------------ */

async function decryptCore(url, id, useCache = true) {
  const uid = extractUid(url);
  if (!uid) throw new Error("No Sketchfab model id in that link");

  if (useCache && coreCache.has(uid)) {
    progress(id, `Reusing decrypted data for ${uid.slice(0, 8)}…`);
    return coreCache.get(uid);
  }

  progress(id, `UID: ${uid}`);
  progress(id, "Reading public viewer…");
  const { info, embedHtml } = await fetchViewerInfo(uid);
  checkCanceled();

  const name = sanitizeName(info.name || uid);
  const author =
    (info.user && (info.user.displayName || info.user.username)) || "unknown";
  progress(id, `Model: ${info.name || name} (by ${author})`);

  const viewerMaterials = parseViewerMaterials(info);
  progress(id, `Viewer materials: ${viewerMaterials.size}`);

  if (!isBinzFormat(info)) {
    throw new Error(
      "This model is not in the current encrypted .binz format (or is private).",
    );
  }

  progress(id, "Extracting decrypt key (auto)…");
  const staticKey = await extractStaticKey(embedHtml, (m) => progress(id, m));
  checkCanceled();

  progress(id, "Loading WASM decrypt module…");
  const wasmBytes = await loadWasmBytes();
  const diterB = getDiterB(info);

  const decrypted = {};
  for (const binzUrl of modelBinzUrls(info)) {
    checkCanceled();
    const binzName = binzUrl.split("/").pop().split("?")[0];
    progress(id, `Downloading ${binzName}…`);
    let enc;
    try {
      enc = await new Uint8Array(
        await (await fetch(binzUrl, { credentials: "omit" })).arrayBuffer(),
      );
    } catch (e) {
      if (binzName.includes("wireframe")) {
        progress(id, `Skip ${binzName} (not available)`);
        continue;
      }
      throw new Error(
        `Download ${binzName} failed: ${e && e.message ? e.message : e}`,
      );
    }
    progress(id, `Decrypting ${binzName} (${enc.length} bytes)…`);
    const plain = await decryptBinzBytes(wasmBytes, enc, diterB, staticKey);
    const outName = outNameFor(binzName);
    decrypted[outName] = plain;
    progress(id, `  → ${outName} (${plain.length} bytes)`);
  }

  if (!decrypted["file.osgjs"] || !decrypted["model_file.bin"]) {
    throw new Error(
      `Missing file.osgjs or model_file.bin after decrypt. Have: ${Object.keys(
        decrypted,
      ).join(", ")}`,
    );
  }

  try {
    Object.assign(
      decrypted,
      await fetchAnimations(info, (m) => progress(id, m)),
    );
  } catch (_) {}

  const core = {
    uid,
    info,
    name,
    author,
    viewerMaterials,
    decrypted,
    orientation: viewerOrientation(info),
  };

  if (useCache) {
    coreCache.set(uid, core);
    while (coreCache.size > 2) {
      coreCache.delete(coreCache.keys().next().value);
    }
  }
  return core;
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

function statsOf(result, core, textureCount) {
  const json = (result && result.json) || {};
  const meshes = Array.isArray(json.meshes) ? json.meshes.length : 0;
  const materials = Array.isArray(json.materials) ? json.materials.length : 0;
  const images = Array.isArray(json.images) ? json.images.length : 0;
  const rig = result && result.rig ? result.rig : null;
  return {
    geometryCount: (result && result.geometryCount) || meshes,
    materials,
    images,
    textures: textureCount || 0,
    animations:
      (rig && rig.animations) || (core.info && core.info.animationCount) || 0,
    bones: (rig && rig.bones) || 0,
    vertices: (core.info && core.info.vertexCount) || 0,
    faces: (core.info && core.info.faceCount) || 0,
    skipped: ((result && result.skippedGeometries) || []).length,
  };
}

async function buildPreviewGlb(core, id, textures) {
  progress(id, "Building preview GLB…");
  const result = await convertOsgjsToGlbFromFiles(
    core.decrypted,
    core.viewerMaterials,
    textures || [],
    core.orientation,
  );
  if (!result || !result.glb || !result.glb.length) {
    throw new Error("GLB conversion returned nothing");
  }
  return result;
}

async function writePreviewFile(core, stage, glb) {
  const file = `preview-${core.uid}-${stage}.glb`;
  const full = W.fs.join(await mediaDir(), file);
  await W.fs.writeFile(full, glb);
  return `app://media/${file}`;
}

async function cmdPreview({ id, url, flags = {} }) {
  cancelFlag = false;
  const wantTextures = flags.textures !== false;
  try {
    emit({ type: "preview-start", id, url });
    const core = await decryptCore(url, id, flags.useCache !== false);

    if (!flags.skipMeta) {
      emit({
        type: "preview-meta",
        id,
        url,
        meta: metaFromInfo(core.info, core.uid),
      });
    }

    // ---- stage 1: mesh only (fast) ----
    let result = await buildPreviewGlb(core, id, []);
    let glbUrl = await writePreviewFile(core, "mesh", result.glb);
    emit({
      type: "preview-glb",
      id,
      stage: "mesh",
      url: glbUrl,
      bytes: result.glb.length,
      stats: statsOf(result, core, 0),
    });

    // ---- stage 2: with textures (optional) ----
    if (wantTextures) {
      checkCanceled();
      progress(id, "Preview textures: fetching (max 1K)…");
      let textures = [];
      try {
        textures = await fetchTextures(core.uid, (m) => progress(id, m), {
          maxEdge: PREVIEW_MAX_EDGE,
          concurrency: 3,
        });
        if (textures.length) {
          textures = await packOrmMaps(
            core.viewerMaterials,
            textures,
            (m) => progress(id, m),
            PREVIEW_MAX_EDGE,
          );
        }
      } catch (e) {
        progress(
          id,
          `Textures unavailable for preview (${e && e.message ? e.message : e}) — mesh preview kept`,
        );
      }
      checkCanceled();
      if (textures.length) {
        const textured = await buildPreviewGlb(core, id, textures);
        glbUrl = await writePreviewFile(core, "tex", textured.glb);
        emit({
          type: "preview-glb",
          id,
          stage: "textures",
          url: glbUrl,
          bytes: textured.glb.length,
          stats: statsOf(textured, core, textures.length),
        });
      } else {
        emit({
          type: "preview-note",
          id,
          text: "No public textures for preview",
        });
      }
    }

    emit({ type: "preview-done", id });
    W.result(id, {
      ok: true,
      uid: core.uid,
      name: core.name,
      author: core.author,
    });
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    if (e && e.canceled) {
      emit({ type: "preview-canceled", id });
      W.result(id, { ok: false, canceled: true });
      return;
    }
    emit({ type: "preview-error", id, error: message });
    W.result(id, { ok: false, error: message });
  }
}

/* ------------------------------------------------------------------ *
 * Download → ZIP file on disk
 * ------------------------------------------------------------------ */

async function cmdDownload({ id, url, targetPath, flags = {} }) {
  if (!targetPath) throw new Error("no target path");
  emit({ type: "download-start", id, url, targetPath });

  const result = await downloadModel(url, (text) => progress(id, text), {
    downloadTextures: flags.textures === true,
    devMode: flags.devMode === true,
    packMode: flags.packMode === "glb" ? "glb" : "full",
    maxTextureEdge:
      flags.maxTextureEdge === 2048 || flags.maxTextureEdge === 4096
        ? flags.maxTextureEdge
        : 0,
    capturedTextures: [],
  });

  const zip =
    result.zip instanceof Uint8Array
      ? result.zip
      : new Uint8Array(result.zip || []);
  if (!zip.length) throw new Error("Pipeline returned an empty ZIP");

  progress(id, `Writing ${result.zipName} (${zip.length} bytes)…`);
  await W.fs.writeFile(targetPath, zip);

  return {
    ok: true,
    path: targetPath,
    bytes: zip.length,
    zipName: result.zipName,
    name: result.name,
    author: result.author,
    hasGlb: !!result.hasGlb,
    fileCount: result.fileCount || 0,
    logText: flags.devMode ? formatSessionLog() : "",
    textureFlag: flags.textures === true,
  };
}

/* ------------------------------------------------------------------ *
 * Command loop
 * ------------------------------------------------------------------ */

W.onCommand(async (cmd) => {
  if (!cmd || !cmd.cmd) return;
  const id = cmd.id || 0;

  if (cmd.cmd === "cancel") {
    cancelFlag = true;
    return;
  }

  try {
    if (cmd.cmd === "probe") {
      W.result(id, { ok: true, meta: await probeModel(cmd.url) });
      return;
    }
    if (cmd.cmd === "preview") {
      await cmdPreview(cmd);
      return;
    }
    if (cmd.cmd === "download") {
      W.result(id, await cmdDownload(cmd));
      return;
    }
    W.result(id, { ok: false, error: `Unknown command: ${cmd.cmd}` });
  } catch (e) {
    W.result(id, {
      ok: false,
      error: e && e.message ? e.message : String(e),
      canceled: !!(e && e.canceled),
    });
  }
});

W.ready();
