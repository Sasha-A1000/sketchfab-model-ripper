/**
 * Desktop UI.
 *
 * The download options, wording, themes and layout mirror the browser
 * extension; on top of that this window adds the link box, the 3D preview
 * panel and the Windows-side options (save dialog, Explorer, folders).
 */
import "../shim.js";

import { t, createLangSwitch, updateLangSwitch } from "../lib/i18n.js";
import {
  loadPrefs,
  savePrefs,
  applyTheme,
  jobFlagsFromPrefs,
} from "../lib/settings.js";
import {
  isJobDirty,
  paintSettingsFlash as paintFlash,
  formatJobStatus,
  bindThemeSwitch,
  bindPillSwitch,
} from "../lib/ui-settings.js";
import { progressFromMessage } from "../lib/ui-progress.js";
import { setDevModeCache, readLastRunLog } from "../lib/devlog.js";
import { extractUid } from "../lib/sf-api.js";
import { createPreview } from "./preview.js";

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */
let lang = "en";
let applied = {
  textures: false,
  theme: "light",
  lang: "en",
  devMode: false,
  packMode: "full",
  maxTextureEdge: 0,
};
let desktop = {};
let pendingTex = false;
let pendingDev = false;
let devMode = false;
let appliedOk = false;
let liveLog = [];
let dlJobId = null;
let pvJobId = null;
let currentMeta = null;
let currentUrl = "";
let jobSeq = 0;
let busy = false;
let bulkRows = [];
const nextJobId = () => `ui-${++jobSeq}`;

/* ------------------------------------------------------------------ *
 * elements
 * ------------------------------------------------------------------ */
const el = {
  title: $("title"),
  tagline: $("tagline"),
  ver: $("ver"),
  plat: $("plat"),
  langSwitch: $("lang-switch"),
  tabDl: $("tab-dl"),
  tabBulk: $("tab-bulk"),
  tabSet: $("tab-set"),
  paneDl: $("pane-dl"),
  paneBulk: $("pane-bulk"),
  paneSet: $("pane-set"),
  urlLabel: $("url-label"),
  urlInput: $("url-input"),
  btnPaste: $("btn-paste"),
  btnClearUrl: $("btn-clear-url"),
  desktopHint: $("desktop-hint"),
  modelCard: $("model-card"),
  modelThumb: $("model-thumb"),
  modelName: $("model-name"),
  modelAuthor: $("model-author"),
  modelStats: $("model-stats"),
  modelLicense: $("model-license"),
  modelDesc: $("model-desc"),
  ready: $("ready"),
  jobStatus: $("job-status"),
  progress: $("progress"),
  progressBar: $("progress-bar"),
  progressLabel: $("progress-label"),
  status: $("status"),
  btnDl: $("btn-dl"),
  btnOpenSite: $("btn-open-site"),
  btnBulk: $("btn-bulk"),
  devPanel: $("dev-panel"),
  devLogTitle: $("dev-log-title"),
  devLog: $("dev-log"),
  btnCopyLog: $("btn-copy-log"),
  btnSaveLog: $("btn-save-log"),
  btnClearLog: $("btn-clear-log"),
  previewCard: $("preview-card"),
  pvTitle: $("pv-title"),
  pvBadge: $("pv-badge"),
  pvTex: $("pv-tex"),
  pvTexLabel: $("pv-tex-label"),
  pvRefresh: $("pv-refresh"),
  pvFull: $("pv-full"),
  pvStage: $("pv-stage"),
  pvCanvas: $("pv-canvas"),
  pvWire: $("pv-wire"),
  pvGrid: $("pv-grid"),
  pvRotate: $("pv-rotate"),
  pvReset: $("pv-reset"),
  pvShot: $("pv-shot"),
  pvOverlay: $("pv-overlay"),
  pvMsg: $("pv-msg"),
  pvStats: $("pv-stats"),
  pvHint: $("pv-hint"),
  bulkLabel: $("bulk-label"),
  bulkLinks: $("bulk-links"),
  bulkFolderLabel: $("bulk-folder-label"),
  bulkFolder: $("bulk-folder"),
  bulkPick: $("bulk-pick"),
  bulkOpen: $("bulk-open"),
  bulkFolderHint: $("bulk-folder-hint"),
  bulkStart: $("bulk-start"),
  bulkStop: $("bulk-stop"),
  bulkSummary: $("bulk-summary"),
  bulkQueueTitle: $("bulk-queue-title"),
  bulkLog: $("bulk-log"),
  winSettingsTitle: $("win-settings-title"),
  saveModeLabel: $("save-mode-label"),
  saveModeSwitch: $("save-mode-switch"),
  saveModeHint: $("save-mode-hint"),
  lastFolderLabel: $("last-folder-label"),
  lastFolder: $("last-folder"),
  btnPickFolder: $("btn-pick-folder"),
  btnOpenFolder: $("btn-open-folder"),
  openFolderToggle: $("open-folder-toggle"),
  openFolderLabel: $("open-folder-label"),
  previewAutoToggle: $("preview-auto-toggle"),
  previewAutoLabel: $("preview-auto-label"),
  previewTexToggle: $("preview-tex-toggle"),
  previewTexLabel: $("preview-tex-label"),
  logsLabel: $("logs-label"),
  logsPath: $("logs-path"),
  logsHint: $("logs-hint"),
  btnOpenLogs: $("btn-open-logs"),
  settingsTitle: $("settings-title"),
  texToggle: $("tex-toggle"),
  texLabel: $("tex-label"),
  texHint: $("tex-hint"),
  devToggle: $("dev-toggle"),
  devLabel: $("dev-label"),
  devHint: $("dev-hint"),
  themeLabel: $("theme-label"),
  themeSwitch: $("theme-switch"),
  packLabel: $("pack-label"),
  packSwitch: $("pack-switch"),
  packHint: $("pack-hint"),
  resLabel: $("res-label"),
  resSwitch: $("res-switch"),
  resHint: $("res-hint"),
  btnSaveSettings: $("btn-save-settings"),
  settingsFlash: $("settings-flash"),
  settingsSaveHint: $("settings-save-hint"),
  ghLink: $("gh-link"),
  ghUrl: $("gh-url"),
  appPaths: $("app-paths"),
  footerState: $("footer-state"),
  footerNote: $("footer-note"),
};

