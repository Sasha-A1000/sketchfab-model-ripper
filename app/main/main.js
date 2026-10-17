/**
 * Sketchfab Public Downloader — Desktop (Electron main process)
 *
 * Architecture (mirrors the browser extension, which used offscreen documents):
 *
 *   ui window   (app://bundle/ui/index.html)     – popup design + 3D preview
 *   worker window (app://bundle/worker/worker.html, hidden)
 *                                                – decrypt / descramble / ZIP / fs
 *   main process (this file)                     – dialogs, Explorer, settings
 *
 * All renderer code is local; only sketchfab.com / media.sketchfab.com are
 * fetched at runtime by the worker window.
 */
"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  Menu,
} = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const { sanitizeBulkFileName } = require("./bulk-filename");

const APP_ROOT = path.join(__dirname, ".."); // the app/ directory
const SCHEME = "app";
const BUNDLE = `${SCHEME}://bundle/`;
const TITLE = "Sketchfab Public Downloader";
const PROJECT_URL =
  "https://github.com/Sasha-A1000/sketchfab-portable-downloader";

const isWin = process.platform === "win32";

let uiWin = null;
let workerWin = null;
let workerReady = false;
let workerQueue = [];
let jobSeq = 0;
/** id -> {resolve, reject, timer} for worker request/response pairs */
const waiters = new Map();
/** bulk queue state */
const bulk = { running: false, stop: false, runId: 0 };

/* ------------------------------------------------------------------ *
 * Logging & crash reporting
 *
 * Everything that could go wrong on a user's machine (a failed window load,
 * a crashed renderer, an uncaught exception) is written to
 *   %APPDATA%\\Sketchfab Public Downloader\\main.log
 * so it can be sent in for support instead of "it just closed".
 * ------------------------------------------------------------------ */

let logStream = null;
let crashDialogShown = false;

function logPath() {
  return path.join(app.getPath("userData"), "main.log");
}

function logLine(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  try {
    console.log(line);
  } catch (_) {}
  try {
    if (!logStream) {
      fs.mkdirSync(path.dirname(logPath()), { recursive: true });
      logStream = fs.createWriteStream(logPath(), { flags: "a" });
    }
    logStream.write(line + "\n");
  } catch (_) {}
}

function reportCrash(title, detail) {
  logLine("fatal", `${title}: ${detail}`);
  if (crashDialogShown) return;
  crashDialogShown = true;
  try {
    dialog.showErrorBox(
      title,
      `${detail}\n\nЛог приложения / App log:\n${logPath()}`,
    );
  } catch (_) {}
}

function installCrashHandlers() {
  process.on("uncaughtException", (e) => {
    reportCrash(
      "Sketchfab Public Downloader — непредвиденная ошибка",
      (e && e.stack) || String(e),
    );
  });
  process.on("unhandledRejection", (e) => {
    logLine(
      "error",
      `unhandledRejection: ${(e && (e.stack || e.message)) || e}`,
    );
  });
  app.on("render-process-gone", (_e, _contents, details) => {
    logLine("error", `render-process-gone: ${JSON.stringify(details)}`);
  });
  app.on("child-process-gone", (_e, details) => {
    logLine("error", `child-process-gone: ${JSON.stringify(details || {})}`);
  });
  app.on("gpu-process-crashed", (_e, killed) => {
    logLine("warn", `gpu-process-crashed killed=${killed}`);
  });
}

