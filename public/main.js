import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ---------------------------
// Renderer / Scene / Camera
// ---------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x222230);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true; // WebXR ON
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Lights
const light = new THREE.DirectionalLight();
light.intensity = 2;
light.position.set(2, 5, 10);
light.castShadow = true;
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.1));

// Camera
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

// Desktop OrbitControls (disabled during XR)
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(-5, 5, 12);
camera.layers.enable(1);
controls.target.set(-1, 2, 0);
controls.update();

// XR button
document.body.appendChild(
  XRButton.createButton(renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking'] // harmless if not available
  })
);

// ---------------------------
/* Dolly rig for locomotion: move/rotate this, not the camera directly */
const dolly = new THREE.Group();
scene.add(dolly);
const yawPivot = new THREE.Group();
dolly.add(yawPivot);
yawPivot.add(camera);
// Seed near your desktop pose so the transition feels consistent
dolly.position.set(-5, 0, 12);

// ---------------------------
// Your original scene content
// ---------------------------
const floorGeometry = new THREE.PlaneGeometry(25, 20);
const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 2);
const material = new THREE.MeshLambertMaterial();

const floorMesh = new THREE.Mesh(
  floorGeometry,
  new THREE.MeshLambertMaterial({ color: 0xffffff })
);
floorMesh.rotation.x = -Math.PI / 2.0;
floorMesh.name = 'Floor';
floorMesh.receiveShadow = true;
scene.add(floorMesh);

function createMesh(geometry, material, x, y, z, name, layer) {
  const mesh = new THREE.Mesh(geometry, material.clone());
  mesh.position.set(x, y, z);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.layers.set(layer);
  return mesh;
}

const cylinders = new THREE.Group();
cylinders.add(createMesh(cylinderGeometry, material, 3, 1, 0, 'Cylinder A', 0));
cylinders.add(createMesh(cylinderGeometry, material, 4.2, 1, 0, 'Cylinder B', 0));
cylinders.add(createMesh(cylinderGeometry, material, 3.6, 3, 0, 'Cylinder C', 0));
scene.add(cylinders);

const boxes = new THREE.Group();
boxes.add(createMesh(boxGeometry, material, -1, 1, 0, 'Box A', 0));
boxes.add(createMesh(boxGeometry, material, -4, 1, 0, 'Box B', 0));
boxes.add(createMesh(boxGeometry, material, -2.5, 3, 0, 'Box C', 0));
scene.add(boxes);

// ---------------------------
// Mouse raycasting (unchanged)
// ---------------------------
const raycaster = new THREE.Raycaster();

document.addEventListener('mousedown', onMouseDown);

function onMouseDown(event) {
  const coords = new THREE.Vector2(
    (event.clientX / renderer.domElement.clientWidth) * 2 - 1,
    -((event.clientY / renderer.domElement.clientHeight) * 2 - 1)
  );

  raycaster.setFromCamera(coords, camera);

  const intersections = raycaster.intersectObjects(scene.children, true);
  if (intersections.length > 0) {
    const selectedObject = intersections[0].object;
    const color = new THREE.Color(Math.random(), Math.random(), Math.random());
    selectedObject.material.color = color;
    console.log(`${selectedObject.name} was clicked!`);
  }
}

// ---------------------------
// XR controllers + models
// ---------------------------
const controllerFactory = new XRControllerModelFactory();

const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
scene.add(controller1, controller2);

const controllerGrip1 = renderer.xr.getControllerGrip(0);
const controllerGrip2 = renderer.xr.getControllerGrip(1);
controllerGrip1.add(controllerFactory.createControllerModel(controllerGrip1));
controllerGrip2.add(controllerFactory.createControllerModel(controllerGrip2));
scene.add(controllerGrip1, controllerGrip2);

function controllerVisual(data) {
  if (!data) return null;
  if (data.targetRayMode === 'tracked-pointer') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,-1], 3));
    const m = new THREE.LineBasicMaterial({ color: 0x88aaff });
    return new THREE.Line(g, m);
  }
  if (data.targetRayMode === 'gaze') {
    const ring = new THREE.RingGeometry(0.02, 0.04, 32).translate(0, 0, -1);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true });
    return new THREE.Mesh(ring, m);
  }
  return null;
}

[controller1, controller2].forEach((ctrl) => {
  ctrl.addEventListener('connected', (e) => {
    ctrl.userData.inputSource = e.data;
    const vis = controllerVisual(e.data);
    if (vis) ctrl.add(vis);
  });
  ctrl.addEventListener('disconnected', () => {
    ctrl.userData.inputSource = null;
    ctrl.clear();
  });
  ctrl.addEventListener('selectstart', function(){ this.userData.isSelecting = true;  });
  ctrl.addEventListener('selectend',   function(){ this.userData.isSelecting = false; });
});

