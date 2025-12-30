import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import RAPIER from "@dimforge/rapier3d-compat";

// ---------- init rapier ----------
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// Keep a list of dynamic bodies to sync to Three meshes
const dynamic = []; // { mesh, body }

// ---------- scene / camera / renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 2.0, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.xr.enabled = true;

document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

// ---------- lights ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(6, 10, 8);
scene.add(sun);

// ---------- VR rig (everything visual goes in here) ----------
const rig = new THREE.Group();
rig.position.set(0, 0, -2.2);
scene.add(rig);

// We'll treat Rapier world as "global", so convert rig-local <-> world positions.
const RIG_OFFSET = rig.position.clone();

function toWorldPos(x, y, z) {
  return { x: x + RIG_OFFSET.x, y: y + RIG_OFFSET.y, z: z + RIG_OFFSET.z };
}
function toLocalPos(p) {
  return { x: p.x - RIG_OFFSET.x, y: p.y - RIG_OFFSET.y, z: p.z - RIG_OFFSET.z };
}

// ---------- board params (meters) ----------
const BOARD_W = 2.2;
const BOARD_H = 2.6;

const PEG_ROWS = 10;
const PEG_COLS = 10;
const PEG_R = 0.03;

const BIN_COUNT = PEG_COLS + 1;

const BALL_R = 0.06; // start smaller than 0.1 for stability
const BALL_Z = 0.12; // where balls/pegs live (depth lane)
const PEG_Z = 0.08;

const FLOOR_Y = 0.15;

// ---------- Rapier helper builders ----------
function addFixedCuboid(localX, localY, localZ, hx, hy, hz, opts = {}) {
  const wp = toWorldPos(localX, localY, localZ);

  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(wp.x, wp.y, wp.z)
  );

  const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setFriction(opts.friction ?? 0.7)
    .setRestitution(opts.restitution ?? 0.1);

  world.createCollider(col, rb);
  return rb;
}

function addFixedBall(localX, localY, localZ, r, opts = {}) {
  const wp = toWorldPos(localX, localY, localZ);

  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(wp.x, wp.y, wp.z)
  );

  const col = RAPIER.ColliderDesc.ball(r)
    .setFriction(opts.friction ?? 0.5)
    .setRestitution(opts.restitution ?? 0.2);

  world.createCollider(col, rb);
  return rb;
}

function addDynamicBall(mesh, localX, localY, localZ, r, opts = {}) {
  const wp = toWorldPos(localX, localY, localZ);

  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setLinearDamping(opts.linearDamping ?? 0.05)
      .setAngularDamping(opts.angularDamping ?? 0.8)
      .setCcdEnabled(true)
      .setCanSleep(true)
  );

  const col = RAPIER.ColliderDesc.ball(r)
    .setDensity(opts.density ?? 1.0)
    .setFriction(opts.friction ?? 0.45)
    .setRestitution(opts.restitution ?? 0.08);

  world.createCollider(col, rb);

  dynamic.push({ mesh, body: rb });
  return rb;
}

// ---------- Visual floor + physics floor ----------
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  rig.add(floor);

  // Physics floor (big thin box)
  addFixedCuboid(0, 0.0, 0.0, 10, 0.02, 10, { friction: 0.9, restitution: 0.05 });
}

// ---------- Backboard (visual + physics thin slab) ----------
{
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1c2541, roughness: 0.8 })
  );
  back.position.set(0, BOARD_H / 2 + 0.35, -0.02);
  rig.add(back);

  addFixedCuboid(
    0,
    BOARD_H / 2 + 0.35,
    -0.04,
    BOARD_W / 2,
    BOARD_H / 2,
    0.01
  );
}