/* ------------------------------------------------------------------ *
 * app:// protocol — serves app files (and temp preview GLBs) so that
 * fetch()/ES-module imports/Workers behave like on a normal origin.
 * ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    // sfnet://sketchfab.com/<path> → https://sketchfab.com/<path>
    // The extension relied on host permissions for this; in Electron the
    // request is tunneled through the main process instead (no CORS, and the
    // Referer the Sketchfab viewer/CDN expects is added on the way out).
    scheme: "sfnet",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const PROXY_HOSTS = /^(www\.|media\.|static\.)?sketchfab\.com$/i;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function registerNetProxy() {
  const { net } = require("electron");
  protocol.handle("sfnet", async (request) => {
    let u;
    try {
      u = new URL(request.url);
    } catch (_) {
      return new Response("bad request", { status: 400 });
    }
    if (!PROXY_HOSTS.test(u.hostname)) {
      return new Response("host not allowed", { status: 403 });
    }
    const target = `https://${u.hostname}${u.pathname}${u.search}`;
    try {
      const resp = await net.fetch(target, {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        redirect: "follow",
        headers: {
          "User-Agent": DESKTOP_UA,
          Referer: "https://sketchfab.com/",
          Accept:
            request.headers.get("accept") ||
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });
      // The renderer fetches this scheme cross-origin; the upstream response
      // has no CORS headers, so add them (this is our own proxy, not a page).
      const headers = new Headers(resp.headers);
      headers.set("access-control-allow-origin", "*");
      headers.set("access-control-expose-headers", "*");
      if (!resp.ok) {
        console.warn("[sf] proxy", resp.status, target);
      }
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    } catch (e) {
      console.error("[sf] proxy failed", target, e && e.message);
      return new Response(`proxy error: ${e && e.message}`, {
        status: 502,
        headers: { "access-control-allow-origin": "*" },
      });
    }
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".zip": "application/zip",
};

function mediaDir() {
  const dir = path.join(app.getPath("temp"), "sf-downloader-preview");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

async function cleanMediaDir() {
  const dir = mediaDir();
  try {
    const files = await fsp.readdir(dir);
    const now = Date.now();
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > 6 * 60 * 60 * 1000)
          await fsp.rm(p, { force: true });
      } catch (_) {}
    }
  } catch (_) {}
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch (_) {
      return new Response("bad request", { status: 400 });
    }
    const host = url.hostname;
    let rel = decodeURIComponent(url.pathname);
    if (rel.startsWith("/")) rel = rel.slice(1);

    let target;
    if (host === "bundle") {
      // Keep app files rooted in app/, but allow the packaged root-level icons
      // directory to be served for the window badge and OS window icon.
      const isRootIcon = rel.startsWith("icons/");
      const root = path.resolve(
        isRootIcon ? path.join(APP_ROOT, "..", "icons") : APP_ROOT,
      );
      const relative = isRootIcon ? rel.slice("icons/".length) : rel;
      target = path.resolve(root, relative);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return new Response("forbidden", { status: 403 });
      }
    } else if (host === "media") {
      // app://media/<name>  → temp preview artifacts
      const base = path.resolve(mediaDir());
      target = path.resolve(path.join(base, rel));
      if (!target.startsWith(base)) {
        return new Response("forbidden", { status: 403 });
      }
    } else {
      return new Response("not found", { status: 404 });
    }

    try {
      const data = await fsp.readFile(target);
      const type =
        MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
      return new Response(data, {
        status: 200,
        headers: {
          "content-type": type,
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      });
    } catch (e) {
      return new Response(`not found: ${rel} (${e && e.code})`, {
        status: 404,
      });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

function preloadPath(name) {
  return path.join(__dirname, name);
}

function iconFile() {
  const ico = path.join(APP_ROOT, "..", "icons", "app.ico");
  const png = path.join(APP_ROOT, "..", "icons", "icon128.png");
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function createUiWindow() {
  const saved = store.getDesktop().window || null || {};
  uiWin = new BrowserWindow({
    width: saved.width || 1200,
    height: saved.height || 790,
    x: saved.x,
    y: saved.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: TITLE,
    backgroundColor: "#0b1220",
    icon: iconFile(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath("preload-ui.js"),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  uiWin.removeMenu();
  if (process.argv.some((a) => a.startsWith("--selftest"))) {
    uiWin.webContents.on(
      "console-message",
      (_e, level, message, line, source) => {
        console.log(
          `[ui-console:${level}] ${message} (${source || ""}:${line || 0})`,
        );
      },
    );
    uiWin.webContents.on("render-process-gone", (_e, d) =>
      console.log("[ui] render-process-gone", JSON.stringify(d)),
    );
  }
  uiWin.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logLine("error", `ui did-fail-load ${code} ${desc} ${url}`);
    reportCrash(
      "Не удалось загрузить интерфейс",
      `did-fail-load ${code} ${desc}\n${url}`,
    );
  });
  uiWin.webContents.on("render-process-gone", (_e, d) =>
    logLine("error", `ui renderer gone: ${JSON.stringify(d)}`),
  );
  logLine("info", "loading UI window");
  uiWin.loadURL(`${BUNDLE}ui/index.html`);
  uiWin.once("ready-to-show", () => uiWin.show());

  const persistBounds = () => {
    if (!uiWin || uiWin.isDestroyed() || uiWin.isMinimized()) return;
    const b = uiWin.getBounds();
    store.setDesktop({
      window: { width: b.width, height: b.height, x: b.x, y: b.y },
    });
  };
  uiWin.on("resize", persistBounds);
  uiWin.on("move", persistBounds);
  uiWin.on("close", () => {
    if (workerWin && !workerWin.isDestroyed()) {
      logLine(
        "info",
        "main window closing; force-closing hidden worker window",
      );
    }
    closeWorkerWindow("main window closed");
  });
  uiWin.on("closed", () => {
    uiWin = null;
  });

  uiWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  uiWin.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(BUNDLE)) e.preventDefault();
  });
  // F12 / Ctrl+Shift+I devtools, Ctrl+R reload
  // --shot=FILE [--shot-delay=MS] [--shot-js=CODE] : capture the window to PNG
  // and exit — useful for headless UI smoke tests.
  const shotArg = process.argv.find((a) => a.startsWith("--shot="));
  if (shotArg) {
    const file = shotArg.slice("--shot=".length);
    const delayArg = process.argv.find((a) => a.startsWith("--shot-delay="));
    const delay = delayArg
      ? Number(delayArg.slice("--shot-delay=".length))
      : 15000;
    const jsArg = process.argv.find((a) => a.startsWith("--shot-js="));
    uiWin.webContents.once("did-finish-load", () => {
      setTimeout(
        async () => {
          try {
            if (jsArg) {
              await uiWin.webContents.executeJavaScript(
                jsArg.slice("--shot-js=".length),
                true,
              );
              await new Promise((r) => setTimeout(r, 1200));
            }
            const img = await uiWin.webContents.capturePage();
            await fsp.writeFile(file, img.toPNG());
            console.log("[shot]", file, img.getSize());
          } catch (e) {
            console.log("[shot] failed", e && e.message);
          }
          app.exit(0);
        },
        Math.max(1500, delay),
      );
    });
  }

  // --tab=dl|bulk|set : open on that tab (handy for "Open with…" and support)
  const tabArg = process.argv.find((a) => a.startsWith("--tab="));
  if (tabArg) {
    const raw = tabArg.slice("--tab=".length);
    const name = raw === "bulk" || raw === "set" ? raw : "dl";
    uiWin.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        uiWin.webContents
          .executeJavaScript(
            `document.getElementById("tab-${name}")?.click()`,
            true,
          )
          .catch(() => {});
      }, 2600);
    });
  }
  if (process.argv.includes("--uitest-download")) {
    uiWin.webContents.once("did-finish-load", () => {
      setTimeout(
        () => {
          uiWin.webContents
            .executeJavaScript(
              `(() => { const b = document.getElementById("btn-dl"); if (b && !b.disabled) b.click(); return !!b; })()`,
              true,
            )
            .catch(() => {});
        },
        process.env.SF_UITEST_DELAY
          ? Number(process.env.SF_UITEST_DELAY)
          : 1000,
      );
    });
  }
  uiWin.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (
      input.key === "F12" ||
      (input.control && input.shift && input.key.toLowerCase() === "i")
    ) {
      uiWin.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  return uiWin;
}

function createWorkerWindow() {
  if (workerWin && !workerWin.isDestroyed()) return workerWin;
  workerReady = false;
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    title: "sf-worker",
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath("preload-worker.js"),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  workerWin = win;
  win.removeMenu();
  if (process.argv.some((a) => a.startsWith("--selftest"))) {
    win.webContents.on(
      "console-message",
      (_e, level, message, line, source) => {
        console.log(
          `[worker-console:${level}] ${message} (${source || ""}:${line || 0})`,
        );
      },
    );
    win.webContents.on("render-process-gone", (_e, d) =>
      console.log("[worker] render-process-gone", JSON.stringify(d)),
    );
  }
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logLine("error", `worker did-fail-load ${code} ${desc} ${url}`);
  });
  logLine("info", "loading worker window");
  win.loadURL(`${BUNDLE}worker/worker.html`);
  win.on("closed", () => {
    if (workerWin !== win) return;
    workerWin = null;
    workerReady = false;
    workerQueue = [];
    failAllWaiters("worker window closed");
  });
  win.webContents.on("render-process-gone", () => {
    if (workerWin !== win) return;
    workerReady = false;
    workerWin = null;
    workerQueue = [];
    failAllWaiters("worker crashed");
    win.destroy();
  });
  return win;
}

function sendToWorker(cmd) {
  const w = createWorkerWindow();
  if (workerReady) {
    w.webContents.send("sf-cmd", cmd);
  } else {
    workerQueue.push(cmd);
  }
}

function flushWorkerQueue() {
  if (!workerWin || workerWin.isDestroyed()) return;
  const q = workerQueue;
  workerQueue = [];
  for (const cmd of q) workerWin.webContents.send("sf-cmd", cmd);
}

function failAllWaiters(message) {
  for (const [, w] of waiters) {
    clearTimeout(w.timer);
    w.resolve({ ok: false, error: message });
  }
  waiters.clear();
}

/**
 * The hidden pipeline window keeps Electron alive after the visible UI closes.
 * Force-destroy it while quitting so window-all-closed can fire and the
 * single-instance lock is released for the next launch.
 */