/* ------------------------------------------------------------------ *
 * 3D preview instance
 * ------------------------------------------------------------------ */
const pv = createPreview(el.pvCanvas, {
  onStats: (s) => {
    lastThreeStats = s;
    paintPreviewStats();
  },
  onError: (msg) => setPreviewState("error", msg),
});
let lastThreeStats = null;
let lastGlbStats = null;
let pvNote = "";
let pvStageName = "";
let paintTheme = () => {};
let paintSaveMode = () => {};
let paintPack = () => {};
let paintRes = () => {};

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */
function setStatus(msg, cls) {
  el.status.textContent = msg || "";
  el.status.className = cls || "";
  const pct = progressFromMessage(msg);
  if (pct != null) setProgress(pct);
}

function setProgress(pct) {
  const n = Math.max(0, Math.min(100, pct | 0));
  el.progress.classList.add("show");
  el.progressBar.style.width = n + "%";
  el.progressLabel.textContent = n + "%";
}

function hideProgress() {
  el.progress.classList.remove("show");
  el.progressBar.style.width = "0%";
  el.progressLabel.textContent = "0%";
}

function setBusy(on) {
  busy = !!on;
  el.btnDl.disabled = busy || !currentUrl;
  el.btnDl.textContent = busy ? t(lang, "downloading") : t(lang, "btnDownload");
}

function appendLiveLog(line) {
  const text = String(line == null ? "" : line);
  if (!text) return;
  liveLog.push(text);
  if (liveLog.length > 600) liveLog = liveLog.slice(-600);
  if (devMode) {
    el.devLog.textContent = liveLog.join("\n");
    el.devLog.scrollTop = el.devLog.scrollHeight;
  }
}

function renderDevPanel() {
  el.devPanel.classList.toggle("show", devMode);
  el.devLogTitle.textContent = t(lang, "devLogTitle");
  el.btnCopyLog.textContent = t(lang, "copyLog");
  el.btnSaveLog.textContent = t(lang, "saveLog");
  el.btnClearLog.textContent = t(lang, "clearLog");
  if (devMode) {
    el.devLog.textContent = liveLog.join("\n") || "—";
    el.devLog.scrollTop = el.devLog.scrollHeight;
  }
}

function normalizeUrl(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const uid = extractUid(raw);
  if (!uid) return "";
  if (!/sketchfab\.com/i.test(raw))
    return `https://sketchfab.com/3d-models/${uid}`;
  return raw;
}

function showTab(name) {
  const cur = name === "set" ? "set" : name === "bulk" ? "bulk" : "dl";
  el.tabDl.classList.toggle("active", cur === "dl");
  el.tabBulk.classList.toggle("active", cur === "bulk");
  el.tabSet.classList.toggle("active", cur === "set");
  el.paneDl.classList.toggle("active", cur === "dl");
  el.paneBulk.classList.toggle("active", cur === "bulk");
  el.paneSet.classList.toggle("active", cur === "set");
  if (cur === "dl") setTimeout(() => pv.resize(), 30);
}

/* ------------------------------------------------------------------ *
 * preview panel
 * ------------------------------------------------------------------ */
