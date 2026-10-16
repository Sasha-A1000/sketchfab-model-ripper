# Sketchfab Public Downloader — Desktop (Windows 10/11)

**Application version: [latest release](https://github.com/Sasha-A1000/sketchfab-portable-downloader/releases/latest)**

**Language / Язык:** **English** | [Русский](README.ru.md)

Desktop build based on the current `main` branch of
[seryi882/sketchfab-downloader-extension](https://github.com/seryi882/sketchfab-downloader-extension)
(including its rig/animation pipeline; not the old `v1.0` tag). **Same engine,
same design language** — but a real Windows app: paste a link → a **3D preview
of the model builds on the right** → press Download → when the archive is ready
the **Explorer save dialog asks where to put it**, and Explorer opens with the
finished ZIP.

Public Sketchfab models → **glTF (`.glb`) ZIP**. No account, no login, no API
token — the decryption key is auto-extracted from the live viewer.

- 🧩 Upstream main-branch pipeline (mesh, textures, descramble, ORM packing, rigs/animations, bulk queue, dev mode, EN/RU/ZH, light/dark theme)
- 🎮 **Side 3D preview** (ModHUB-style): the model alone, no site chrome, drag to rotate
- 📂 **Explorer save dialog**, then Explorer reveals the saved file
- 🖥️ Single-file Windows x64 portable `.exe` — no installer

---

## What's different from the browser extension

| | Extension | This app |
|---|---|---|
| Runs in | a sketchfab.com tab | its own window, no site needed |
| Model link | the active tab | input box / Ctrl+V / drag a link onto the window |
| 3D preview | — | right-hand panel: orbit, zoom, pan, wireframe, grid, auto-rotate, PNG snapshot |
| Saving | browser download | **Explorer save dialog** (after/before download) + reveal in folder |
| WebGL capture | content-script hooks | not needed: the engine fetches and descrambles maps itself |

Core pipeline features include full archive or **GLB only**, texture size
(Original / ≤2K / ≤4K), PNG/JPEG descramble (incl. 4K/8K), metal+roughness →
**ORM**, skins/bones/animations, `info.json`, `README.txt`, `download-log.txt`
in dev mode, three UI languages, and two themes.

---

## 3D preview

* The model is built **in the background** while you look at the metadata card —
  the panel on the right, with no Sketchfab UI around it.
* **Two stages:** a fast mesh first (usually 1–3 s after decryption), then
  textures are added automatically (≤ 1K per map, so the preview stays light).
  The badge in the panel header shows the current stage.
* Controls: **drag — rotate**, **wheel — zoom**, **right-drag — pan**.
* Buttons: `Textures`, `Rebuild`, `Wireframe`, `Floor grid`, `Auto-rotate`,
  `Reset view`, `Save PNG`, `Fullscreen` (Esc exits).
* GLB animations play automatically when the model has them.
* The preview renders the very same `.glb` the worker hands to the archiver.

---

## Saving: the Explorer dialog

Settings → "Windows app" → **Save dialog**:

| Mode | Behaviour |
|---|---|
| **After download** (default) | Press Download → the engine builds the whole ZIP → the **Explorer "Save as" dialog opens** → the file is written where you pointed → Explorer opens with the file selected |
| Before download | the dialog appears immediately (Chrome-like) |
| No dialog | the file lands silently in the last used folder (Downloads by default) |

**"Open Explorer with the saved file"** is on by default. If you close the save
dialog, the app offers to keep the ready archive in the downloads folder or
discard it.

---

## Run the portable build

Download the portable exe from the **[latest release](https://github.com/Sasha-A1000/sketchfab-portable-downloader/releases/latest)** page and run it.
It is a single-file portable build; there is no installer or setup wizard. The
portable launcher may unpack application files into a temporary directory while
it runs. Preferences remain in `%APPDATA%\Sketchfab Public Downloader`.

> The executable is not code-signed, so SmartScreen may show "Unknown publisher"
> → More info → Run anyway.

When redistributing the executable, include a link to this public source
repository: <https://github.com/Sasha-A1000/sketchfab-portable-downloader>.

---

## How to download a model

1. Open the app and paste a **public** model link
   (`https://sketchfab.com/3d-models/…`) — the Paste button, Ctrl+V, or drag a
   link onto the window. You can also pass it as an argument:
   `Sketchfab Public Downloader.exe "https://sketchfab.com/3d-models/…"`.
2. The 3D preview starts building on the right; the metadata card (author,
   polygon counts, license, thumbnail) fills in on the left.
3. Adjust options if needed: **Settings → Download textures → Apply settings**.
4. Press **Download this model** and watch the progress bar / log.
5. Pick a folder in the Explorer dialog — the file is saved and revealed.

Blender: **File → Import → glTF 2.0** → open the `.glb`, then **Z → Material
Preview** (Solid mode hides textures).

---

## Settings

| Setting | Default | When it applies |
|---|---|---|
| Download textures (`sf_prefs.textures`) | Off | After **Apply settings**; ZIP name gets `-textures`; maps are embedded in the GLB and kept separately in Full mode |
| Dev mode (`sf_prefs.devMode`) | Off | After **Apply settings**; detailed log + `download-log.txt` in the ZIP |
| Theme (`sf_prefs.theme`) | Light | Immediately |
| Language (`sf_prefs.lang`) | English (EN / RU / ZH) | Immediately |
| Archive (`sf_prefs.packMode`) | Full | Immediately; **GLB only** keeps `.glb`, `README.txt`, `info.json` (enabled textures stay embedded in the GLB) |
| Texture size (`sf_prefs.maxTextureEdge`) | Original | Immediately; `0` = original, `2048` / `4096` cap maps only when textures are on |
| Save dialog (`desktop.saveMode`) | After download | Immediately; `after`, `before`, or `auto` (no dialog, save to the last folder) |
| Open Explorer (`desktop.openFolderAfterSave`) | On | Immediately; affects the next completed save |
| Auto-build preview (`desktop.previewAutoStart`) | On | Immediately; controls automatic preview when a link is entered |
| Preview textures (`desktop.previewTextures`) | On | Immediately; changing it rebuilds the current preview (≤ 1K per map) |
| Save folder (`desktop.lastSaveDir`) / bulk folder (`desktop.bulkDir`) | Downloads | Chosen with a button; the last save folder is remembered |

Preferences live in `%APPDATA%\Sketchfab Public Downloader\prefs.json`. Engine settings have one canonical `sf_prefs` object; Windows-only settings live in `desktop`. Older flat `sf_*` values and `desktop.askWhereToSave` are migrated on launch, preserving explicit `false` values. The old `none` save mode is normalized to `auto`.

---

## Bulk download

The **Bulk** tab: paste a list of links or UIDs (one per line) → choose a folder
→ "Download all". Models are fetched one by one with a per-item status; Explorer
opens when the queue finishes. "Stop after current" interrupts the queue.

---

## Development and build

Requirements: **Node.js 22.12+** (Electron 44.8.0), npm, and Windows 10/11 for
running the application. The portable target can be built with electron-builder
on a supported host.

```bash
npm install                 # install the pinned Electron/build dependencies
npm test                    # mock tests for preferences, migration and descriptions
npm start                   # run from source
npm run dist:portable       # Windows x64 portable EXE → dist/
```

`npm run dist` is an alias for the same portable-only build; no installer target
is configured. The build explicitly packages `app/**/*` and `icons/**/*`,
including `app/lib/wasm/decrypt.wasm`.

Debug flags:

```bash
npm start -- "https://sketchfab.com/3d-models/…"   # open a link right away
npm start -- --tab=bulk                            # start on a tab
npm start -- --selftest="<url>"                    # engine/preview self-test
npm start -- --shot=shot.png --shot-delay=30000    # capture the window, then exit
```

### Project layout

```
app/
├── main/                # windows, app:// + sfnet:// protocols, dialogs, Explorer, bulk queue
├── shim.js              # chrome.* stand-in for the engine + sfnet request proxy
├── lib/                 # ⚠ engine based on upstream main (GPL-3.0), plus desktop adaptations
│   ├── pipeline.js      # viewer → key → WASM → textures → GLB → ZIP
│   └── wasm/decrypt.wasm
├── worker/worker.js     # hidden window: probe / preview (2 stages) / download → file
├── ui/                  # index.html, ui.css, ui.js, preview.js (three.js panel)
└── vendor/three/        # three.js r169 (MIT), bundled locally
```

The extension ran heavy work in an offscreen document (4K texture packs kill a
service worker); here that role belongs to the **hidden worker window**, keeping
the UI light — network and filesystem live in the main process.

### Implementation notes

* `app/lib/**` is based on the extension repository's current `main` branch,
  not its older `v1.0` tag. The desktop adds translated UI strings in `i18n.js`
  and exports `packOrmMaps` from `pipeline.js` so the preview can reuse it.
  Engine changes are formatted with Prettier; formatting does not intentionally
  alter runtime behavior.
* Requests to `sketchfab.com` / `media.sketchfab.com` / `static.sketchfab.com`
  go through the internal `sfnet://` scheme (the main process adds the Referer
  and CORS headers) — Electron renderers have no host permissions.
* The page-world WebGL capture hooks (`viewer-inject.js`, `webgl-hook.js`) are
  not used: there is no site tab. Public maps are fetched and descrambled with
  the `pk` key anyway, and the preview uses ≤ 1K maps. Rare striped maps that the
  extension rescued via the viewer blit may stay undecoded — the extension
  listed those in `MISSING_BLIT.txt` too.

---

## Troubleshooting

1. Open **Settings → Windows app → "Logs & settings" → "Open logs folder"**
   (`%APPDATA%\Sketchfab Public Downloader`).
2. That folder holds `main.log` (startup, errors, crashes) and `prefs.json`.
   If the app closes silently, the log still has the reason — it can be sent in.
3. Turn on **Settings → Dev mode → Apply settings** to get the detailed pipeline
   log on the Download tab and inside the ZIP (`download-log.txt`).
4. Common causes: private/deleted model; no access to sketchfab.com,
   media.sketchfab.com or static.sketchfab.com; unusual proxy/VPN.

---

## Legal

For personal access to **public** viewer data. Respect
[Sketchfab's terms](https://sketchfab.com/terms) and each model's license.

---

## Based on seryi882/sketchfab-downloader-extension (GPL-3.0)

The engine and parts of the UI originate from the current `main` branch of
[seryi882/sketchfab-downloader-extension](https://github.com/seryi882/sketchfab-downloader-extension),
including `lib/skin.js` and `lib/wasm/decrypt.wasm`. The desktop wrapper and
preview adapt that code for Electron. See [NOTICE.md](NOTICE.md) for the
component-level notes and [LICENSE](LICENSE) for the unmodified GNU GPL v3 text.

* This app is distributed under **GNU GPL v3.0** ([LICENSE](LICENSE)).
* Upstream project copyright: seryi882 (GPL-3.0).
* **three.js** r169 — MIT (`app/vendor/three/LICENSE`).
* **Electron** and **electron-builder** — MIT.

When sharing a built executable, include a link to this public repository:
<https://github.com/Sasha-A1000/sketchfab-portable-downloader>.

Copyright (C) 2026 seryi882
