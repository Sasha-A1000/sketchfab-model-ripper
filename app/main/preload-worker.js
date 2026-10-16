/**
 * Worker preload: gives the hidden worker window a tiny, explicit bridge to
 * the main process (commands in, events out) plus the file-system bits the
 * engine needs to drop the finished ZIP / preview GLB on disk.
 */
"use strict";

const { ipcRenderer } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const listeners = new Set();

ipcRenderer.on("sf-cmd", (_e, cmd) => {
  for (const fn of listeners) {
    try {
      fn(cmd);
    } catch (e) {
      console.warn("[sf-worker] command handler failed", e);
    }
  }
});

window.sfWorker = {
  /* plumbing ------------------------------------------------------- */
  ready() {
    ipcRenderer.send("sf-worker-ready");
  },
  onCommand(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** reply to a `cmd` by its id (resolves main's workerCall promise) */
  result(id, payload) {
    ipcRenderer.send("sf-ev", { type: "result", id, payload });
  },
  /** unsolicited progress / stage event for the UI window */
  event(ev) {
    ipcRenderer.send("sf-ev", ev);
  },

  /* prefs (chrome.storage.local stand-in) -------------------------- */
  prefs: {
    get: (keys) => ipcRenderer.invoke("prefs:get", keys),
    set: (obj) => ipcRenderer.invoke("prefs:set", obj),
  },

  /* filesystem ----------------------------------------------------- */
  fs: {
    writeFile: async (p, data) => {
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      await fs.promises.writeFile(p, Buffer.from(data));
      return { ok: true, path: p, size: Buffer.from(data).length };
    },
    readFile: (p) => fs.promises.readFile(p),
    mkdirp: (p) => fs.promises.mkdir(p, { recursive: true }),
    exists: (p) => fs.existsSync(p),
    remove: (p) => fs.promises.rm(p, { force: true }),
    dirname: (p) => path.dirname(p),
    basename: (p) => path.basename(p),
    join: (...parts) => path.join(...parts),
    tmpdir: () => os.tmpdir(),
    stat: async (p) => {
      const s = await fs.promises.stat(p);
      return { size: s.size, mtimeMs: s.mtimeMs };
    },
  },

  mediaDir: () => ipcRenderer.invoke("app:mediaDir"),
};