function closeWorkerWindow(reason = "application is closing") {
  const win = workerWin;
  workerWin = null;
  workerReady = false;
  workerQueue = [];
  failAllWaiters(reason);
  if (win && !win.isDestroyed()) win.destroy();
}

/**
 * Send a command and await the worker's reply event (`${cmd}-result`).
 * @param {object} payload must carry `id`
 * @param {number} timeoutMs
 */
function workerCall(payload, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    // the UI may hand us its own id so it can match progress events
    const id = payload.id != null ? payload.id : ++jobSeq;
    payload.id = id;
    const timer = setTimeout(() => {
      waiters.delete(id);
      resolve({ ok: false, error: "worker timeout", id });
    }, timeoutMs);
    waiters.set(id, { resolve: (v) => resolve(v), reject: () => {}, timer });
    sendToWorker(payload);
  });
}

/* ------------------------------------------------------------------ *
 * Events from the worker
 * ------------------------------------------------------------------ */

function forwardToUi(ev) {
  if (uiWin && !uiWin.isDestroyed()) uiWin.webContents.send("sf-ev", ev);
}

ipcMain.on("sf-worker-ready", () => {
  logLine("info", "worker ready");
  workerReady = true;
  flushWorkerQueue();
  forwardToUi({ type: "worker-ready" });
});

