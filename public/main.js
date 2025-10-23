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
renderer.xr.enabled = true; // ← enable WebXR
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

// Player rig (move/rotate this instead of orbiting camera)
const player = new THREE.Group();
const yawPivot = new THREE.Group(); // rotate this for in-place turning
player.add(yawPivot);
yawPivot.add(camera);
scene.add(player);

// Desktop OrbitControls (auto-disabled in XR)
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(-5, 5, 12);
player.position.set(-5, 0, 12);
camera.layers.enable(1);
controls.target.set(-1, 2, 0);
controls.update();

// XR button
document.body.appendChild(
  XRButton.createButton(renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'layers']
  })
);

// -------------
// Scene lights
// -------------
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(2, 5, 10);
light.castShadow = true;
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.1));

// --------------------
// Your scene geometry
// --------------------
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

// ----------------------
// Raycasting (unchanged)
// ----------------------
const raycaster = new THREE.Raycaster();
document.addEventListener('mousedown', onMouseDown);

function onMouseDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const coords = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  );
  raycaster.setFromCamera(coords, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (hits.length > 0) {
    const obj = hits[0].object;
    obj.material.color = new THREE.Color(Math.random(), Math.random(), Math.random());
    console.log(`${obj.name} was clicked!`);
  }
}

// ---------------------------
// XR controllers + hands
// ---------------------------
const controllerFactory = new XRControllerModelFactory();
const controllers = [0, 1].map((i) => {
  const ctrl = renderer.xr.getController(i);
  scene.add(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);
  return { ctrl, grip };
});

// Hands: we only read joints (no external meshes needed)
const hands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];
hands.forEach(h => scene.add(h));

// ---------------------------
// Locomotion helpers & params
// ---------------------------
const NAV = {
  moveSpeed: 2.2,                               // m/s
  strafeSpeed: 2.0,                             // m/s
  rotateSpeed: THREE.MathUtils.degToRad(100),   // rad/s
  stickDeadzone: 0.15,
  pinchThreshold: 0.025                         // meters: index-tip ↔ thumb-tip
};

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function headForwardXZ() {
  camera.getWorldDirection(tmpV);
  tmpV.y = 0;
  if (tmpV.lengthSq() === 0) tmpV.set(0, 0, -1);
  return tmpV.normalize();
}
function headRightXZ() {
  camera.matrixWorld.decompose(new THREE.Vector3(), tmpQ, new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ);
  right.y = 0;
  return right.normalize();
}

function jointWorldPos(hand, name, out = new THREE.Vector3()) {
  const j = hand?.joints?.[name];
  return j ? j.getWorldPosition(out) : null;
}
function isPinching(hand) {
  const a = jointWorldPos(hand, 'index-finger-tip', new THREE.Vector3());
  const b = jointWorldPos(hand, 'thumb-tip', new THREE.Vector3());
  return (a && b) ? a.distanceTo(b) < NAV.pinchThreshold : false;
}
// Left-hand rotation rate from lateral offset of left index tip vs head
function leftHandRotateRate() {
  const left = hands[0];
  const idx = jointWorldPos(left, 'index-finger-tip', new THREE.Vector3());
  if (!idx) return 0;
  const head = camera.getWorldPosition(new THREE.Vector3());
  const right = headRightXZ();
  const toIdx = new THREE.Vector3().subVectors(idx, head); toIdx.y = 0;
  if (toIdx.lengthSq() === 0) return 0;
  toIdx.normalize();
  const lateral = right.dot(toIdx); // -1..1 (left..right)
  const dz = 0.15;
  if (Math.abs(lateral) < dz) return 0;
  return (lateral - Math.sign(lateral) * dz) / (1 - dz); // -1..1
}

// ---------------------------
// XR locomotion per frame
// ---------------------------
function updateXRMovement(dt) {
  const session = renderer.xr.getSession?.();
  if (!session) return;

  // Quest 3: controller sticks (XRStandardGamepad)
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp || !gp.axes) continue;

    // Common mapping: [0,1] = left stick (x,y), [2,3] = right stick (x,y)
    const lsx = gp.axes[0] ?? 0;
    const lsy = gp.axes[1] ?? 0;
    const rsx = gp.axes[2] ?? 0;

    const dz = NAV.stickDeadzone;
    const LX = Math.abs(lsx) < dz ? 0 : lsx;
    const LY = Math.abs(lsy) < dz ? 0 : lsy;
    const RX = Math.abs(rsx) < dz ? 0 : rsx;

    // Move head-relative
    if (LX || LY) {
      const fwd = headForwardXZ();
      const right = headRightXZ();
      player.position.addScaledVector(fwd, -LY * NAV.moveSpeed * dt);
      player.position.addScaledVector(right, LX * NAV.strafeSpeed * dt);
    }
    // Smooth yaw turn
    if (RX) {
      yawPivot.rotation.y -= RX * NAV.rotateSpeed * dt;
    }
  }

  // Apple Vision Pro: natural input (hands)
  const left = hands[0], right = hands[1];
  const leftPinch = left && isPinching(left);
  const rightPinch = right && isPinching(right);

  // Right-hand pinch → move forward (gaze direction)
  if (rightPinch) {
    const fwd = headForwardXZ();
    player.position.addScaledVector(fwd, NAV.moveSpeed * dt);
  }
  // Left-hand pinch → rotate in place
  if (leftPinch) {
    const rate = leftHandRotateRate(); // -1..1
    yawPivot.rotation.y += rate * NAV.rotateSpeed * dt;
  }
}

// ---------------------------
// Animation loop (XR + desktop)
// ---------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    if (controls.enabled) { controls.enabled = false; }
    updateXRMovement(dt);
    renderer.render(scene, camera);
  } else {
    if (!controls.enabled) { controls.enabled = true; }
    controls.update();
    renderer.render(scene, camera);
  }
});

// ---------------------------
// Resize
// ---------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});