function setPreviewState(state, msg) {
  el.pvOverlay.className = "pv-overlay " + state;
  if (state === "ready") el.pvOverlay.classList.add("hidden");
  if (msg) el.pvMsg.textContent = msg;
}

function paintPreviewStats() {
  const parts = [];
  if (lastGlbStats) {
    parts.push(
      t(lang, "previewStats", {
        meshes: lastGlbStats.geometryCount || lastGlbStats.meshes || 0,
        mats: lastGlbStats.materials || 0,
        imgs: lastGlbStats.images || lastGlbStats.textures || 0,
        faces: Number(lastGlbStats.faces || 0).toLocaleString(lang),
      }),
    );
  } else if (lastThreeStats) {
    parts.push(
      t(lang, "previewStats", {
        meshes: lastThreeStats.meshes,
        mats: lastThreeStats.materials,
        imgs: 0,
        faces: lastThreeStats.tris.toLocaleString(lang),
      }),
    );
  }
  if (lastGlbStats && lastGlbStats.mb) {
    parts.push(t(lang, "previewStatsGlb", { mb: lastGlbStats.mb }));
  }
  if (pvNote) parts.push(pvNote);
  el.pvStats.textContent = parts.join(" · ");
}

function setPreviewBadge(text, cls) {
  el.pvBadge.textContent = text || "—";
  el.pvBadge.className = "pv-badge" + (cls ? " " + cls : "");
}

async function runPreview(url) {
  const target = normalizeUrl(url);
  if (!target) return;
  if (pv.unavailable) return;
  if (pvJobId) {
    window.sf.cancel(pvJobId).catch(() => {});
  }
  const jobId = nextJobId();
  pvJobId = jobId;
  lastGlbStats = null;
  lastThreeStats = null;
  pvNote = "";
  pvStageName = "";
  setPreviewBadge(t(lang, "previewWorking"));
  setPreviewState("loading", t(lang, "previewWorking"));
  paintPreviewStats();

  const res = await window.sf.preview({
    url: target,
    jobId,
    flags: {
      textures: desktop.previewTextures !== false,
      useCache: true,
    },
  });
  if (!res || !res.ok) {
    setPreviewState("error", (res && res.error) || "preview failed");
  }
}

function onPreviewGlb(ev) {
  const stage = ev.stage === "textures" ? "textures" : "mesh";
  pvStageName = stage;
  setPreviewBadge(
    stage === "textures"
      ? t(lang, "previewStageTex")
      : t(lang, "previewStageMesh"),
  );
  lastGlbStats = {
    ...(ev.stats || {}),
    mb: ev.bytes ? Math.round((ev.bytes / (1024 * 1024)) * 10) / 10 : 0,
  };
  paintPreviewStats();
  pv.loadGlb(ev.url, { keepCamera: stage === "textures" })
    .then(() => {
      setPreviewState("ready");
      // diagnostics hook (used by the headless self-test)
      window.__pvReady = {
        stage,
        url: ev.url,
        bytes: ev.bytes,
        glb: lastGlbStats,
        three: lastThreeStats,
      };
    })
    .catch((e) =>
      setPreviewState("error", (e && e.message) || "cannot render GLB"),
    );
}

/* ------------------------------------------------------------------ *
 * model metadata card
 * ------------------------------------------------------------------ */
function fillModelCard(meta) {
  if (!meta) return;
  currentMeta = meta;
  el.modelCard.hidden = false;
  if (meta.thumb) {
    el.modelThumb.src = meta.thumb;
    el.modelThumb.hidden = false;
  } else {
    el.modelThumb.removeAttribute("src");
    el.modelThumb.hidden = true;
  }
  el.modelName.textContent = meta.name || "";
  el.modelName.title = meta.name || "";
  el.modelAuthor.textContent = `${t(lang, "by")}: ${meta.author || "—"}`;
  const bits = [];
  if (meta.faceCount) bits.push(`${meta.faceCount.toLocaleString(lang)} faces`);
  if (meta.vertexCount)
    bits.push(`${meta.vertexCount.toLocaleString(lang)} verts`);
  if (meta.animationCount) bits.push(`${meta.animationCount} anim`);
  bits.push(`${meta.likeCount || 0} ★ · ${meta.viewCount || 0} views`);
  el.modelStats.textContent = bits.join(" · ");
  el.modelLicense.textContent = meta.license
    ? `© ${meta.license}${meta.licenseRequirements ? ` — ${meta.licenseRequirements}` : ""}`
    : "";
  el.modelDesc.textContent = meta.description || "";
  el.btnOpenSite.disabled = false;
}

/* ------------------------------------------------------------------ *
 * worker events
 * ------------------------------------------------------------------ */
