# Sketchfab Public Downloader — Desktop (Windows 10/11)

**v1.0**

**Language / Язык:** **English** | [Русский](README.ru.md)

Desktop build of the [sketchfab-downloader-extension](https://github.com/seryi882/sketchfab-downloader-extension)
(Manifest V3, v1.0). **Same engine, same design language** — but a real Windows
app: paste a link → a **3D preview of the model builds on the right** → press
Download → when the archive is ready the **Explorer save dialog asks where to
put it**, and Explorer opens with the finished ZIP.

Public Sketchfab models → **glTF (`.glb`) ZIP**. No account, no login, no API
token — the decryption key is auto-extracted from the live viewer.

- 🧩 Everything the v1.0 extension does (mesh, textures, descramble, ORM packing, rigs/animations, bulk queue, dev mode, EN/RU/ZH, light/dark theme)
- 🎮 **Side 3D preview** (ModHUB-style): the model alone, no site chrome, drag to rotate
- 📂 **Explorer save dialog**, then Explorer reveals the saved file
- 🖥️ NSIS installer + portable `.exe`

![Main window](docs/screenshot-main.png)

![Settings](docs/screenshot-settings.png)

---

## What's different from the browser extension

| | Extension | This app |
|---|---|---|
| Runs in | a sketchfab.com tab | its own window, no site needed |
| Model link | the active tab | input box / Ctrl+V / drag a link onto the window |
| 3D preview | — | right-hand panel: orbit, zoom, pan, wireframe, grid, auto-rotate, PNG snapshot |
| Saving | browser download | **Explorer save dialog** (after/before download) + reveal in folder |
| WebGL capture | content-script hooks | not needed: the engine fetches and descrambles maps itself |

Everything else is identical: full archive or **GLB only**, texture size
(Original / ≤2K / ≤4K), PNG/JPEG descramble (incl. 4K/8K), metal+roughness →
**ORM**, skins/bones/animations, `info.json`, `README.txt`, `download-log.txt`
in dev mode, three UI languages, two themes.

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

## Install

1. Grab **`Sketchfab-Public-Downloader-Setup-1.0.0-win-x64.exe`** (NSIS) or the
   portable `Sketchfab Public Downloader-portable-1.0.0.exe`.
2. Run the installer → Install (no admin rights required, install folder is
   selectable).
3. Desktop and Start-menu shortcuts are created.

> The binaries are not code-signed, so SmartScreen may show "Unknown publisher"
> → More info → Run anyway.

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
| Download textures | Off | After "Apply settings"; the ZIP name then ends with `-textures` |
| Dev mode | Off | After "Apply settings"; detailed log + `download-log.txt` in the ZIP |
| Theme | Light | Immediately |
| Language | System (EN / RU / ZH) | Immediately |
| Archive | Full | Immediately; "GLB only" keeps `.glb`, `README.txt`, `info.json` |
| Texture size | Original | Immediately; Original = largest map, ≤2K/≤4K only if chosen |
| Save dialog | After download | Immediately |
| Open Explorer | On | Immediately |
| Auto-build preview | On | Immediately (otherwise use Rebuild) |
| Preview textures | On | Immediately (≤ 1K per map) |
| Save folder / bulk folder | Downloads | Chosen with a button |

Preferences live in `%APPDATA%\Sketchfab Public Downloader\prefs.json`.

---

## Bulk download

The **Bulk** tab: paste a list of links or UIDs (one per line) → choose a folder
→ "Download all". Models are fetched one by one with a per-item status; Explorer
opens when the queue finishes. "Stop after current" interrupts the queue.

---

## Development

Requirements: **Node.js 18+** (tested on 20), Windows 10/11.

```bash
npm install     # electron + electron-builder
npm start       # run from source
npm run dist    # Windows installer + portable build → dist/
```

Engine smoke test without any UI:

```bash
node tools/node-probe.mjs "https://sketchfab.com/3d-models/…" --textures
```

Debug flags:

```bash
npm start -- "https://sketchfab.com/3d-models/…"      # open a link right away
npm start -- --tab=bulk                               # start on a tab
npm start -- --selftest="<url>"                       # headless engine/preview check
npm start -- --shot=docs/shot.png --shot-delay=30000  # capture the window, then exit
```

### Project layout

```
app/
├── main/                # windows, app:// + sfnet:// protocols, dialogs, Explorer, bulk queue
├── shim.js              # chrome.* stand-in for the engine + sfnet request proxy
├── lib/                 # ⚠ ENGINE FROM THE EXTENSION (GPL-3.0), files kept 1:1
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

* `app/lib/*` is the **same code** as in the extension repository (the only edit:
  `packOrmMaps` is exported so the preview packs ORM maps exactly like the ZIP).
  Engine fixes from the extension can therefore be copied over file by file.
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

## License & credits

* This app is released under **GNU GPL v3.0** ([LICENSE](LICENSE)), like the
  extension whose engine it embeds.
* Engine, UI design and i18n strings: **sketchfab-downloader-extension**,
  Copyright (C) 2026 seryi882 (GPL-3.0).
* **three.js** r169 — MIT (`app/vendor/three/LICENSE`).
* **Electron** — MIT.

Copyright (C) 2026 seryi882