ipcMain.on("sf-ev", (_e, ev) => {
  if (!ev || typeof ev !== "object") return;
  if (ev.type === "preview-error" || ev.type === "preview-canceled") {
    logLine("warn", `preview: ${ev.type} ${ev.error || ""}`);
  }
  if (ev.type === "result" && ev.id && waiters.has(ev.id)) {
    const w = waiters.get(ev.id);
    waiters.delete(ev.id);
    clearTimeout(w.timer);
    if (
      ev.payload &&
      ev.payload.ok === true &&
      ev.payload.path &&
      ev.payload.openFolder !== false
    ) {
      // handled by the caller (download flow) – keep raw result here
    }
    w.resolve(ev.payload || { ok: false, error: "empty worker result" });
    return;
  }
  forwardToUi(ev);
});

/* ------------------------------------------------------------------ *
 * chrome.storage.local stand-in (used by the extension's own modules)
 * ------------------------------------------------------------------ */

ipcMain.handle("prefs:get", (_e, keys) => store.get(keys));
ipcMain.handle("prefs:set", (_e, obj) => store.set(obj || {}));
ipcMain.handle("prefs:all", () => store.all());
ipcMain.handle("desktop:get", () => store.getDesktop());
ipcMain.handle("desktop:set", (_e, partial) => store.setDesktop(partial || {}));

/* ------------------------------------------------------------------ *
 * App-facing actions
 * ------------------------------------------------------------------ */

function startupUrl() {
  const arg = process.argv
    .slice(1)
    .find((a) => /^https?:\/\//i.test(a) && /sketchfab\.com/i.test(a));
  return arg || "";
}

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  startupUrl: startupUrl(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
  locale: app.getLocale(),
  userData: app.getPath("userData"),
  downloads: app.getPath("downloads"),
  githubUrl: PROJECT_URL,
}));

ipcMain.handle("app:locale", () => app.getLocale());

ipcMain.handle("app:logPath", () => logPath());

ipcMain.handle("app:openUserData", async () => {
  const dir = app.getPath("userData");
  const err = await shell.openPath(dir);
  return { ok: !err, dir, error: err || undefined };
});

ipcMain.handle("app:mediaDir", () => mediaDir());