window.sf.onEvent((ev) => {
  if (!ev || !ev.type) return;
  switch (ev.type) {
    case "progress": {
      const text = ev.text || "";
      if (ev.id === dlJobId) {
        setStatus(text);
        appendLiveLog(text);
      } else if (ev.id === pvJobId) {
        setPreviewState("loading", `${t(lang, "previewWorking")}\n${text}`);
        appendLiveLog(`[preview] ${text}`);
      }
      break;
    }
    case "preview-meta":
      fillModelCard(ev.meta);
      break;
    case "preview-glb":
      onPreviewGlb(ev);
      break;
    case "preview-note":
      pvNote = ev.text || "";
      paintPreviewStats();
      break;
    case "preview-done":
      if (ev.id === pvJobId) {
        setPreviewBadge(t(lang, "previewReady"), "ok");
        setPreviewState("ready");
      }
      break;
    case "preview-error":
      if (ev.id === pvJobId) {
        setPreviewBadge(ev.error || "error", "err");
        setPreviewState("error", ev.error || "preview failed");
      }
      break;
    case "preview-canceled":
      break;
    case "bulk-item":
      onBulkItem(ev);
      break;
    case "bulk-finish":
      onBulkFinish(ev);
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ *
 * download
 * ------------------------------------------------------------------ */
async function startDownload() {
  if (busy) return;
  const url = normalizeUrl(el.urlInput.value);
  if (!url) {
    setStatus(
      t(lang, el.urlInput.value.trim() ? "errBadUrl" : "errNoUrl"),
      "warn",
    );
    return;
  }
  if (!desktop || !("saveMode" in desktop))
    desktop = await window.sf.getDesktopPrefs();

  liveLog = [];
  renderDevPanel();
  // a running preview would compete for bandwidth with the download
  if (pvJobId) {
    window.sf.cancel(pvJobId).catch(() => {});
    pvJobId = null;
  }
  const jobId = nextJobId();
  dlJobId = jobId;
  setBusy(true);
  setProgress(4);
  el.ready.textContent = t(lang, "downloading");
  setStatus(t(lang, "working"));
  appendLiveLog(`start ${new Date().toISOString()} ${url}`);

  try {
    const res = await window.sf.download({
      url,
      jobId,
      flags: jobFlagsFromPrefs(applied),
    });
    if (res && res.ok) {
      setProgress(100);
      el.ready.textContent = t(lang, "downloadOk");
      setStatus(
        `✅ ${res.name || ""} — ${res.zipName || ""}\n${t(lang, "savedTo")} ${res.path}\n${t(
          lang,
          "downloadDoneFolder",
        )}`,
        "ok",
      );
      appendLiveLog(`done ${res.zipName} → ${res.path} (${res.bytes} bytes)`);
      if (res.logText) {
        liveLog = String(res.logText).split("\n");
        renderDevPanel();
      }
    } else if (res && res.canceled) {
      el.ready.textContent = t(lang, "downloadCanceled");
      setStatus(t(lang, "downloadCanceled"), "warn");
    } else {
      el.ready.textContent = "Error";
      setStatus(`❌ ${(res && res.error) || "download failed"}`, "warn");
      appendLiveLog(`ERROR ${(res && res.error) || "download failed"}`);
    }
  } catch (e) {
    setStatus(`❌ ${e && e.message ? e.message : e}`, "warn");
    appendLiveLog(`ERROR ${e && e.message ? e.message : e}`);
  } finally {
    setBusy(false);
    dlJobId = null;
    desktop = await window.sf.getDesktopPrefs();
    paintDesktopSettings();
  }
}

/* ------------------------------------------------------------------ *
 * bulk queue
 * ------------------------------------------------------------------ */
function bulkAddRow(url, index, total) {
  const div = document.createElement("div");
  div.className = "bulk-item run";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = url;
  const msg = document.createElement("div");
  msg.className = "msg";
  msg.textContent = t(lang, "bulkStarting");
  div.append(title, msg);
  el.bulkLog.prepend(div);
  const row = { div, msg, index, total };
  bulkRows.push(row);
  return row;
}

function onBulkItem(ev) {
  if (ev.state === "start") {
    bulkAddRow(ev.url, ev.index, ev.total);
    el.bulkSummary.textContent = `${t(lang, "bulkDownloading")} ${ev.index + 1} / ${ev.total}…`;
    return;
  }
  const row = bulkRows.find((r) => r.index === ev.index);
  if (!row) return;
  if (ev.state === "done") {
    row.div.className = "bulk-item ok";
    row.msg.textContent = `✅ ${ev.name || ""} — ${ev.zipName || ""}${
      ev.bytes ? ` · ${ev.bytes} B` : ""
    }`;
  } else if (ev.state === "error") {
    row.div.className = "bulk-item err";
    row.msg.textContent = `❌ ${ev.error || "failed"}`;
  }
}

function onBulkFinish(ev) {
  el.bulkStart.disabled = false;
  el.bulkStop.disabled = true;
  el.bulkSummary.textContent = ev.stopped
    ? t(lang, "bulkStopped", { ok: ev.ok, fail: ev.fail })
    : t(lang, "bulkFinished", { ok: ev.ok, fail: ev.fail });
}

async function startBulk() {
  const lines = String(el.bulkLinks.value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const urls = [];
  const seen = new Set();
  for (const line of lines) {
    const url = normalizeUrl(line);
    const uid = extractUid(line);
    if (!url || !uid || seen.has(uid)) continue;
    seen.add(uid);
    urls.push(url);
  }
  if (!urls.length) {
    el.bulkSummary.textContent = t(lang, "bulkNoLinks");
    return;
  }
  const dir = desktop.bulkDir || desktop.lastSaveDir;
  if (!dir) {
    el.bulkSummary.textContent = t(lang, "bulkFolderLabel");
    return;
  }
  el.bulkLog.innerHTML = "";
  bulkRows = [];
  el.bulkStart.disabled = true;
  el.bulkStop.disabled = false;
  el.bulkSummary.textContent = `${t(lang, "bulkDownloading")} 1 / ${urls.length}…`;
  const res = await window.sf.bulkStart({
    urls,
    dir,
    flags: jobFlagsFromPrefs(applied),
  });
  if (res && res.ok === false) {
    el.bulkSummary.textContent = res.error || "failed";
    el.bulkStart.disabled = false;
    el.bulkStop.disabled = true;
  }
}

/* ------------------------------------------------------------------ *
 * settings
 * ------------------------------------------------------------------ */
function paintSettingsFlash() {
  paintFlash(el.settingsFlash, {
    dirty: isJobDirty({ textures: pendingTex, devMode: pendingDev }, applied),
    appliedOk,
    t,
    lang,
  });
}

function paintDesktopSettings() {
  el.saveModeLabel.textContent = t(lang, "saveModeLabel");
  el.saveModeHint.textContent = t(lang, "saveModeHint");
  el.lastFolderLabel.textContent = t(lang, "lastFolder");
  el.btnPickFolder.textContent = t(lang, "btnPickFolder");
  el.btnOpenFolder.textContent = t(lang, "btnOpenFolder");
  el.openFolderLabel.textContent = t(lang, "openFolderAfterSave");
  el.previewAutoLabel.textContent = t(lang, "previewAutoStart");
  el.previewTexLabel.textContent = t(lang, "previewTexturesPref");
  el.winSettingsTitle.textContent = t(lang, "winSettingsTitle");
  el.logsLabel.textContent = t(lang, "logsLabel");
  el.logsHint.textContent = t(lang, "logsHint");
  el.btnOpenLogs.textContent = t(lang, "btnOpenLogs");

  el.openFolderToggle.checked = desktop.openFolderAfterSave !== false;
  el.previewAutoToggle.checked = desktop.previewAutoStart !== false;
  el.previewTexToggle.checked = desktop.previewTextures !== false;
  el.pvTex.checked = desktop.previewTextures !== false;
  el.pvTexLabel.textContent = t(lang, "previewTexturesToggle");

  const folder = desktop.bulkDir || desktop.lastSaveDir || "—";
  el.lastFolder.textContent = folder;
  el.lastFolder.title = folder;
  el.bulkFolder.textContent = desktop.bulkDir || desktop.lastSaveDir || "—";
  el.bulkFolder.title = desktop.bulkDir || desktop.lastSaveDir || "";

  paintSaveMode = bindPillSwitch(el.saveModeSwitch, {
    items: [
      { code: "after", label: t(lang, "saveModeAfter") },
      { code: "before", label: t(lang, "saveModeBefore") },
      { code: "auto", label: t(lang, "saveModeAuto") },
    ],
    get: () => desktop.saveMode || "after",
    onPick: async (code) => {
      desktop = await window.sf.setDesktopPrefs({ saveMode: code });
      paintDesktopSettings();
    },
  });
}

function applyStaticI18n() {
  document.documentElement.lang = lang;
  document.title = t(lang, "appName");
  el.title.textContent = t(lang, "appName");
  el.tagline.textContent = t(lang, "desktopTagline");
  el.urlLabel.textContent = t(lang, "urlLabel");
  el.urlInput.placeholder = t(lang, "urlPlaceholder");
  el.btnPaste.textContent = t(lang, "btnPaste");
  el.btnClearUrl.textContent = t(lang, "btnClear");
  el.desktopHint.textContent = t(lang, "desktopHint");
  el.ready.textContent = t(lang, "readyDownload");
  el.btnDl.textContent = busy ? t(lang, "downloading") : t(lang, "btnDownload");
  el.btnBulk.textContent = t(lang, "btnBulk");
  el.btnOpenSite.textContent = t(lang, "btnOpenOnSite");
  el.pvTitle.textContent = t(lang, "previewTitle");
  el.pvHint.textContent = t(lang, "previewHint");
  el.pvRefresh.textContent = t(lang, "previewRefresh");
  el.pvFull.textContent = el.previewCard.classList.contains("fullscreen")
    ? t(lang, "previewExitFullscreen")
    : t(lang, "previewFullscreen");
  el.pvWire.textContent = t(lang, "previewWireframe");
  el.pvGrid.textContent = t(lang, "previewGrid");
  el.pvRotate.textContent = t(lang, "previewRotate");
  el.pvReset.textContent = t(lang, "previewReset");
  el.pvShot.textContent = t(lang, "previewShot");
  if (!pvStageName && !lastGlbStats)
    el.pvMsg.textContent = t(lang, "previewIdle");

  el.bulkLabel.textContent = t(lang, "bulkLabel");
  el.bulkLinks.placeholder = t(lang, "bulkPlaceholder");
  el.bulkFolderLabel.textContent = t(lang, "bulkFolderLabel");
  el.bulkFolderHint.textContent = t(lang, "bulkFolderHint");
  el.bulkPick.textContent = t(lang, "btnPickFolder");
  el.bulkOpen.textContent = t(lang, "bulkOpenFolder");
  el.bulkStart.textContent = t(lang, "bulkStart");
  el.bulkStop.textContent = t(lang, "stopQueue");
  el.bulkQueueTitle.textContent = t(lang, "bulkQueue");

  el.settingsTitle.textContent = t(lang, "settingsTitle");
  el.texLabel.textContent = t(lang, "optTextures");
  el.texHint.textContent = t(lang, "optTexturesHint");
  el.devLabel.textContent = t(lang, "devMode");
  el.devHint.textContent = t(lang, "optDevHint");
  el.themeLabel.textContent = t(lang, "optTheme");
  el.packLabel.textContent = t(lang, "optPack");
  el.packHint.textContent = t(lang, "packHint");
  el.resLabel.textContent = t(lang, "optTexSize");
  el.resHint.textContent = t(lang, "texSizeHint");
  el.btnSaveSettings.textContent = t(lang, "saveSettings");
  el.settingsSaveHint.textContent = t(lang, "settingsSaveHint");
  el.ghLink.textContent = t(lang, "githubRepo");
  el.jobStatus.textContent = formatJobStatus(applied, t, lang);
  el.tabDl.textContent = t(lang, "tabDownload");
  el.tabBulk.textContent = t(lang, "tabBulk");
  el.tabSet.textContent = t(lang, "tabSettings");
  el.footerNote.textContent = `${t(lang, "language")}: ${lang.toUpperCase()}`;

  updateLangSwitch(el.langSwitch, lang);
  applyTheme(document.documentElement, applied.theme);
  applyTheme(document.body, applied.theme);
  paintTheme = bindThemeSwitch(el.themeSwitch, {
    getTheme: () => applied.theme,
    onPick: (code) => persistInstant({ theme: code }),
    t,
    lang,
  });
  paintPack = bindPillSwitch(el.packSwitch, {
    items: [
      { code: "full", label: t(lang, "packFull") },
      { code: "glb", label: t(lang, "packGlb") },
    ],
    get: () => applied.packMode,
    onPick: (code) => persistInstant({ packMode: code }),
  });
  paintRes = bindPillSwitch(el.resSwitch, {
    items: [
      { code: "0", label: t(lang, "texSizeOrig") },
      { code: "2048", label: t(lang, "texSize2k") },
      { code: "4096", label: t(lang, "texSize4k") },
    ],
    get: () => String(applied.maxTextureEdge || 0),
    onPick: (code) => persistInstant({ maxTextureEdge: Number(code) || 0 }),
  });
  renderDevPanel();
  paintSettingsFlash();
  paintPreviewStats();
}

async function persistInstant(partial) {
  applied = await savePrefs(partial);
  lang = applied.lang;
  devMode = applied.devMode === true;
  setDevModeCache(devMode);
  paintDesktopSettings();
  applyStaticI18n();
  return applied;
}

async function applyJobPrefs() {
  const next = await savePrefs({ textures: pendingTex, devMode: pendingDev });
  applied = next;
  pendingTex = next.textures === true;
  pendingDev = next.devMode === true;
  devMode = next.devMode === true;
  setDevModeCache(devMode);
  el.texToggle.checked = pendingTex;
  el.devToggle.checked = pendingDev;
  appliedOk = true;
  paintDesktopSettings();
  applyStaticI18n();
}

/* ------------------------------------------------------------------ *
 * wiring
 * ------------------------------------------------------------------ */
el.tabDl.onclick = () => showTab("dl");
el.tabBulk.onclick = () => showTab("bulk");
el.tabSet.onclick = () => showTab("set");

el.btnDl.onclick = () => startDownload();
el.btnBulk.onclick = () => showTab("bulk");
el.btnOpenSite.onclick = () => {
  const url =
    (currentMeta && currentMeta.viewerUrl) || normalizeUrl(el.urlInput.value);
  if (url) window.sf.openExternal(url);
};

el.btnPaste.onclick = async () => {
  const text = await window.sf.clipboardRead();
  if (!text) return;
  el.urlInput.value = String(text).trim();
  handleUrlChange({ force: true });
};
el.btnClearUrl.onclick = () => {
  el.urlInput.value = "";
  handleUrlChange({ force: true });
};

let urlTimer = null;
el.urlInput.addEventListener("input", () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => handleUrlChange({}), 600);
});
el.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(urlTimer);
    handleUrlChange({ force: true });
  }
});

