# NOTICE

## Third-party code

### seryi882/sketchfab-downloader-extension (engine and UI)

`app/lib/**` is derived from the `main` branch of
<https://github.com/seryi882/sketchfab-downloader-extension> (verified at
commit `79290fa`), including the rig pipeline in `lib/skin.js` and the WASM
asset `lib/wasm/decrypt.wasm`. The old `v1.0` tag is not the source baseline.

The desktop adaptation adds Windows/Electron UI strings to `app/lib/i18n.js`
and exports `packOrmMaps` from `app/lib/pipeline.js` for reuse by the preview.
The upstream JavaScript files were formatted with Prettier; formatting was not
intended to change behavior. `app/ui/**` retains and adapts the extension's
visual design and strings for the desktop window, alongside the desktop-specific
3D preview.

Copyright (C) 2026 seryi882 — GNU GPL v3.0. See the unmodified `LICENSE` file.

### three.js

`app/vendor/three/**` — three.js r169, MIT license (see
`app/vendor/three/LICENSE`). The addon modules under `app/vendor/three/jsm/`
had their bare `from 'three'` import specifier rewritten to a relative path so
the app needs no import map (Electron's CSP forbids inline scripts). The
upstream minified `three.module.min.js` distribution is intentionally left
minified and otherwise unmodified.

### Electron and electron-builder

Runtime and packaging tools are Electron and electron-builder, both distributed
under the MIT license.

## License of this application

GNU GPL v3.0 — see `LICENSE`. The desktop wrapper (main process, worker window,
preview panel, and Windows save flow) is released under the same license because
it incorporates and links the GPL-licensed engine above.
