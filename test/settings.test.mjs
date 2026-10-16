import assert from "node:assert/strict";
import { test } from "node:test";

let storageData = {};
const storageWrites = [];
const storageReads = [];

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        storageReads.push(copy(keys));
        const requested =
          keys == null
            ? Object.keys(storageData)
            : Array.isArray(keys)
              ? keys
              : [keys];
        const result = {};
        for (const key of requested) {
          if (Object.prototype.hasOwnProperty.call(storageData, key)) {
            result[key] = copy(storageData[key]);
          }
        }
        return result;
      },
      async set(values) {
        storageWrites.push(copy(values));
        Object.assign(storageData, copy(values));
      },
    },
  },
  i18n: { getUILanguage: () => "en-US" },
};

const settings = await import("../app/lib/settings.js");

function resetStore(value = {}) {
  storageData = copy(value);
  storageWrites.length = 0;
  storageReads.length = 0;
}

test("settings read the canonical sf_prefs object, not stale flat mirrors", async () => {
  resetStore({
    sf_prefs: {
      ...settings.DEFAULT_PREFS,
      textures: true,
      devMode: true,
      theme: "dark",
      lang: "ru",
      packMode: "glb",
      maxTextureEdge: 4096,
    },
    sf_download_textures: false,
    sf_theme: "light",
    sf_lang: "en",
    sf_dev_mode: false,
  });

  const prefs = await settings.loadPrefs();
  assert.deepEqual(prefs, {
    textures: true,
    devMode: true,
    theme: "dark",
    lang: "ru",
    packMode: "glb",
    maxTextureEdge: 4096,
  });
  assert.deepEqual(storageReads, ["sf_prefs"]);
});

test("Apply saves one canonical blob and emits the textures job flag", async () => {
  resetStore({ sf_prefs: { ...settings.DEFAULT_PREFS } });

  const prefs = await settings.savePrefs({
    textures: true,
    devMode: true,
    theme: "dark",
    lang: "ru",
    packMode: "glb",
    maxTextureEdge: 4096,
  });

  assert.deepEqual(settings.jobFlagsFromPrefs(prefs), {
    textures: true,
    devMode: true,
    packMode: "glb",
    maxTextureEdge: 4096,
  });

  const offPrefs = await settings.savePrefs({
    textures: false,
    devMode: false,
  });
  assert.equal(settings.jobFlagsFromPrefs(offPrefs).textures, false);
  assert.equal(settings.jobFlagsFromPrefs(offPrefs).devMode, false);
  assert.deepEqual(Object.keys(storageData), ["sf_prefs"]);
  assert.deepEqual(storageWrites, [
    { sf_prefs: prefs },
    { sf_prefs: offPrefs },
  ]);
});

test("dev mode and language read/write through sf_prefs", async () => {
  const devlog = await import("../app/lib/devlog.js");
  const i18n = await import("../app/lib/i18n.js");
  resetStore({
    sf_prefs: { ...settings.DEFAULT_PREFS, devMode: true, lang: "zh" },
  });

  assert.equal(await devlog.isDevMode(), true);
  assert.equal(await i18n.getLang(), "zh");
  assert.equal(await devlog.setDevMode(false), false);
  assert.equal(await i18n.setLang("ru"), "ru");

  assert.equal(storageData.sf_prefs.devMode, false);
  assert.equal(storageData.sf_prefs.lang, "ru");
  assert.deepEqual(Object.keys(storageData), ["sf_prefs"]);
  assert.ok(
    storageWrites.every((write) => Object.keys(write).join() === "sf_prefs"),
  );
});
