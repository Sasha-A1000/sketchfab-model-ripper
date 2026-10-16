/**
 * UI preload: bridges the renderer UI to the main process.
 * Exposed as `window.sf` (and `window.sfDlg` for the download helper).
 */
"use strict";

const { ipcRenderer, clipboard } = require("electron");

const listeners = new Set();

ipcRenderer.on("sf-ev", (_e, ev) => {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch (err) {
      console.warn("[sf-ui] listener failed", err);
    }
  }
});

window.sf = {
  /* info + shell ------------------------------------------------- */
  info: () => ipcRenderer.invoke("app:info"),
  locale: () => ipcRenderer.invoke("app:locale"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  openPath: (p) => ipcRenderer.invoke("app:openPath", p),
  showItemInFolder: (p) => ipcRenderer.invoke("app:showItem", p),
  pickFolder: (opts) => ipcRenderer.invoke("app:pickFolder", opts),
  logPath: () => ipcRenderer.invoke("app:logPath"),
  openUserData: () => ipcRenderer.invoke("app:openUserData"),
  saveText: (opts) => ipcRenderer.invoke("app:saveText", opts),

  /* desktop prefs (extends the extension's chrome.storage prefs) --- */
  getDesktopPrefs: () => ipcRenderer.invoke("desktop:get"),
  setDesktopPrefs: (partial) => ipcRenderer.invoke("desktop:set", partial),

  /* chrome.storage.local stand-in for lib/*.js -------------------- */
  prefs: {
    get: (keys) => ipcRenderer.invoke("prefs:get", keys),
    set: (obj) => ipcRenderer.invoke("prefs:set", obj),
    all: () => ipcRenderer.invoke("prefs:all"),
  },

  /* clipboard ------------------------------------------------------ */
  clipboardRead: async () => {
    try {
      return clipboard.readText();
    } catch (_) {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        return "";
      }
    }
  },
  clipboardWrite: async (text) => {
    try {
      clipboard.writeText(String(text == null ? "" : text));
      return true;
    } catch (_) {
      try {
        await navigator.clipboard.writeText(String(text == null ? "" : text));
        return true;
      } catch (e) {
        return false;
      }
    }
  },

  /* jobs ---------------------------------------------------------- */
  probeMeta: (payload) => ipcRenderer.invoke("sf:probe", payload),
  preview: (payload) => ipcRenderer.invoke("sf:preview", payload),
  cancel: (jobId) => ipcRenderer.invoke("sf:cancel", jobId),
  download: (payload) => ipcRenderer.invoke("sf:download", payload),
  bulkStart: (payload) => ipcRenderer.invoke("sf:bulkStart", payload),
  bulkStop: () => ipcRenderer.invoke("sf:bulkStop"),
  /** save a PNG produced by the preview canvas (asks where, then reveals) */
  savePng: async (data, defaultName) => {
    const ask = await ipcRenderer.invoke("app:askSavePath", {
      defaultName: defaultName || "preview.png",
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!ask || !ask.ok) return { ok: false, canceled: true };
    const written = await ipcRenderer.invoke("app:writeBinary", {
      path: ask.path,
      data,
    });
    if (written && written.ok)
      ipcRenderer.invoke("app:explorerReveal", written.path);
    return written || { ok: false, error: "write failed" };
  },

  onEvent: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/**
 * Main-process aware save helper for lib/save.js (extension code).
 * The extension's chrome.downloads wrapper lands here instead of a browser
 * download; the real "where to save?" dialog runs in the main process.
 *
 * @param {string} url blob: URL of the ZIP (created by the caller)
 * @param {string} filename suggested name
 * @returns {Promise<{ok:boolean, path?:string, canceled?:boolean, error?:string}>}
 */
window.sfDlg = {
  save: async (url, filename) => {
    try {
      const ask = await ipcRenderer.invoke("app:askSavePath", {
        defaultName: filename,
      });
      if (!ask || !ask.ok) return { ok: false, canceled: true };
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const written = await ipcRenderer.invoke("app:writeBinary", {
        path: ask.path,
        data: buf,
      });
      if (written && written.ok) {
        ipcRenderer.invoke("app:explorerReveal", written.path);
      }
      return written || { ok: false, error: "write failed" };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop-app");
});
