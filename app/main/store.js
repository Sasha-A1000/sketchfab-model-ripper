/**
 * Tiny JSON settings store.
 *
 * It impersonates `chrome.storage.local` so the extension's own modules
 * (lib/settings.js, lib/devlog.js, lib/sf-api.js) keep working unmodified.
 *
 * File: %APPDATA%/Sketchfab Public Downloader/prefs.json
 */
"use strict";

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const FILE = "prefs.json";
let cache = null;
let filePath = null;

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
      askWhereToSave: true,
      openFolderAfterSave: true,
      previewTextures: true,
      previewAutoStart: true,
      lastSaveDir: "",
      window: null,
    },
  };
}

function load() {
  if (cache) return cache;
  const base = defaults();
  try {
    const raw = fs.readFileSync(resolveFile(), "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      ...base,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
    cache.desktop = { ...base.desktop, ...(cache.desktop || {}) };
  } catch (_) {
    cache = base;
  }
  if (!cache.desktop.lastSaveDir) {
    try {
      cache.desktop.lastSaveDir = app.getPath("downloads");
    } catch (_) {
      cache.desktop.lastSaveDir = "";
    }
  }
  return cache;
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

/** All stored keys. */
function all() {
  return { ...load() };
}

/**
 * chrome.storage.local.get compatible read.
 * @param {string|string[]|null|undefined} keys
 */
function get(keys) {
  const data = load();
  if (keys === null || keys === undefined) return { ...data };
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) {
    if (k in data) out[k] = data[k];
  }
  return out;
}

/** chrome.storage.local.set compatible write (merges). */
function set(obj) {
  const data = load();
  if (obj && typeof obj === "object") {
    Object.assign(data, obj);
    if (obj.desktop && typeof obj.desktop === "object") {
      data.desktop = { ...data.desktop, ...obj.desktop };
    }
  }
  persist();
  return { ...data };
}

/** Desktop block accessors. */
function getDesktop() {
  return { ...load().desktop };
}

function setDesktop(partial) {
  const data = load();
  data.desktop = { ...data.desktop, ...(partial || {}) };
  persist();
  return { ...data.desktop };
}

module.exports = { all, get, set, getDesktop, setDesktop, defaults };
