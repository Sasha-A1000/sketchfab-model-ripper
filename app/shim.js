/**
 * chrome.* stand-in for the desktop app.
 *
 * The download engine in app/lib/ is a verbatim copy of the browser
 * extension; it talks to chrome.storage / chrome.runtime / chrome.i18n.
 * Here those APIs are backed by the Electron preload bridge, so the engine
 * runs unmodified in both the UI window and the headless worker window.
 *
 * Must be imported BEFORE any app/lib module.
 */
(function installChromeShim() {
  if (typeof globalThis.chrome === "object" && globalThis.chrome && globalThis.chrome.storage) {
    return;
  }
  const bridge = globalThis.sfWorker || globalThis.sf || {};
  const prefs = bridge.prefs || {
    get: async () => ({}),
    set: async () => ({}),
  };

  /* ------------------------------------------------------------------ *
   * Network: the extension could reach sketchfab.com thanks to host
   * permissions. Electron renderers cannot (no CORS headers on the embed
   * page), so engine requests to Sketchfab hosts are tunneled through the
   * main process as sfnet://… — the request itself is unchanged otherwise.
   * ------------------------------------------------------------------ */
  const SF_HOSTS = /^https?:\/\/(www\.|media\.|static\.)?sketchfab\.com\//i;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function desktopFetch(input, init) {
    let target = "";
    if (typeof input === "string") target = input;
    else if (input && typeof input.url === "string") target = input.url;
    if (target && SF_HOSTS.test(target)) {
      const proxied = "sfnet://" + target.replace(/^https?:\/\//i, "");
      try {
        return realFetch(proxied, init);
      } catch (_) {
        /* fall through to the plain request */
      }
    }
    return realFetch(input, init);
  };

  globalThis.chrome = {
    runtime: {
      id: "sketchfab-downloader-desktop",
      lastError: undefined,
      /** app://bundle/<path> — mirrors chrome.runtime.getURL(rel) */
      getURL(rel) {
        const clean = String(rel || "").replace(/^\/+/, "");
        return new URL("../" + clean, location.href).href;
      },
      onMessage: { addListener() {}, removeListener() {}, hasListener: () => false },
      sendMessage: async () => ({ ok: false, error: "no background worker in desktop app" }),
      connect() {
        throw new Error("runtime ports are not available in the desktop app");
      },
    },
    storage: {
      local: {
        get: (keys) => prefs.get(keys),
        set: (obj) => prefs.set(obj),
        remove: async () => {},
        clear: async () => {},
      },
      session: { get: async () => ({}), set: async () => {} },
    },
    i18n: {
      getUILanguage: () => navigator.language || "en",
      getMessage: (k) => k,
    },
  };
})();
