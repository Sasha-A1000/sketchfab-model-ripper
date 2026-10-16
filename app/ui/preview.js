/**
 * 3D preview panel — the "ModHUB-style" side view.
 *
 * Renders the GLB the worker produces (stage 1 mesh, stage 2 with textures)
 * in a plain canvas scene: drag to rotate, wheel to zoom, right-drag to pan.
 * Textures/ORM packs are already embedded in the GLB, so nothing here talks
 * to the network.
 */
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "../vendor/three/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "../vendor/three/jsm/environments/RoomEnvironment.js";

const FALLBACK_W = 16;
const FALLBACK_H = 10;

function disposeMaterial(mat) {
  if (!mat) return;
  const maps = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "emissiveMap",
    "alphaMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularColorMap",
    "specularIntensityMap",
    "transmissionMap",
    "thicknessMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
  ];
  for (const key of maps) {
    const tex = mat[key];
    if (tex && tex.isTexture) tex.dispose();
  }
  mat.dispose();
}

function disposeObject(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
      else disposeMaterial(o.material);
    }
  });
}

export function createPreview(canvas, opts = {}) {
  const stage = canvas.parentElement;
  const onStats = typeof opts.onStats === "function" ? opts.onStats : () => {};
  const onError = typeof opts.onError === "function" ? opts.onError : () => {};

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
  } catch (e) {
    onError(`WebGL is not available: ${e && e.message ? e.message : e}`);
  }
  if (!renderer) {
    return {
      unavailable: true,
      loadGlb: async () => {},
      resize() {},
      resetView() {},
      setWireframe() {},
      setGrid() {},
      setAutoRotate() {},
      savePng: async () => ({ ok: false, error: "no WebGL" }),
      dispose() {},
    };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    FALLBACK_W / FALLBACK_H,
    0.01,
    20000,
  );
  camera.position.set(2.6, 1.9, 3.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.minDistance = 0.02;
  controls.maxDistance = 20000;
  controls.autoRotateSpeed = 1.1;

  // three-point studio lighting + soft ambient
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(3.5, 5, 4);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-4.5, 2, -3);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25);
  rim.position.set(0, -2, -5);
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2f3a, 0.35);
  scene.add(key, fill, rim, hemi);

  // PBR environment so metals/glass don't look flat
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
  } catch (_) {}

  let grid = new THREE.GridHelper(10, 20, 0x7c8ba1, 0x9aa8bd);
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  grid.position.y = 0;
  scene.add(grid);
  let gridOn = true;

  const loader = new GLTFLoader();
  let modelRoot = null;
  let mixer = null;
  let wireframeOn = false;
  let loadToken = 0;

  const clock = new THREE.Clock();
  let running = true;

  function resize() {
    const w = Math.max(1, Math.floor(stage.clientWidth));
    const h = Math.max(1, Math.floor(stage.clientHeight));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function applyWireframe(on) {
    wireframeOn = on;
    if (!modelRoot) return;
    modelRoot.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ("wireframe" in m) m.wireframe = on;
      }
    });
  }

  function fitToObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.4 / maxDim;
    obj.scale.multiplyScalar(scale);
    obj.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(obj);
    const center = box2.getCenter(new THREE.Vector3());
    obj.position.x -= center.x;
    obj.position.z -= center.z;
    obj.position.y -= box2.min.y;
    obj.updateMatrixWorld(true);

    const box3 = new THREE.Box3().setFromObject(obj);
    const size3 = box3.getSize(new THREE.Vector3());
    const radius = Math.max(size3.x, size3.y, size3.z) * 0.5 || 1;

    // fit on the binding axis (a wide diorama must not look tiny in a wide panel)
    const fovY = (camera.fov * Math.PI) / 180;
    const fovX =
      2 * Math.atan(Math.tan(fovY / 2) * Math.max(camera.aspect, 0.2));
    const distY = size3.y / 2 / Math.sin(fovY / 2);
    const distX = size3.x / 2 / Math.sin(fovX / 2);
    const distZ = size3.z / 2 / Math.sin(fovY / 2);
    const dist = Math.max(distX, distY, distZ) * 1.35;

    controls.target.set(0, size3.y * 0.45, 0);
    const dir = new THREE.Vector3(0.5, 0.42, 1).normalize();
    camera.position.copy(dir.multiplyScalar(dist)).add(controls.target);
    camera.near = Math.max(0.005, radius / 400);
    camera.far = Math.max(500, radius * 400);
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(0.01, radius * 0.35);
    controls.maxDistance = Math.max(10, radius * 40);
    controls.update();

    const gridSize = Math.max(2.2, Math.max(size3.x, size3.z) * 1.9);
    grid.scale.setScalar(gridSize / 10);
  }

  function countStats(root) {
    let meshes = 0;
    let tris = 0;
    let verts = 0;
    const mats = new Set();
    root.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      meshes++;
      const g = o.geometry;
      if (g) {
        const pos = g.attributes && g.attributes.position;
        if (pos) verts += pos.count;
        if (g.index) tris += g.index.count / 3;
        else if (pos) tris += pos.count / 3;
      }
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          mats.add(m.uuid),
        );
      }
    });
    return { meshes, tris: Math.round(tris), verts, materials: mats.size };
  }

  /**
   * Load a preview GLB.
   * @param {string} url app://media/… (written by the worker)
   * @param {{stage?:string, keepCamera?:boolean}} o
   */
  async function loadGlb(url, o = {}) {
    const token = ++loadToken;
    const keepCamera = !!o.keepCamera && !!modelRoot;
    const gltf = await loader.loadAsync(url);
    if (token !== loadToken) {
      // a newer model replaced this one while it was loading
      disposeObject(gltf.scene);
      return null;
    }

    const prevCamPos = camera.position.clone();
    const prevTarget = controls.target.clone();

    if (modelRoot) {
      scene.remove(modelRoot);
      disposeObject(modelRoot);
      modelRoot = null;
    }
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
    }

    modelRoot = gltf.scene;
    modelRoot.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if ("wireframe" in m) m.wireframe = wireframeOn;
          m.side = THREE.DoubleSide;
        }
      }
      if (o.isMesh) {
        o.frustumCulled = true;
        // our GLB puts textures in the base colour / normal slots already
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    scene.add(modelRoot);

    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.play();
      }
    }

    if (keepCamera) {
      modelRoot.updateMatrixWorld(true);
      camera.position.copy(prevCamPos);
      controls.target.copy(prevTarget);
      controls.update();
    } else {
      fitToObject(modelRoot);
    }

    onStats(countStats(modelRoot));
    return gltf;
  }

  function resetView() {
    if (modelRoot) fitToObject(modelRoot);
  }

  function setGrid(on) {
    gridOn = !!on;
    grid.visible = gridOn;
  }

  function setAutoRotate(on) {
    controls.autoRotate = !!on;
  }

  function setBackground(mode) {
    // "none" keeps the CSS gradient visible behind a transparent renderer
    if (mode === "none") {
      scene.background = null;
      renderer.setClearAlpha(0);
      return;
    }
    const col = mode === "dark" ? 0x0d1626 : 0xe9eef7;
    renderer.setClearAlpha(1);
    scene.background = new THREE.Color(col);
  }

  async function savePng() {
    renderer.render(scene, camera);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return { ok: false, error: "canvas.toBlob failed" };
    const buf = new Uint8Array(await blob.arrayBuffer());
    return window.sf.savePng(buf, `sketchfab-preview-${Date.now()}.png`);
  }

  function dispose() {
    running = false;
    ro.disconnect();
    controls.dispose();
    if (modelRoot) disposeObject(modelRoot);
    grid.geometry.dispose();
    grid.material.dispose();
    renderer.dispose();
  }

  return {
    unavailable: false,
    loadGlb,
    resize,
    resetView,
    setWireframe: applyWireframe,
    setGrid,
    setAutoRotate,
    setBackground,
    savePng,
    dispose,
    hasModel: () => !!modelRoot,
  };
}
