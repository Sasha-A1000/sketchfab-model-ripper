const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

function createStore(userData) {
  const filename = require.resolve("../app/main/store.js");
  delete require.cache[filename];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath(name) {
            if (name === "userData") return userData;
            if (name === "downloads") return path.join(userData, "Downloads");
            throw new Error(`unexpected app path: ${name}`);
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(filename);
  } finally {
    Module._load = originalLoad;
  }
}

function makeUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sf-prefs-test-"));
}

function readPrefs(userData) {
  return JSON.parse(fs.readFileSync(path.join(userData, "prefs.json"), "utf8"));
}

test("legacy flat settings migrate without losing values or runtime keys", () => {
  const userData = makeUserData();
  try {
    fs.writeFileSync(
      path.join(userData, "prefs.json"),
      JSON.stringify({
        sf_download_textures: true,
        sf_theme: "dark",
        sf_lang: "ru",
        sf_dev_mode: true,
        sf_pack_mode: "glb",
        sf_max_texture_edge: 4096,
        sf_static_key: "keep-static-key",
        sf_last_log: "keep-last-log",
        desktop: {
          askWhereToSave: false,
          openFolderAfterSave: false,
          previewTextures: false,
          previewAutoStart: false,
          lastSaveDir: "C:/models",
          bulkDir: "C:/bulk",
        },
      }),
    );

    const store = createStore(userData);
    const data = store.all();
    assert.deepEqual(data.sf_prefs, {
      textures: true,
      theme: "dark",
      lang: "ru",
      devMode: true,
      packMode: "glb",
      maxTextureEdge: 4096,
    });
    assert.deepEqual(data.desktop, {
      saveMode: "auto",
      openFolderAfterSave: false,
      previewTextures: false,
      previewAutoStart: false,
      lastSaveDir: "C:/models",
      bulkDir: "C:/bulk",
      window: null,
    });
    assert.equal(data.sf_static_key, "keep-static-key");
    assert.equal(data.sf_last_log, "keep-last-log");
    for (const key of [
      "sf_download_textures",
      "sf_theme",
      "sf_lang",
      "sf_dev_mode",
      "sf_pack_mode",
      "sf_max_texture_edge",
    ]) {
      assert.equal(Object.hasOwn(data, key), false, `${key} must be migrated`);
    }

    const persisted = readPrefs(userData);
    assert.deepEqual(persisted.sf_prefs, data.sf_prefs);
    assert.equal(persisted.desktop.saveMode, "auto");
    assert.equal(Object.hasOwn(persisted.desktop, "askWhereToSave"), false);
    assert.equal(Object.hasOwn(persisted, "sf_download_textures"), false);
    assert.equal(persisted.sf_static_key, "keep-static-key");
    assert.equal(persisted.sf_last_log, "keep-last-log");
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("explicit canonical false values beat stale flat values; none maps to auto", () => {
  const userData = makeUserData();
  try {
    fs.writeFileSync(
      path.join(userData, "prefs.json"),
      JSON.stringify({
        sf_prefs: {
          textures: false,
          theme: "light",
          lang: "en",
          devMode: false,
          packMode: "full",
          maxTextureEdge: 2048,
        },
        sf_download_textures: true,
        sf_theme: "dark",
        sf_dev_mode: true,
        desktop: {
          saveMode: "none",
          openFolderAfterSave: false,
          previewTextures: false,
          previewAutoStart: true,
          lastSaveDir: "C:/saved",
          bulkDir: "C:/bulk",
          window: { width: 900 },
        },
      }),
    );

    const store = createStore(userData);
    const prefs = store.get("sf_prefs").sf_prefs;
    assert.equal(prefs.textures, false);
    assert.equal(prefs.theme, "light");
    assert.equal(prefs.devMode, false);
    assert.equal(prefs.maxTextureEdge, 2048);
    assert.equal(store.getDesktop().saveMode, "auto");
    assert.deepEqual(store.getDesktop().window, { width: 900 });

    const persisted = readPrefs(userData);
    assert.equal(persisted.sf_prefs.textures, false);
    assert.equal(persisted.desktop.saveMode, "auto");
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("legacy aliases inside sf_prefs migrate into canonical property names", () => {
  const userData = makeUserData();
  try {
    fs.writeFileSync(
      path.join(userData, "prefs.json"),
      JSON.stringify({
        sf_prefs: {
          downloadTextures: false,
          sf_theme: "dark",
          sf_lang: "ru",
          sf_dev_mode: true,
          sf_pack_mode: "glb",
          sf_max_texture_edge: 2048,
        },
        desktop: { askWhereToSave: true },
      }),
    );

    const store = createStore(userData);
    assert.deepEqual(store.get("sf_prefs").sf_prefs, {
      textures: false,
      theme: "dark",
      lang: "ru",
      devMode: true,
      packMode: "glb",
      maxTextureEdge: 2048,
    });
    assert.equal(store.getDesktop().saveMode, "after");

    const persisted = readPrefs(userData);
    for (const alias of [
      "downloadTextures",
      "sf_theme",
      "sf_lang",
      "sf_dev_mode",
      "sf_pack_mode",
      "sf_max_texture_edge",
    ]) {
      assert.equal(Object.hasOwn(persisted.sf_prefs, alias), false);
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("canonical writes round-trip desktop options without flat duplicates", () => {
  const userData = makeUserData();
  try {
    const store = createStore(userData);
    assert.equal(store.getDesktop().saveMode, "after");
    assert.equal(store.getDesktop().openFolderAfterSave, true);
    assert.equal(store.getDesktop().previewTextures, true);
    assert.equal(store.getDesktop().previewAutoStart, true);
    store.set({
      sf_prefs: {
        textures: true,
        theme: "dark",
        lang: "zh",
        devMode: true,
        packMode: "glb",
        maxTextureEdge: 2048,
      },
      sf_static_key: "runtime-key",
    });
    store.setDesktop({
      saveMode: "before",
      openFolderAfterSave: false,
      previewTextures: false,
      previewAutoStart: false,
      lastSaveDir: "D:/assets",
      bulkDir: "D:/bulk",
    });

    const data = readPrefs(userData);
    assert.deepEqual(data.sf_prefs, {
      textures: true,
      theme: "dark",
      lang: "zh",
      devMode: true,
      packMode: "glb",
      maxTextureEdge: 2048,
    });
    assert.equal(data.desktop.saveMode, "before");
    assert.equal(data.desktop.openFolderAfterSave, false);
    assert.equal(data.desktop.previewTextures, false);
    assert.equal(data.desktop.previewAutoStart, false);
    assert.equal(data.desktop.lastSaveDir, "D:/assets");
    assert.equal(data.desktop.bulkDir, "D:/bulk");
    assert.equal(data.sf_static_key, "runtime-key");
    assert.equal(Object.hasOwn(data, "sf_download_textures"), false);
    assert.equal(Object.hasOwn(data, "sf_theme"), false);
    assert.equal(Object.hasOwn(data, "sf_dev_mode"), false);

    const reopened = createStore(userData);
    assert.deepEqual(reopened.get("sf_prefs").sf_prefs, data.sf_prefs);
    assert.deepEqual(reopened.getDesktop(), data.desktop);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