ipcMain.handle("app:openExternal", (_e, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle("app:openPath", async (_e, p) => {
  if (typeof p !== "string" || !p) return { ok: false };
  const err = await shell.openPath(p);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle("app:showItem", (_e, p) => {
  if (typeof p !== "string" || !p) return { ok: false };
  shell.showItemInFolder(path.normalize(p));
  return { ok: true };
});

ipcMain.handle("app:pickFolder", async (_e, opts = {}) => {
  const parent = workerWin && !workerWin.isDestroyed() ? workerWin : uiWin;
  const res = await dialog.showOpenDialog(parent, {
    title: opts.title || "Выберите папку / Choose folder",
    defaultPath:
      opts.defaultPath ||
      store.getDesktop().lastSaveDir ||
      app.getPath("downloads"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length)
    return { ok: false, canceled: true };
  store.setDesktop({ lastSaveDir: res.filePaths[0] });
  return { ok: true, dir: res.filePaths[0] };
});

ipcMain.handle("app:askSavePath", async (_e, { defaultName, filters } = {}) => {
  const desktop = store.getDesktop();
  const res = await dialog.showSaveDialog(uiWin, {
    title: "Куда сохранить архив? / Save archive as",
    defaultPath: path.join(
      desktop.lastSaveDir || app.getPath("downloads"),
      defaultName || "model.zip",
    ),
    filters: filters || [
      { name: "ZIP archive", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  store.setDesktop({ lastSaveDir: path.dirname(res.filePath) });
  return { ok: true, path: res.filePath };
});

ipcMain.handle("app:writeBinary", async (_e, { path: target, data } = {}) => {
  if (!target) return { ok: false, error: "no path" };
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, Buffer.from(data));
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("app:explorerReveal", (_e, p) => {
  if (p && store.getDesktop().openFolderAfterSave !== false) {
    shell.showItemInFolder(path.normalize(p));
  }
  return { ok: true };
});

ipcMain.handle(
  "app:saveText",
  async (_e, { defaultName, text, filters } = {}) => {
    const res = await dialog.showSaveDialog(uiWin, {
      title: "Сохранить / Save",
      defaultPath: path.join(
        store.getDesktop().lastSaveDir || app.getPath("downloads"),
        defaultName || "sf-dl-log.txt",
      ),
      filters: filters || [
        { name: "Text", extensions: ["txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      await fsp.writeFile(res.filePath, String(text || ""), "utf8");
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },
);

/* ------------------------------------------------------------------ *
 * Preview (stage 1: mesh, stage 2: textures)
 * ------------------------------------------------------------------ */

ipcMain.handle("sf:preview", (_e, { url, flags, jobId } = {}) => {
  const id = jobId != null ? jobId : ++jobSeq;
  sendToWorker({ cmd: "preview", id, url, flags: flags || {} });
  return { ok: true, id };
});

ipcMain.handle("sf:cancel", (_e, jobId) => {
  sendToWorker({ cmd: "cancel", jobId });
  return { ok: true };
});

/* ------------------------------------------------------------------ *
 * Download (save dialog → worker → Explorer)
 * ------------------------------------------------------------------ */

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 500; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

/** Model metadata is probed twice (UI card + download) — cache it briefly. */
const probeCache = new Map(); // url → { t, meta }

async function probe(url) {
  const hit = probeCache.get(url);
  if (hit && Date.now() - hit.t < 60 * 1000)
    return { ok: true, meta: hit.meta, cached: true };
  const res = await workerCall({ cmd: "probe", url }, 90 * 1000);
  if (res && res.ok && res.meta) {
    probeCache.set(url, { t: Date.now(), meta: res.meta });
    while (probeCache.size > 30)
      probeCache.delete(probeCache.keys().next().value);
  }
  return res;
}

ipcMain.handle("sf:probe", async (_e, { url } = {}) => {
  if (!url) return { ok: false, error: "no url" };
  return probe(url);
});

function suggestedName(meta, textures) {
  const base = (meta && meta.name) || "sketchfab-model";
  const uid8 = meta && meta.uid ? String(meta.uid).slice(0, 8) : "";
  const suffix = textures ? "-textures" : "";
  return `${base}${uid8 ? "-" + uid8 : ""}${suffix}.zip`;
}

/**
 * Ask the user where to put the archive. Uses the Explorer-style native
 * save dialog, starting in the last used folder.
 * @returns {Promise<string|null>} chosen path or null when canceled
 */
async function askSavePath(defaultName) {
  const desktop = store.getDesktop();
  // test hook: SF_TEST_SAVE_PATH lets the headless self-test exercise the
  // real save flow without a human clicking in the dialog
  if (process.env.SF_TEST_SAVE_PATH) {
    const forced = path.resolve(process.env.SF_TEST_SAVE_PATH);
    store.setDesktop({ lastSaveDir: path.dirname(forced) });
    return forced;
  }
  const res = await dialog.showSaveDialog(uiWin, {
    title: "Куда сохранить архив? / Save archive as",
    buttonLabel: "Сохранить",
    defaultPath: path.join(
      desktop.lastSaveDir || app.getPath("downloads"),
      defaultName,
    ),
    filters: [
      { name: "ZIP archive", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePath) return null;
  store.setDesktop({ lastSaveDir: path.dirname(res.filePath) });
  return res.filePath;
}

async function performDownload({ url, flags } = {}) {
  if (!url) return { ok: false, error: "no url" };
  const desktop = store.getDesktop();
  /** after (default) = dialog once the ZIP is ready · before = Chrome-style · auto = no dialog */
  const mode = desktop.saveMode || "after";

  const probeRes = await probe(url);
  if (!probeRes || probeRes.ok === false) {
    return {
      ok: false,
      error: (probeRes && probeRes.error) || "cannot read model info",
    };
  }
  const meta = probeRes.meta || {};
  const name = suggestedName(meta, !!(flags && flags.textures));

  // "before" – the user picks the destination up front.
  let finalPath = "";
  if (mode === "before") {
    const picked = await askSavePath(name);
    if (!picked) return { ok: false, canceled: true };
    finalPath = picked;
  }

  // The engine always writes to the temp folder first; the main process then
  // moves the finished ZIP to wherever the user wants it.
  const tempPath = path.join(
    mediaDir(),
    `sf-dl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.zip`,
  );

  const done = await workerCall(
    { cmd: "download", url, targetPath: tempPath, flags: flags || {} },
    60 * 60 * 1000,
  );
  if (!done || !done.ok) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    return done || { ok: false, error: "download failed" };
  }

  if (!finalPath) {
    if (mode === "auto") {
      finalPath = uniquePath(
        path.join(desktop.lastSaveDir || app.getPath("downloads"), name),
      );
    } else {
      const picked = await askSavePath(name);
      if (!picked) {
        // The archive is already on disk — let the user decide what happens to it.
        const keep = await dialog.showMessageBox(uiWin, {
          type: "question",
          title: "Сохранить архив?",
          message: `${done.zipName || name} уже скачан (${done.bytes || 0} байт).`,
          detail: "Сохранить его в папку загрузок или удалить?",
          buttons: ["Сохранить в загрузки", "Удалить"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (keep.response === 0) {
          finalPath = uniquePath(
            path.join(
              desktop.lastSaveDir || app.getPath("downloads"),
              done.zipName || name,
            ),
          );
        } else {
          await fsp.rm(tempPath, { force: true }).catch(() => {});
          return { ok: false, canceled: true };
        }
      } else {
        finalPath = picked;
      }
    }
  }

  try {
    await fsp.mkdir(path.dirname(finalPath), { recursive: true });
    if (path.resolve(finalPath) !== path.resolve(tempPath)) {
      await fsp.copyFile(tempPath, finalPath);
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  } catch (e) {
    return {
      ok: false,
      error: `cannot write ${finalPath}: ${e && e.message ? e.message : e}`,
      tempPath,
    };
  }

  store.setDesktop({ lastSaveDir: path.dirname(finalPath) });
  if (store.getDesktop().openFolderAfterSave !== false) {
    shell.showItemInFolder(path.normalize(finalPath));
  }
  return { ...done, path: finalPath, tempPath };
}

ipcMain.handle("sf:download", (_e, payload) => performDownload(payload || {}));

/* ------------------------------------------------------------------ *
 * Bulk queue
 * ------------------------------------------------------------------ */

ipcMain.handle("sf:bulkStart", async (_e, { urls, dir, flags } = {}) => {
  if (bulk.running) return { ok: false, error: "busy" };
  const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
  if (!list.length) return { ok: false, error: "no urls" };
  if (!dir) return { ok: false, error: "no folder" };

  bulk.running = true;
  bulk.stop = false;
  bulk.runId++;
  const runId = bulk.runId;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < list.length; i++) {
    if (bulk.stop) break;
    const url = list[i];
    forwardToUi({
      type: "bulk-item",
      runId,
      index: i,
      total: list.length,
      url,
      state: "start",
    });
    const info = await probe(url);
    const meta = (info && info.meta) || {};
    const fileName = sanitizeBulkFileName(
      suggestedName(meta, !!(flags && flags.textures)),
      meta.uid,
    );
    const target = uniquePath(path.join(dir, fileName));
    const res = await workerCall(
      {
        cmd: "download",
        url,
        targetPath: target,
        flags: flags || {},
        bulk: true,
      },
      60 * 60 * 1000,
    );
    if (res && res.ok) {
      ok++;
      forwardToUi({
        type: "bulk-item",
        runId,
        index: i,
        total: list.length,
        url,
        state: "done",
        path: res.path,
        zipName: res.zipName,
        name: res.name,
        bytes: res.bytes,
      });
    } else {
      fail++;
      forwardToUi({
        type: "bulk-item",
        runId,
        index: i,
        total: list.length,
        url,
        state: "error",
        error: (res && res.error) || "failed",
        canceled: !!(res && res.canceled),
      });
      if (res && res.canceled && bulk.stop) break;
    }
  }

  bulk.running = false;
  forwardToUi({
    type: "bulk-finish",
    runId,
    ok,
    fail,
    stopped: bulk.stop,
    dir,
  });
  if (ok && store.getDesktop().openFolderAfterSave !== false) {
    shell.openPath(dir);
  }
  return { ok: true, okCount: ok, failCount: fail, stopped: bulk.stop };
});

ipcMain.handle("sf:bulkStop", () => {
  bulk.stop = true;
  sendToWorker({ cmd: "cancel" });
  return { ok: true };
});

/* ------------------------------------------------------------------ *
 * Self-test (headless verification: probe → preview → download → unzip)
 * ------------------------------------------------------------------ */

const SF_TAG = "[selftest]";

function waitForEvent(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.off("sf-ev", handler);
      resolve({ type: "timeout" });
    }, timeoutMs);
    function handler(_e, ev) {
      if (!predicate(ev)) return;
      clearTimeout(timer);
      ipcMain.off("sf-ev", handler);
      resolve(ev);
    }
    ipcMain.on("sf-ev", handler);
  });
}

async function evalInUi(code) {
  if (!uiWin || uiWin.isDestroyed()) return null;
  try {
    return await uiWin.webContents.executeJavaScript(code, true);
  } catch (e) {
    return { error: e && e.message };
  }
}

async function runSelfTest(url) {
  const out = (k, v) => console.log(SF_TAG, k, JSON.stringify(v));
  const started = Date.now();
  const skipPreview = process.argv.includes("--selftest-skip-preview");
  const skipDownload = process.argv.includes("--selftest-skip-download");

  await new Promise((res) => {
    const iv = setInterval(() => {
      if (workerReady) {
        clearInterval(iv);
        res();
      }
    }, 200);
  });
  out("workerReady", true);

  /* ---- 1. probe ---------------------------------------------------- */
  const p = await probe(url);
  out("probe", {
    ok: p.ok,
    name: p.meta && p.meta.name,
    author: p.meta && p.meta.author,
    uid: p.meta && p.meta.uid,
  });
  if (!p.ok) throw new Error("probe failed: " + p.error);

  out(
    "uiBoot",
    await evalInUi(`({
    title: document.title,
    tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
    errors: window.__uiErrors || [],
    hasPreviewApi: typeof window.sf.preview,
    canvas: !!document.querySelector('#pv-canvas'),
  })`),
  );

  /* ---- 2. preview (mesh + textures) -------------------------------- */
  if (skipPreview) {
    out("previewStages", "skipped");
  } else {
    const pvId = "selftest-preview";
    const pvDone = waitForEvent(
      (ev) =>
        ev.id === pvId &&
        (ev.type === "preview-done" || ev.type === "preview-error"),
      20 * 60 * 1000,
    );
    const stages = [];
    ipcMain.on("sf-ev", function stageWatch(_e, ev) {
      if (ev && ev.id === pvId && ev.type === "preview-glb") {
        stages.push({ stage: ev.stage, bytes: ev.bytes, stats: ev.stats });
      }
    });
    sendToWorker({
      cmd: "preview",
      id: pvId,
      url,
      flags: { textures: true, useCache: true },
    });
    const pvEnd = await pvDone;
    out("previewStages", stages);
    out("previewEnd", pvEnd);
  }

  /* ---- 3. UI render check (three.js parsed the GLB) ---------------- */
  let uiState = null;
  for (let i = 0; i < 60; i++) {
    uiState = await evalInUi("window.__pvReady || null");
    if (uiState && uiState.three) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  out("uiPreview", uiState);

  out("uiErrors", await evalInUi("window.__uiErrors || null"));

  /* ---- 4. download through the real save flow (auto mode) ---------- */
  const tmpDir = path.join(app.getPath("temp"), "sf-selftest");
  await fsp.mkdir(tmpDir, { recursive: true }).catch(() => {});
  const prevDesktop = store.getDesktop();
  store.setDesktop({
    saveMode: "auto",
    lastSaveDir: tmpDir,
    openFolderAfterSave: false,
  });
  const dl = skipDownload
    ? { ok: true, skipped: true }
    : await performDownload({
        url,
        flags: { textures: true, packMode: "full", devMode: false },
      });
  store.setDesktop(prevDesktop);
  out("download", {
    ok: dl.ok,
    path: dl.path,
    bytes: dl.bytes,
    zipName: dl.zipName,
    error: dl.error,
  });
  if (dl.ok && dl.path) {
    const st = await fsp.stat(dl.path).catch(() => null);
    out("zipOnDisk", st ? { size: st.size } : null);
  }

  /* ---- 5. "save dialog after download" mode (dialog answered by the hook) -- */
  if (!skipDownload) {
    const afterPath = path.join(tmpDir, "after-mode.zip");
    process.env.SF_TEST_SAVE_PATH = afterPath;
    store.setDesktop({
      saveMode: "after",
      lastSaveDir: tmpDir,
      openFolderAfterSave: false,
    });
    const dl2 = await performDownload({
      url,
      flags: { textures: false, packMode: "full" },
    });
    delete process.env.SF_TEST_SAVE_PATH;
    store.setDesktop(prevDesktop);
    const st2 = dl2.ok ? await fsp.stat(dl2.path).catch(() => null) : null;
    out("downloadAfterMode", {
      ok: dl2.ok,
      path: dl2.path,
      expected: afterPath,
      match: dl2.path === afterPath,
      size: st2 && st2.size,
      error: dl2.error,
    });
  }

  /* ---- 6. bulk queue driven through the real UI tab ------------------- */
  const bulkArg = process.argv.find((a) => a.startsWith("--selftest-bulk="));
  if (bulkArg && !skipDownload) {
    const urls = bulkArg
      .slice("--selftest-bulk=".length)
      .split(",")
      .filter(Boolean);
    const bulkDir = path.join(tmpDir, "bulk");
    await fsp.mkdir(bulkDir, { recursive: true }).catch(() => {});
    const finish = waitForEvent(
      (ev) => ev.type === "bulk-finish",
      40 * 60 * 1000,
    );
    const started = await evalInUi(`(async () => {
      await window.sf.setDesktopPrefs({ bulkDir: ${JSON.stringify(bulkDir)}, openFolderAfterSave: false });
      document.getElementById('tab-bulk').click();
      document.getElementById('bulk-links').value = ${JSON.stringify(urls.join("\n"))};
      document.getElementById('bulk-start').click();
      return { tab: document.getElementById('pane-bulk').className };
    })()`);
    out("bulkUi", started);
    const fin = await finish;
    out("bulkFinish", fin);
    const files = await fsp.readdir(bulkDir).catch(() => []);
    const sizes = [];
    for (const f of files) {
      const st = await fsp.stat(path.join(bulkDir, f)).catch(() => null);
      sizes.push({ f, size: st && st.size });
    }
    out("bulkFiles", sizes);
  }

  out("elapsedSec", ((Date.now() - started) / 1000).toFixed(1));
  console.log(SF_TAG, "DONE");
  setTimeout(() => app.exit(dl && dl.ok ? 0 : 4), 300);
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (uiWin) {
      if (uiWin.isMinimized()) uiWin.restore();
      uiWin.focus();
    }
  });

  app.whenReady().then(async () => {
    installCrashHandlers();
    logLine(
      "info",
      `start app=${app.getVersion()} electron=${process.versions.electron} ` +
        `chrome=${process.versions.chrome} platform=${process.platform}/${process.arch} ` +
        `userData=${app.getPath("userData")} gpu=${app.getGPUFeatureStatus().gpu_compositing || "?"}`,
    );
    if (isWin) app.setAppUserModelId("com.seryi882.sketchfab-downloader");
    const selfTestArg = process.argv.find((a) => a.startsWith("--selftest="));
    if (selfTestArg) {
      const url = selfTestArg.slice("--selftest=".length);
      setTimeout(
        () =>
          runSelfTest(url).catch((e) => {
            console.log(SF_TAG, "FAIL", e && e.stack ? e.stack : e);
            app.exit(3);
          }),
        1200,
      );
    }
    Menu.setApplicationMenu(null);
    registerProtocol();
    registerNetProxy();
    cleanMediaDir();
    createUiWindow();
    createWorkerWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createUiWindow();
    });
  });

  app.on("window-all-closed", () => {
    // Normally the UI's close handler has already destroyed the worker. Keep
    // this cleanup too for programmatic closes or future window changes.
    closeWorkerWindow("all application windows closed");
    app.quit();
  });
}