// ---------- Pegs (visual + physics spheres) ----------
const pegs = [];
{
  const pegGeom = new THREE.SphereGeometry(PEG_R, 16, 16);
  const pegMat = new THREE.MeshStandardMaterial({ color: 0xffc857, roughness: 0.55 });

  const topY = BOARD_H + 0.35 - 0.25;
  const usableH = BOARD_H - 0.55;
  const rowSpacing = usableH / PEG_ROWS;
  const colSpacing = BOARD_W / PEG_COLS;

  for (let r = 0; r < PEG_ROWS; r++) {
    for (let c = 0; c < PEG_COLS; c++) {
      const offset = r % 2 === 0 ? 0 : colSpacing / 2;
      const x = c * colSpacing - BOARD_W / 2 + offset + colSpacing / 2;
      const y = topY - r * rowSpacing;

      if (x < -BOARD_W / 2 + 0.08 || x > BOARD_W / 2 - 0.08) continue;

      const peg = new THREE.Mesh(pegGeom, pegMat);
      peg.position.set(x, y, PEG_Z);
      rig.add(peg);
      pegs.push(peg);

      addFixedBall(x, y, PEG_Z, PEG_R, { friction: 0.4, restitution: 0.15 });
    }
  }
}

// ---------- Bins / divider walls (visual + physics) ----------
{
  const binW = BOARD_W / BIN_COUNT;

  // Make them shallow in Z so balls don't get "inside" the wall volume
  const wallVisual = new THREE.BoxGeometry(0.01, 0.35, 0.18);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 0.7 });

  for (let i = 0; i <= BIN_COUNT; i++) {
    const x = -BOARD_W / 2 + i * binW;

    const wall = new THREE.Mesh(wallVisual, wallMat);
    wall.position.set(x, 0.3, BALL_Z);
    rig.add(wall);

    // physics: cuboid half-extents
    addFixedCuboid(x, 0.3, BALL_Z, 0.005, 0.175, 0.09, {
      friction: 0.6,
      restitution: 0.05,
    });
  }

  // Physics "lip" floor where bins start (optional but helps settle)
  addFixedCuboid(0, FLOOR_Y - 0.02, BALL_Z, BOARD_W / 2, 0.02, 0.14, {
    friction: 0.95,
    restitution: 0.02,
  });
}

// ---------- Side walls to keep balls on the board ----------
{
  const limit = BOARD_W / 2 - 0.03;
  const wallH = BOARD_H;
  const wallY = BOARD_H / 2 + 0.35;

  // Left & right vertical containment
  addFixedCuboid(-limit, wallY, BALL_Z, 0.02, wallH / 2, 0.14);
  addFixedCuboid(+limit, wallY, BALL_Z, 0.02, wallH / 2, 0.14);
}

// ---------- Balls (Rapier dynamics) ----------
function spawnBall() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x6ec1ff, roughness: 0.65 })
  );

  const x = (Math.random() - 0.5) * (BOARD_W * 0.35); // x-spread
  const y = BOARD_H + 1;
  const z = BALL_Z;

  ball.position.set(x, y, z);
  rig.add(ball);

  const body = addDynamicBall(ball, x, y, z, BALL_R);

  // tiny impulse so identical drops don't stack perfectly
  // body.applyImpulse({ x: (Math.random() - 0.5) * 0.15, y: 0, z: 0 }, true);

  // cap total
  if (dynamic.length > 250) {
    const old = dynamic.shift();
    rig.remove(old.mesh);
    world.removeRigidBody(old.body);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

// Space to spawn one
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") spawnBall();
});

// Batch spawner
async function spawnBatch(n, delayMs = 200) {
  for (let i = 0; i < n; i++) {
    spawnBall();
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
spawnBatch(30, 350);

// ---------- resize ----------
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener("resize", onResize);
onResize();

// ---------- fixed-timestep physics + render loop ----------
let acc = 0;
const FIXED_DT = 1 / 60;

function stepPhysics(dt) {
  world.timestep = dt;
  world.step();

  for (const o of dynamic) {
    const p = o.body.translation();
    const q = o.body.rotation();
    const lp = toLocalPos(p);

    o.mesh.position.set(lp.x, lp.y, lp.z);
    o.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }
}

let prevTime = 0;
renderer.setAnimationLoop((t) => {
  const now = t / 1000;
  const dt = Math.min(0.05, prevTime ? now - prevTime : 0);
  prevTime = now;
  acc += dt;
  while (acc >= FIXED_DT) {
    stepPhysics(FIXED_DT);
    acc -= FIXED_DT;
  }

  controls.update();
  renderer.render(scene, camera);
});
