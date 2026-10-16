# NOTICE

## Third-party code

### sketchfab-downloader-extension (engine)
`app/lib/**` (pipeline, sf-api, decrypt, descramble, orm, osgjs2gltf, skin,
zip, i18n, settings, devlog, ui-*, run-download, save*) and the visual design /
UI strings of `app/ui/**` originate from the browser extension
<https://github.com/seryi882/sketchfab-downloader-extension>
Copyright (C) 2026 seryi882 — GNU GPL v3.0.

Only difference from the upstream files: `async function packOrmMaps` was
changed to `export async function packOrmMaps` in `lib/pipeline.js` so the 3D
preview can reuse it. Everything else is byte-identical to the extension's
v1.0 sources.

### three.js
`app/vendor/three/**` — three.js r169, MIT license (see
`app/vendor/three/LICENSE`). The addon modules under `app/vendor/three/jsm/`
had their bare `from 'three'` import specifier rewritten to a relative path so
the app needs no import map (Electron's CSP forbids inline scripts).

### Electron
Runtime and packaging: Electron (MIT) and electron-builder (MIT).

## License of this application

GNU GPL v3.0 — see LICENSE. The desktop wrapper (main process, worker window,
preview panel, Windows save flow) is released under the same license, which is
required because it links the GPL-licensed engine above.
