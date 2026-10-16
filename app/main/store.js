/**
 * Tiny JSON settings store.
 *
 * Extension-style preferences have one canonical home in `sf_prefs`; desktop
 * preferences live in `desktop`. Legacy flat sf_* keys are migrated on read
 * and are not written back. Runtime/cache keys such as sf_static_key and
 * sf_last_log remain at the root.
 *
 * File: %APPDATA%/Sketchfab Public Downloader/prefs.json
 */
"use strict";

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const FILE = "prefs.json";
const PREFS_KEY = "sf_prefs";
let cache = null;
let filePath = null;

const ROOT_PREF_ALIASES = {
  sf_download_textures: "textures",
  downloadTextures: "textures",
  sf_theme: "theme",
  sf_lang: "lang",
  sf_dev_mode: "devMode",
  sf_pack_mode: "packMode",
  sf_max_texture_edge: "maxTextureEdge",
};

const NESTED_PREF_ALIASES = {
  downloadTextures: "textures",
  sf_download_textures: "textures",
  sf_theme: "theme",
  sf_lang: "lang",
  sf_dev_mode: "devMode",
  dev_mode: "devMode",
  sf_pack_mode: "packMode",
  pack_mode: "packMode",
  sf_max_texture_edge: "maxTextureEdge",
  max_texture_edge: "maxTextureEdge",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveFile() {
  if (!filePath) filePath = path.join(app.getPath("userData"), FILE);
  return filePath;
}

function defaults() {
  return {
    sf_prefs: {
      textures: false,
      theme: "light",
      lang: "en",
      devMode: false,
      packMode: "full",
      maxTextureEdge: 0,
    },
    desktop: {
      // Windows-side options (not part of the browser extension)
      saveMode: "after",
      openFolderAfterSave: true,
      previewTextures: true,
      previewAutoStart: true,
      lastSaveDir: "",
      bulkDir: "",
      window: null,
    },
  };
}

function canonicalPrefs(raw, basePrefs, root = {}) {
  const source = isObject(raw) ? raw : {};
  const prefs = { ...basePrefs, ...source };

  // Prefer an explicitly stored canonical value (including false). If absent,
  // migrate a known alias from inside the blob, then from the old flat layout.
  const nestedAliasesUsed = new Set();
  for (const [alias, key] of Object.entries(NESTED_PREF_ALIASES)) {
    if (
      !hasOwn(source, key) &&
      !nestedAliasesUsed.has(key) &&
      hasOwn(source, alias)
    ) {
      prefs[key] = source[alias];
      nestedAliasesUsed.add(key);
    }
  }
  const rootAliasesUsed = new Set();
  for (const [alias, key] of Object.entries(ROOT_PREF_ALIASES)) {
    const hasNestedAlias = Object.entries(NESTED_PREF_ALIASES).some(
      ([nestedAlias, target]) => target === key && hasOwn(source, nestedAlias),
    );
    if (
      !hasOwn(source, key) &&
      !hasNestedAlias &&
      !rootAliasesUsed.has(key) &&
      hasOwn(root, alias)
    ) {
      prefs[key] = root[alias];
      rootAliasesUsed.add(key);
    }
  }

  for (const alias of Object.keys(NESTED_PREF_ALIASES)) delete prefs[alias];
  return prefs;
}

function normalizeDesktop(raw, baseDesktop) {
  const source = isObject(raw) ? raw : {};
  const desktop = { ...baseDesktop, ...source };

  const validSaveMode = ["after", "before", "auto"];
  if (source.saveMode === "none") {
    desktop.saveMode = "auto";
  } else if (validSaveMode.includes(source.saveMode)) {
    desktop.saveMode = source.saveMode;
  } else if (typeof source.askWhereToSave === "boolean") {
    // Previous builds stored this as a boolean: true opened the post-download
    // dialog; false silently saved to the last used folder.
    desktop.saveMode = source.askWhereToSave ? "after" : "auto";
  } else {
    desktop.saveMode = baseDesktop.saveMode;
  }

  for (const key of [
    "openFolderAfterSave",
    "previewTextures",
    "previewAutoStart",
  ]) {
    desktop[key] =
      typeof source[key] === "boolean" ? source[key] : baseDesktop[key];
  }
  desktop.lastSaveDir =
    typeof source.lastSaveDir === "string"
      ? source.lastSaveDir
      : baseDesktop.lastSaveDir;
  desktop.bulkDir =
    typeof source.bulkDir === "string" ? source.bulkDir : baseDesktop.bulkDir;
  desktop.window =
    source.window === null || isObject(source.window)
      ? source.window
      : baseDesktop.window;

  delete desktop.askWhereToSave;
  return desktop;
}

function hasLegacyPreferenceKeys(raw) {
  if (!isObject(raw)) return false;
  if (Object.keys(ROOT_PREF_ALIASES).some((key) => hasOwn(raw, key)))
    return true;
  const nested = isObject(raw[PREFS_KEY]) ? raw[PREFS_KEY] : {};
  return Object.keys(NESTED_PREF_ALIASES).some((key) => hasOwn(nested, key));
}

function needsPreferenceMigration(raw, basePrefs) {
  if (!isObject(raw[PREFS_KEY])) return true;
  const stored = raw[PREFS_KEY];
  if (Object.keys(basePrefs).some((key) => !hasOwn(stored, key))) return true;
  return hasLegacyPreferenceKeys(raw);
}

function needsDesktopMigration(raw, baseDesktop) {
  const stored = isObject(raw.desktop) ? raw.desktop : {};
  if (hasOwn(stored, "askWhereToSave")) return true;
  if (!hasOwn(stored, "saveMode")) return true;
  if (
    stored.saveMode === "none" ||
    !["after", "before", "auto"].includes(stored.saveMode)
  ) {
    return true;
  }
  return Object.keys(baseDesktop).some((key) => !hasOwn(stored, key));
}

function persist() {
  const dir = path.dirname(resolveFile());
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolveFile(), JSON.stringify(cache, null, 2), "utf8");
  } catch (e) {
    console.warn("[sf] cannot write prefs:", e && e.message);
  }
}

