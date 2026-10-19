import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const section = document.getElementById("comparison");
if (!section) throw new Error("Mesh comparison section not found");

const entries = [...section.querySelectorAll(".viewer-surface")];
const presetButtons = [...section.querySelectorAll("[data-view]")];
const rotateButton = document.getElementById("rotate-toggle");
const resetButton = document.getElementById("camera-reset");
const clayButton = document.getElementById("material-clay");
const normalsButton = document.getElementById("material-normals");

const target = new THREE.Vector3(0, 0, 0);
const initialOrbit = { theta: 0, phi: Math.PI / 2, radius: 4.3 };
const orbit = { ...initialOrbit };
const directions = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };
const spherical = new THREE.Spherical();
const clay = new THREE.MeshStandardMaterial({
  color: 0xadb5c0,
  roughness: 0.93,
  metalness: 0,
  side: THREE.DoubleSide
});
const normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
const viewers = [];
const loader = new GLTFLoader();

let activeMaterial = clay;
let synchronizing = false;
let renderQueued = false;
let autoRotating = false;
let animationFrame = 0;
let previousTime = null;

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    for (const item of viewers) {
      if (!item.ready) continue;
      item.renderer.render(item.scene, item.camera);
    }
  });
}

function setPreset(name) {
  for (const button of presetButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === name));
  }
}

function synchronizeCameras() {
  synchronizing = true;
  spherical.set(orbit.radius, orbit.phi, orbit.theta);
  for (const item of viewers) {
    item.camera.position.setFromSpherical(spherical);
    item.camera.lookAt(target);
    item.controls.update();
  }
  synchronizing = false;
  scheduleRender();
}

function stopAutoRotate() {
  autoRotating = false;
  previousTime = null;
  cancelAnimationFrame(animationFrame);
  rotateButton.textContent = "Auto rotate";
  rotateButton.setAttribute("aria-pressed", "false");
}

function rotateFrame(now) {
  if (!autoRotating) return;
  if (previousTime !== null) {
    orbit.theta += Math.min(now - previousTime, 100) * 0.00018;
    synchronizeCameras();
  }
  previousTime = now;
  animationFrame = requestAnimationFrame(rotateFrame);
}

function changeMaterial(which) {
  activeMaterial = which === "normals" ? normals : clay;
  for (const item of viewers) {
    for (const mesh of item.meshes) mesh.material = activeMaterial;
  }
  clayButton.setAttribute("aria-pressed", String(which === "clay"));
  normalsButton.setAttribute("aria-pressed", String(which === "normals"));
  scheduleRender();
}

function resize(item) {
  const width = Math.max(1, Math.round(item.canvas.clientWidth));
  const height = Math.max(1, Math.round(item.canvas.clientHeight));
  if (item.width === width && item.height === height) return;
  item.width = width;
  item.height = height;
  item.renderer.setSize(width, height, false);
  item.camera.aspect = width / height;
  item.camera.updateProjectionMatrix();
  scheduleRender();
}

function studioScene(scene) {
  scene.background = new THREE.Color(0xf2f5f9);
  // A subdued hemispheric fill plus three directional lights makes small
  // surface folds legible without washing out the geometry.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x737e91, 0.62));

  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-3.5, 5.0, 6.0);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe9efff, 0.43);
  fill.position.set(4.0, 1.0, 2.5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.85);
  rim.position.set(2.0, 3.0, -5.0);
  scene.add(rim);
}

for (const surface of entries) {
  const canvas = surface.querySelector(".viewer-canvas");
  const status = surface.querySelector(".viewer-status");
  const card = surface.closest(".viewer-card");
  const error = card.querySelector(".viewer-error");

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false
    });
  } catch (reason) {
    status.textContent = "WebGL unavailable in this browser. You can download the GLB below.";
    continue;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  studioScene(scene);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
  camera.position.set(0, 0, initialOrbit.radius);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 1.8;
  controls.maxDistance = 9;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI - 0.1;
  controls.target.copy(target);
  controls.update();

  const item = {
    canvas, status, error, renderer, scene, camera, controls,
    meshes: [], ready: false, width: 0, height: 0
  };
  viewers.push(item);

  controls.addEventListener("change", () => {
    if (synchronizing) return;
    stopAutoRotate();
    setPreset(null);
    spherical.setFromVector3(camera.position.clone().sub(controls.target));
    orbit.theta = spherical.theta;
    orbit.phi = spherical.phi;
    orbit.radius = spherical.radius;
    synchronizeCameras();
  });

  const observer = new ResizeObserver(() => resize(item));
  observer.observe(canvas);
  resize(item);

  const path = canvas.dataset.src;
  loader.load(
    path,
    (asset) => {
      const root = asset.scene;
      // GT is +X-forward. The other three meshes are +Z-forward.
      if (canvas.dataset.model === "gt") root.rotation.y = -Math.PI / 2;
      root.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.geometry.getAttribute("normal")) {
          child.geometry.computeVertexNormals();
        }
        child.material = activeMaterial;
        item.meshes.push(child);
      });
      scene.add(root);
      item.ready = true;
      status.hidden = true;
      resize(item);
      synchronizeCameras();
    },
    undefined,
    (reason) => {
      status.hidden = true;
      error.hidden = false;
      console.warn("3D model load failed:", path, reason);
    }
  );
}

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    stopAutoRotate();
    orbit.theta = directions[button.dataset.view];
    orbit.phi = Math.PI / 2;
    setPreset(button.dataset.view);
    synchronizeCameras();
  });
});

resetButton.addEventListener("click", () => {
  stopAutoRotate();
  Object.assign(orbit, initialOrbit);
  setPreset("front");
  synchronizeCameras();
});

rotateButton.addEventListener("click", () => {
  if (autoRotating) {
    stopAutoRotate();
  } else {
    autoRotating = true;
    previousTime = null;
    setPreset(null);
    rotateButton.textContent = "Pause rotation";
    rotateButton.setAttribute("aria-pressed", "true");
    animationFrame = requestAnimationFrame(rotateFrame);
  }
});

clayButton.addEventListener("click", () => changeMaterial("clay"));
normalsButton.addEventListener("click", () => changeMaterial("normals"));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAutoRotate();
});
synchronizeCameras();
