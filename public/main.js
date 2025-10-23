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
renderer.xr.enabled = true; // Enable WebXR
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

// Player rig: move/rotate this instead of orbiting camera
const player = new THREE.Group();
const yawPivot = new THREE.Group(); // rotate this for in-place turning
player.add(yawPivot);
yawPivot.add(camera);
scene.add(player);

// Desktop OrbitControls (auto-disabled while in XR)
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(-5, 5, 12);
player.position.set(-5, 0, 12); // roughly match camera Z so switching to XR feels consistent
camera.layers.enable(1);
controls.target.set(-1, 2, 0);
controls.update();

// WebXR entry button
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
// Mouse raycasting
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
    if (obj.material?.color) obj.material.color = new THREE.Color(Math.random(), Math.random(), Math.random());
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

// Hands: we only read joints (no external meshes)
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
  pinchThreshold: 0.025,                        // meters: index-tip ↔ thumb-tip
  handDeadzone: 0.005,                          // meters in camera space to ignore jitter
  rotGain: 2.0,                                 // yaw gain per meter of hand X movement (camera space)
  moveGain: 20.0                                // scalar mapping hand Z motion to speed strength
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
function isPinchingThreshold(hand) {
  const a = jointWorldPos(hand, 'index-finger-tip', new THREE.Vector3());
  const b = jointWorldPos(hand, 'thumb-tip', new THREE.Vector3());
  return (a && b) ? a.distanceTo(b) < NAV.pinchThreshold : false;
}

// --- AVP gesture state: lock to the first hand that pinches
let activeHandIndex = null; // 0 = left, 1 = right, null = none
const handState = [
  { pinching: false, prevLocal: new THREE.Vector3(), currLocal: new THREE.Vector3() },
  { pinching: false, prevLocal: new THREE.Vector3(), currLocal: new THREE.Vector3() }
];

// Attach pinch listeners to lock/unlock the active hand
hands.forEach((hand, i) => {
  hand.addEventListener('pinchstart', () => {
    handState[i].pinching = true;
    if (activeHandIndex === null) {
      // Lock to the first hand that starts pinching
      activeHandIndex = i;
      // Initialize previous position in camera-local space
      const world = jointWorldPos(hand, 'index-finger-tip', new THREE.Vector3());
      if (world) {
        handState[i].prevLocal.copy(world).applyMatrix4(camera.matrixWorldInverse);
      }
    }
  });
  hand.addEventListener('pinchend', () => {
    handState[i].pinching = false;
    if (activeHandIndex === i) {
      activeHandIndex = null; // release lock
    }
  });
});

// ---------------------------
// XR locomotion per frame
// ---------------------------
function updateXRMovement(dt) {
  const session = renderer.xr.getSession?.();
  if (!session) return;

  // QUEST / controller sticks (XRStandardGamepad)
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp || !gp.axes) continue;

    // Common mapping: [0,1]=left stick (x,y), [2,3]=right stick (x,y)
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
      player.position.addScaledVector(right,  LX * NAV.strafeSpeed * dt);
    }
    // Smooth yaw turn
    if (RX) {
      yawPivot.rotation.y -= RX * NAV.rotateSpeed * dt;
    }
  }

  // AVP / hands (natural input: pinch + move gesture on locked hand)
  if (activeHandIndex !== null) {
    const i = activeHandIndex;
    const hand = hands[i];
    if (handState[i].pinching && isPinchingThreshold(hand)) {
      // index-tip in camera-local space (stable axes)
      const world = jointWorldPos(hand, 'index-finger-tip', new THREE.Vector3());
      if (world) {
        handState[i].currLocal.copy(world).applyMatrix4(camera.matrixWorldInverse);

        // Camera-space deltas
        const dx = handState[i].currLocal.x - handState[i].prevLocal.x; // left(-)/right(+)
        const dz = handState[i].currLocal.z - handState[i].prevLocal.z; // towards camera(+)/away(-)

        // Deadzone to reduce jitter
        const rx = Math.abs(dx) > NAV.handDeadzone ? dx : 0;
        const mz = Math.abs(dz) > NAV.handDeadzone ? dz : 0;

        // Horizontal hand motion -> rotate in place
        // Positive dx (move hand right in view) => rotate right (negative yaw)
        if (rx !== 0) {
          yawPivot.rotation.y += (-rx) * NAV.rotGain;
        }

        // Forward/back hand motion -> move along gaze
        if (mz !== 0) {
          const fwd = headForwardXZ();
          const sign = (mz < 0) ? +1 : -1; // push (negative dz) = forward, pull (positive dz) = backward
          const strength = Math.min(1.0, Math.abs(mz) * NAV.moveGain);
          player.position.addScaledVector(fwd, sign * NAV.moveSpeed * strength * dt);
        }

        // Update previous
        handState[i].prevLocal.copy(handState[i].currLocal);
      }
    } else {
      // If pinch released but we didn't get pinchend (edge cases), unlock
      activeHandIndex = null;
    }
  }
}

// ---------------------------
// Animation loop (XR + desktop)
// ---------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    if (controls.enabled) controls.enabled = false; // disable desktop Orbit in XR
    updateXRMovement(dt);
    renderer.render(scene, camera);
  } else {
    if (!controls.enabled) controls.enabled = true;
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