function load() {
  if (cache) return cache;
  const base = defaults();
  let raw = {};
  let fileWasRead = false;

  try {
    const parsed = JSON.parse(fs.readFileSync(resolveFile(), "utf8"));
    if (isObject(parsed)) {
      raw = parsed;
      fileWasRead = true;
    }
  } catch (_) {
    // A missing or malformed file starts with defaults; the next normal write
    // will recreate it without discarding any readable user data.
  }

  cache = {
    ...base,
    ...raw,
    [PREFS_KEY]: canonicalPrefs(raw[PREFS_KEY], base[PREFS_KEY], raw),
    desktop: normalizeDesktop(raw.desktop, base.desktop),
  };

  for (const alias of Object.keys(ROOT_PREF_ALIASES)) delete cache[alias];

  if (!cache.desktop.lastSaveDir) {
    try {
      cache.desktop.lastSaveDir = app.getPath("downloads");
    } catch (_) {
      cache.desktop.lastSaveDir = "";
    }
  }

  if (
    fileWasRead &&
    (needsPreferenceMigration(raw, base[PREFS_KEY]) ||
      needsDesktopMigration(raw, base.desktop))
  ) {
    // Persist the canonical representation immediately so the next launch
    // reads the migrated values and no stale flat key can shadow them.
    persist();
  }
  return cache;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    );
  }
  return value;
}

/** All stored keys (chrome.storage.local.get compatible). */
function all() {
  return clone(load());
}

/**
 * chrome.storage.local.get compatible read.
 * @param {string|string[]|null|undefined} keys
 */
function get(keys) {
  const data = load();
  if (keys === null || keys === undefined) return clone(data);
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const key of list) {
    if (hasOwn(data, key)) out[key] = clone(data[key]);
  }
  return out;
}

/** chrome.storage.local.set compatible write (merges). */
function set(obj) {
  const data = load();
  if (!isObject(obj)) return clone(data);

  const nestedUpdate = isObject(obj[PREFS_KEY]) ? obj[PREFS_KEY] : {};
  const prefUpdates = canonicalPrefs(nestedUpdate, {}, obj);
  const mergedPrefs = { ...data[PREFS_KEY], ...prefUpdates };

  const rest = { ...obj };
  delete rest[PREFS_KEY];
  delete rest.desktop;
  for (const alias of Object.keys(ROOT_PREF_ALIASES)) delete rest[alias];
  Object.assign(data, rest);
  data[PREFS_KEY] = mergedPrefs;

  if (isObject(obj.desktop)) {
    data.desktop = normalizeDesktop(
      { ...data.desktop, ...obj.desktop },
      defaults().desktop,
    );
  }

  // Clean old root aliases even if this process loaded an unusual caller's
  // object; runtime/cache keys are deliberately retained.
  for (const alias of Object.keys(ROOT_PREF_ALIASES)) delete data[alias];
  persist();
  return clone(data);
}

/** Desktop block accessors. */
function getDesktop() {
  return clone(load().desktop);
}

function setDesktop(partial) {
  const data = load();
  data.desktop = normalizeDesktop(
    { ...data.desktop, ...(isObject(partial) ? partial : {}) },
    defaults().desktop,
  );
  persist();
  return clone(data.desktop);
}

module.exports = { all, get, set, getDesktop, setDesktop, defaults };
