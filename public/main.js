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

// Lights (as before)
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
    optionalFeatures: ['hand-tracking'] // harmless if not present
  })
);

// ---------------------------
// Dolly rig for locomotion
// ---------------------------
const dolly = new THREE.Group();
scene.add(dolly);

const yawPivot = new THREE.Group(); // keep in case you later want rotation
dolly.add(yawPivot);
yawPivot.add(camera);

// Start dolly near your desktop camera pose (so switching feels consistent)
dolly.position.set(-5, 0, 12);



// --- XRDebugHUD: head-locked text panel for WebXR debugging ---
class XRDebugHUD {
  constructor(camera, {
    width = 512,
    height = 384,
    pxPerLine = 22,
    scale = 0.35,             // world size of the panel (meters-ish)
    offset = new THREE.Vector3(0.0, -0.08, -0.6) // relative to camera
  } = {}) {
    this.camera = camera;
    this.width = width;
    this.height = height;
    this.pxPerLine = pxPerLine;
    this.offset = offset.clone();

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true
    });
    const geo = new THREE.PlaneGeometry(scale, scale * (height / width));
    this.mesh = new THREE.Mesh(geo, mat);

    // Head-locked: attach to the camera and offset a little in view
    this.camera.add(this.mesh);
    this.mesh.position.copy(this.offset);
  }

  setLines(lines) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // semi-transparent dark background
    ctx.fillStyle = 'rgba(10,12,18,0.7)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.font = '16px monospace';
    ctx.fillStyle = '#bfe3ff';
    ctx.textBaseline = 'top';

    let y = 8;
    for (const line of lines) {
      ctx.fillText(String(line), 8, y);
      y += this.pxPerLine;
      if (y > this.height - this.pxPerLine) break; // avoid overflow
    }

    this.texture.needsUpdate = true;
  }
}
// After yawPivot.add(camera);
const hud = new XRDebugHUD(camera); // head-locked debug panel





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

// Minimal visuals per inputSource
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
  moveSpeed: 2.0,   // m/s for axes
  stepSpeed: 10.0,   // meters per second-equivalent while Select-held w/ no axes
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
    if (!gp) return; // AVP transient-pointer still exposes axes as a "gamepad"
    const handed = src.handedness;
    const isVP = isVisionProInputSource(src);

    // prefer [0,1], some devices may put "right pad" on [2,3]
    let x = 0, y = 0;
    if (gp.axes && gp.axes.length >= 2) {
      x = gp.axes[0] || 0;
      y = gp.axes[1] || 0;
    }

    const st = handed === 'left' ? controllerStates.left : controllerStates.right;
    st.axes.x = x; st.axes.y = y;
    st.isVision = isVP;
    st.input = src;

    // If AVP reports handedness "none", mirror into left slot for simplicity
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
function headRightXZ() {
  return new THREE.Vector3().crossVectors(WORLD_UP, headForwardXZ()).negate().normalize();
}

function applyAVPAxes(dt) {
  const L = controllerStates.left.axes;
  const isVP = controllerStates.left.isVision || controllerStates.right.isVision;

  const dz = NAV.deadzone;
  let x = Math.abs(L.x) < dz ? 0 : L.x;
  let y = Math.abs(L.y) < dz ? 0 : L.y;

  // If AVP only reports axes on the "right", mirror from right
  if (!x && !y && controllerStates.right.isVision) {
    const R = controllerStates.right.axes;
    x = Math.abs(R.x) < dz ? 0 : R.x;
    y = Math.abs(R.y) < dz ? 0 : R.y;
  }

  if (!x && !y) return false;

  const forward = headForwardXZ();
  const before = dolly.position.clone();
  // AVP: forward/back only (no strafe)
  dolly.position.addScaledVector(forward, -y * NAV.moveSpeed * dt);

  const delta = dolly.position.clone().sub(before);
  const lines = [
    'AXES LOCOMOTION',
    `L axes: x=${controllerStates.left.axes.x.toFixed(2)} y=${controllerStates.left.axes.y.toFixed(2)}`,
    `R axes: x=${controllerStates.right.axes.x.toFixed(2)} y=${controllerStates.right.axes.y.toFixed(2)}`,
    `headFwdXZ: (${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`,
    `deltaPos: (${delta.x.toFixed(3)}, ${delta.y.toFixed(3)}, ${delta.z.toFixed(3)})`,
    `dt=${dt.toFixed(3)}  moveSpeed=${NAV.moveSpeed}  (VP=${isVP})`
  ];
  hud.setLines(lines);

  return true;
}


function applyAVPSelectStep(dt) {
  // If any axes are active, prefer axes instead of select-to-move
  const anyAxes =
    Math.hypot(controllerStates.left.axes.x, controllerStates.left.axes.y) > NAV.deadzone ||
    Math.hypot(controllerStates.right.axes.x, controllerStates.right.axes.y) > NAV.deadzone;

  if (anyAxes) {
    // Show axes on HUD even if we early-return
    hud.setLines([
      'AXES ACTIVE (prefer axes path)',
      `L axes: x=${controllerStates.left.axes.x.toFixed(2)} y=${controllerStates.left.axes.y.toFixed(2)}`,
      `R axes: x=${controllerStates.right.axes.x.toFixed(2)} y=${controllerStates.right.axes.y.toFixed(2)}`,
      `dt: ${dt.toFixed(3)}  speed(step): ${NAV.stepSpeed}`
    ]);
    return;
  }

  // Helper to stringify a vector
  const fmtV = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

  // Gather per-controller debug and perform forward stepping
  const lines = [];
  const headFwd = headForwardXZ();
  lines.push(`dt: ${dt.toFixed(3)}  stepSpeed: ${NAV.stepSpeed}`);
  lines.push(`headFwdXZ: ${fmtV(headFwd)}`);

  [controller1, controller2].forEach((ctrl, i) => {
    const isSel = !!ctrl?.userData?.isSelecting;
    const src = ctrl?.userData?.inputSource;
    const isVP = isVisionProInputSource(src);

    let dir = new THREE.Vector3();
    if (isSel && isVP) {
      ctrl.getWorldDirection(dir);   // forward already
      const dirXZ = dir.clone(); dirXZ.y = 0; dirXZ.normalize();
      const dot = dirXZ.dot(headFwd); // +1 means along head forward, -1 opposite

      // Move forward along that ray (grounded)
      if (dirXZ.lengthSq() > 0) {
        dolly.position.addScaledVector(dirXZ, NAV.stepSpeed * dt);
      }

      lines.push(`C${i}: SELECT held (VP=${isVP})`);
      lines.push(`  rayDir: ${fmtV(dir)}`);
      lines.push(`  rayDirXZ: ${fmtV(dirXZ)}  dot(head)= ${dot.toFixed(2)}  (forward if > 0)`);
    } else {
      lines.push(`C${i}: select=${isSel} VP=${isVP}`);
    }
  });

  hud.setLines(lines);
}


// ---------------------------
// Animation loop
// ---------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    if (controls.enabled) controls.enabled = false;

    // Update controller/axes each XR frame
    updateInputStates(frame);

    // AVP navigation: axes if available, otherwise Select-held stepping
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