async function handleUrlChange({ force = false } = {}) {
  const raw = el.urlInput.value.trim();
  const url = normalizeUrl(raw);
  currentUrl = url;
  el.btnDl.disabled = busy || !url;
  el.btnOpenSite.disabled = !url;
  el.ready.textContent = url ? t(lang, "readyDownload") : t(lang, "errNoUrl");
  if (!url) {
    if (raw) setStatus(t(lang, "errBadUrl"), "warn");
    else setStatus("");
    return;
  }
  setStatus(t(lang, "modelDetected"), "ok");
  const meta = await probeMeta(url);
  if (meta) fillModelCard(meta);
  if (desktop.previewAutoStart !== false || force) {
    runPreview(url).catch((e) =>
      setPreviewState("error", e && e.message ? e.message : String(e)),
    );
  }
}

/** Light metadata probe through the worker (no decrypt). */
async function probeMeta(url) {
  try {
    const res = await window.sf.probeMeta({ url });
    if (res && res.ok && res.meta) return res.meta;
  } catch (_) {}
  return null;
}

el.pvRefresh.onclick = () => {
  if (currentUrl) runPreview(currentUrl);
};
el.pvFull.onclick = () => {
  const on = !el.previewCard.classList.contains("fullscreen");
  el.previewCard.classList.toggle("fullscreen", on);
  el.pvFull.textContent = on
    ? t(lang, "previewExitFullscreen")
    : t(lang, "previewFullscreen");
  setTimeout(() => pv.resize(), 40);
};
el.pvTex.onchange = async () => {
  desktop = await window.sf.setDesktopPrefs({
    previewTextures: el.pvTex.checked,
  });
  paintDesktopSettings();
  if (currentUrl && el.pvTex.checked) runPreview(currentUrl);
};
el.pvWire.onclick = () => {
  const on = !el.pvWire.classList.contains("active");
  el.pvWire.classList.toggle("active", on);
  pv.setWireframe(on);
};
el.pvGrid.onclick = () => {
  const on = !el.pvGrid.classList.contains("active");
  el.pvGrid.classList.toggle("active", on);
  pv.setGrid(on);
};
el.pvRotate.onclick = () => {
  const on = !el.pvRotate.classList.contains("active");
  el.pvRotate.classList.toggle("active", on);
  pv.setAutoRotate(on);
};
el.pvReset.onclick = () => pv.resetView();
el.pvShot.onclick = async () => {
  const res = await pv.savePng();
  if (res && res.ok) {
    setStatus(`${t(lang, "previewShotSaved")}: ${res.path}`, "ok");
  } else if (res && !res.canceled) {
    setStatus(`❌ ${res.error || "screenshot failed"}`, "warn");
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && el.previewCard.classList.contains("fullscreen")) {
    el.previewCard.classList.remove("fullscreen");
    el.pvFull.textContent = t(lang, "previewFullscreen");
    setTimeout(() => pv.resize(), 40);
  }
});