// ---------------------------
// AVP navigation helpers
// ---------------------------
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const NAV = {
  moveSpeed: 2.0,   // speed with axes (trackpad-like)
  stepSpeed: 300.0,   // speed while holding Select (pinch) with no axes
  deadzone: 0.12
};

function isVisionProInputSource(inputSource) {
  if (!inputSource) return false;
  if (inputSource.handedness === 'none') return true;
  const profiles = inputSource.profiles || [];
  return profiles.some(p => {
    const s = p.toLowerCase();
    return s.includes('vision') || s.includes('hand') || s.includes('touch');
  });
}

const controllerStates = {
  left:  { axes: { x:0, y:0 }, isVision:false, input:null },
  right: { axes: { x:0, y:0 }, isVision:false, input:null }
};

function resetStates() {
  controllerStates.left.axes.x = 0; controllerStates.left.axes.y = 0;
  controllerStates.right.axes.x = 0; controllerStates.right.axes.y = 0;
  controllerStates.left.isVision = controllerStates.right.isVision = false;
  controllerStates.left.input = controllerStates.right.input = null;
}

function updateInputStates(frame) {
  resetStates();
  if (!frame) return;
  const session = frame.session;
  if (!session) return;

  session.inputSources.forEach(src => {
    const gp = src.gamepad;
    if (!gp) return;
    const handed = src.handedness;
    const isVP = isVisionProInputSource(src);

    let x = 0, y = 0;
    if (gp.axes && gp.axes.length >= 2) {
      x = gp.axes[0] || 0;
      y = gp.axes[1] || 0;
    }

    const st = handed === 'left' ? controllerStates.left : controllerStates.right;
    st.axes.x = x; st.axes.y = y;
    st.isVision = isVP;
    st.input = src;

    // If AVP reports 'none', mirror to left slot so we always read something
    if (handed === 'none' && isVP) {
      controllerStates.left.axes.x = x;
      controllerStates.left.axes.y = y;
      controllerStates.left.isVision = true;
      controllerStates.left.input = src;
    }
  });
}

const tmpV = new THREE.Vector3();
function headForwardXZ() {
  camera.getWorldDirection(tmpV);
  tmpV.y = 0;
  if (tmpV.lengthSq() === 0) tmpV.set(0,0,-1);
  return tmpV.normalize();
}

// Axes-based motion (prefer this when present). For AVP, Y-only for comfort.
function applyAVPAxes(dt) {
  const L = controllerStates.left.axes;
  const dz = NAV.deadzone;

  let x = Math.abs(L.x) < dz ? 0 : L.x;
  let y = Math.abs(L.y) < dz ? 0 : L.y;

  // If left has nothing but right has AVP axes, mirror from right
  if (!x && !y && controllerStates.right.isVision) {
    const R = controllerStates.right.axes;
    x = Math.abs(R.x) < dz ? 0 : R.x;
    y = Math.abs(R.y) < dz ? 0 : R.y;
  }

  if (!x && !y) return false;

  // AVP: forward/back only (no strafe)
  const forward = headForwardXZ();
  dolly.position.addScaledVector(forward, -y * NAV.moveSpeed * dt);
  return true;
}

// Select-held stepping: forward along the active controller's ray (flattened)
function applyAVPSelectStep(dt) {
  // If any axes are active, prefer axes path
  const axesActive =
    Math.hypot(controllerStates.left.axes.x, controllerStates.left.axes.y) > NAV.deadzone ||
    Math.hypot(controllerStates.right.axes.x, controllerStates.right.axes.y) > NAV.deadzone;
  if (axesActive) return;

  [controller1, controller2].forEach(ctrl => {
    if (!ctrl?.userData?.isSelecting) return;
    const src = ctrl.userData.inputSource;
    if (!isVisionProInputSource(src)) return;

    const dir = new THREE.Vector3();
    ctrl.getWorldDirection(dir);

    // If forward feels inverted in your rig, toggle the next line:
    // dir.negate();

    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    dolly.position.addScaledVector(dir, NAV.stepSpeed * dt);
  });
}

// ---------------------------
// Animation loop
// ---------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    if (controls.enabled) controls.enabled = false;

    updateInputStates(frame);

    const usedAxes = applyAVPAxes(dt);
    if (!usedAxes) applyAVPSelectStep(dt);
  } else {
    if (!controls.enabled) controls.enabled = true;
    controls.update();
  }

  renderer.render(scene, camera);
});

// ---------------------------
// Resize
// ---------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});