/* dev log buttons */
el.btnCopyLog.onclick = async () => {
  const text = el.devLog.textContent || liveLog.join("\n");
  await window.sf.clipboardWrite(text);
  setStatus(t(lang, "logCopied"), "ok");
};
el.btnSaveLog.onclick = async () => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const res = await window.sf.saveText({
    defaultName: `sf-dl-log-${stamp}.txt`,
    text: el.devLog.textContent || liveLog.join("\n"),
  });
  if (res && res.ok) setStatus(`${t(lang, "logSaved")}: ${res.path}`, "ok");
};
el.btnClearLog.onclick = () => {
  liveLog = [];
  renderDevPanel();
};

/* settings controls */
el.texToggle.onchange = () => {
  pendingTex = el.texToggle.checked;
  appliedOk = false;
  paintSettingsFlash();
};
el.devToggle.onchange = () => {
  pendingDev = el.devToggle.checked;
  appliedOk = false;
  paintSettingsFlash();
};
el.btnSaveSettings.onclick = async () => {
  try {
    await applyJobPrefs();
    setStatus(t(lang, "settingsSaved"), "ok");
    appendLiveLog(
      `applied textures=${pendingTex ? "on" : "off"} dev=${pendingDev ? "on" : "off"}`,
    );
  } catch (e) {
    appliedOk = false;
    setStatus(`Apply failed: ${e && e.message ? e.message : e}`, "warn");
  }
  paintSettingsFlash();
};

/* Windows-side options */
el.openFolderToggle.onchange = async () => {
  desktop = await window.sf.setDesktopPrefs({
    openFolderAfterSave: el.openFolderToggle.checked,
  });
};
el.previewAutoToggle.onchange = async () => {
  desktop = await window.sf.setDesktopPrefs({
    previewAutoStart: el.previewAutoToggle.checked,
  });
};
el.previewTexToggle.onchange = async () => {
  desktop = await window.sf.setDesktopPrefs({
    previewTextures: el.previewTexToggle.checked,
  });
  paintDesktopSettings();
};
el.btnPickFolder.onclick = async () => {
  const res = await window.sf.pickFolder({ defaultPath: desktop.lastSaveDir });
  if (res && res.ok) {
    desktop = await window.sf.getDesktopPrefs();
    paintDesktopSettings();
  }
};
el.btnOpenFolder.onclick = () => {
  const dir = desktop.bulkDir || desktop.lastSaveDir;
  if (dir) window.sf.openPath(dir);
};
el.btnOpenLogs.onclick = () => window.sf.openUserData();
el.bulkPick.onclick = async () => {
  const res = await window.sf.pickFolder({
    defaultPath: desktop.bulkDir || desktop.lastSaveDir,
  });
  if (res && res.ok) {
    desktop = await window.sf.setDesktopPrefs({ bulkDir: res.dir });
    paintDesktopSettings();
  }
};
el.bulkOpen.onclick = () => {
  const dir = desktop.bulkDir || desktop.lastSaveDir;
  if (dir) window.sf.openPath(dir);
};
el.bulkStart.onclick = () => startBulk();
el.bulkStop.onclick = async () => {
  el.bulkStop.disabled = true;
  el.bulkSummary.textContent = t(lang, "bulkStopping");
  await window.sf.bulkStop();
};
el.ghLink.onclick = (e) => {
  e.preventDefault();
  window.sf.openExternal(el.ghUrl.textContent.trim());
};

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */
async function init() {
  const info = await window.sf.info();
  desktop = await window.sf.getDesktopPrefs();
  applied = await loadPrefs();
  lang = applied.lang;
  pendingTex = applied.textures === true;
  pendingDev = applied.devMode === true;
  devMode = applied.devMode === true;
  setDevModeCache(devMode);
  el.texToggle.checked = pendingTex;
  el.devToggle.checked = pendingDev;
  el.ver.textContent = `v${info.version}`;
  const logPath = await window.sf.logPath();
  el.logsPath.textContent = logPath || "—";
  el.logsPath.title = logPath || "";
  el.plat.textContent =
    info.platform === "win32"
      ? "Windows"
      : info.platform === "darwin"
        ? "macOS"
        : "Linux";
  el.appPaths.textContent = `${info.platform} · Electron ${info.electron} · ${info.userData}`;
  el.footerState.textContent = `${info.platform} - Chrome ${info.chrome}`;

  el.langSwitch.appendChild(
    createLangSwitch(lang, async (code) => {
      await persistInstant({ lang: code });
    }),
  );

  paintDesktopSettings();
  applyStaticI18n();
  showTab("dl");
  setPreviewState("idle", t(lang, "previewIdle"));

  if (devMode) {
    try {
      const last = await readLastRunLog();
      if (last && last.text) {
        liveLog = String(last.text).split("\n");
        renderDevPanel();
      }
    } catch (_) {}
  }

  // a link passed on the command line (or "Open with…") wins over the clipboard
  if (info.startupUrl) {
    el.urlInput.value = info.startupUrl;
    currentUrl = normalizeUrl(info.startupUrl);
    await handleUrlChange({ force: true });
    return;
  }

  // otherwise prefill from the clipboard if it already holds a Sketchfab link
  try {
    const clip = await window.sf.clipboardRead();
    const uid = extractUid(clip || "");
    if (uid && !el.urlInput.value) {
      el.urlInput.value = String(clip).trim();
      handleUrlChange({});
    }
  } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => {
    console.error("[sf-ui] init failed", e);
    setStatus(`❌ init: ${e && e.message ? e.message : e}`, "warn");
  });
});
