import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from "three";

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
const PEG_R = 0.035;

const BIN_COUNT = PEG_COLS + 1;

const BALL_R = 0.057;
const BALL_Z = 0.12;
const PEG_Z = 0.12;

const FLOOR_Y = 0.15;

const BIN_Z = BALL_Z;
const BIN_DEPTH = 0.40;
const BIN_WALL_H = 0.35;

const CLEAR = 0.18;
let boxHalfW = BOARD_W / 2 - 0.03;

// ---------- zone heights ----------
const TOP_Y0 = BOARD_H + 1.25;
const FUNNEL_Y1 = BOARD_H + 0.95;
const THROAT_Y0 = BOARD_H + 0.55;
const THROAT_Y1 = BOARD_H + 0.25;
const PEG_TOP_Y = THROAT_Y1;
const PEG_BOTTOM_Y = FLOOR_Y + 0.60;

const WALL_Z_HALF = 0.14;

const dividerY = (FLOOR_Y + (PEG_BOTTOM_Y - 0.05)) / 2;

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

function quatFromAxisAngle(ax, ay, az, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  return new RAPIER.Quaternion(ax * s, ay * s, az * s, Math.cos(half));
}

function addFixedCuboidRot(localX, localY, localZ, hx, hy, hz, quat, opts = {}) {
  const wp = toWorldPos(localX, localY, localZ);

  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(wp.x, wp.y, wp.z)
      .setRotation(quat)
  );

  const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setFriction(opts.friction ?? 0.7)
    .setRestitution(opts.restitution ?? 0.1);

  world.createCollider(col, rb);
  return rb;
}

function addWallSeg(x1, y1, x2, y2, z = BALL_Z, opts = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const theta = Math.atan2(dy, dx);
  const quat = quatFromAxisAngle(0, 0, 1, theta);

  const hx = len / 2;
  const hy = opts.thickness ?? 0.02;
  const hz = opts.hz ?? WALL_Z_HALF;

  addFixedCuboidRot(cx, cy, z, hx, hy, hz, quat, opts);

  if (opts.visual) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshStandardMaterial({
        color: 0x44ff99,
        transparent: true,
        opacity: 0.25,
      })
    );
    mesh.position.set(cx, cy, z);
    mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    rig.add(mesh);
  }
}

const debugMat = new THREE.LineBasicMaterial();
const debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), debugMat);
rig.add(debugLines);

function updateRapierDebug() {
  const buffers = world.debugRender(); 
  const verts = buffers.vertices;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));

  debugLines.geometry.dispose();
  debugLines.geometry = geom;
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

  addFixedCuboid(
    0,
    0.0,
    BALL_Z,
    6,
    0.03,
    BIN_DEPTH / 2 + 0.35,
    { friction: 0.9, restitution: 0.05 }
  );
}

const ROWS = PEG_ROWS;
const COL_SPACING = 0.25;
const extremePegX = (ROWS - 1) * COL_SPACING * 0.5;
boxHalfW = extremePegX + 0.12;


const pegs = [];
{
  const pegGeom = new THREE.SphereGeometry(PEG_R, 16, 16);
  const pegMat = new THREE.MeshStandardMaterial({ color: 0xffc857, roughness: 0.55 });
  const topY = PEG_TOP_Y;
  const bottomY = PEG_BOTTOM_Y;

  const rowSpacing = (topY - bottomY) / (ROWS - 1);

  for (let r = 0; r < ROWS; r++) {
    const count = r + 1;
    const y = topY - r * rowSpacing;

    const rowW = (count - 1) * COL_SPACING;
    const x0 = -rowW / 2;

    for (let i = 0; i < count; i++) {
      const x = x0 + i * COL_SPACING;

      const peg = new THREE.Mesh(pegGeom, pegMat);
      peg.position.set(x, y, PEG_Z);
      rig.add(peg);
      pegs.push(peg);

      addFixedBall(x, y, PEG_Z, PEG_R, { friction: 0.4, restitution: 0.12 });
    }
  }
}

function pegEdgeHalfWAtY(y) {
  const t = (PEG_TOP_Y - y) / (PEG_TOP_Y - PEG_BOTTOM_Y);
  return t * extremePegX;
}

const PEG_WALL_GAP = 0.192;
const triHalfWAtY = (y) => pegEdgeHalfWAtY(y) + PEG_WALL_GAP;
const throatHalfW = triHalfWAtY(THROAT_Y1);
const funnelHalfWTop = BOARD_W / 2 + 0.02;
const funnelHalfWBot = throatHalfW;

const triHalfWTop = triHalfWAtY(THROAT_Y1);
const triHalfWBottom = triHalfWAtY(PEG_BOTTOM_Y);


// ---------- Backboard (visual + physics thin slab) ----------
{
  const BACK_W = 2 * triHalfWBottom + 0.20;

  const BACK_TOP_Y = TOP_Y0 + 0.20;
  const BACK_BOTTOM_Y = 0.0;

  const BACK_H = BACK_TOP_Y - BACK_BOTTOM_Y;
  const BACK_CY = (BACK_TOP_Y + BACK_BOTTOM_Y) / 2;

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(BACK_W, BACK_H, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1c2541, roughness: 0.8 })
  );
  back.position.set(0, BACK_CY, -0.02);
  rig.add(back);

  addFixedCuboid(
    0,
    BACK_CY,
    -0.02,
    BACK_W / 2,
    BACK_H / 2,
    0.02,
    { friction: 0.6, restitution: 0.05 }
  );
}


// ---------- Connected side walls (funnel , throat , triangle , box) ----------
{
  // LEFT
  addWallSeg(-funnelHalfWTop, TOP_Y0,        -funnelHalfWBot, THROAT_Y0, BALL_Z, { visual: true });
  addWallSeg(-throatHalfW,    THROAT_Y0,     -throatHalfW,    THROAT_Y1, BALL_Z, { visual: true });
  addWallSeg(-triHalfWTop,    THROAT_Y1,     -triHalfWBottom, PEG_BOTTOM_Y, BALL_Z, { visual: true });
  addWallSeg(-triHalfWBottom,       PEG_BOTTOM_Y, -triHalfWBottom, FLOOR_Y, BALL_Z, { visual: true });

  // RIGHT
  addWallSeg(+funnelHalfWTop, TOP_Y0,        +funnelHalfWBot, THROAT_Y0, BALL_Z, { visual: true });
  addWallSeg(+throatHalfW,    THROAT_Y0,     +throatHalfW,    THROAT_Y1, BALL_Z, { visual: true });
  addWallSeg(+triHalfWTop,    THROAT_Y1,     +triHalfWBottom, PEG_BOTTOM_Y, BALL_Z, { visual: true });
  addWallSeg(+triHalfWBottom,       PEG_BOTTOM_Y, +triHalfWBottom, FLOOR_Y, BALL_Z, { visual: true });
}

{
  // back wall (closer to backboard)
  addFixedCuboid(0, FLOOR_Y + BIN_WALL_H / 2, BIN_Z - BIN_DEPTH / 2,
    triHalfWBottom, BIN_WALL_H / 2, 0.01,
    { friction: 0.7, restitution: 0.05 }
  );

  // front wall (prevents rolling toward camera)
  addFixedCuboid(0, FLOOR_Y + BIN_WALL_H / 2, BIN_Z + BIN_DEPTH / 2,
    triHalfWBottom, BIN_WALL_H / 2, 0.01,
    { friction: 0.7, restitution: 0.05 }
  );

  addFixedCuboid(0, FLOOR_Y - 0.02, BIN_Z,
    triHalfWBottom, 0.02, BIN_DEPTH / 2,
    { friction: 0.95, restitution: 0.02 }
  );

}

// ---------- Bins / divider walls (visual + physics) ----------
{
  const boxTopY = PEG_BOTTOM_Y - 0.1;
  const boxBottomY = FLOOR_Y;
  const dividerY = (boxTopY + boxBottomY) / 2;
  const boxHalfH = (boxTopY - boxBottomY) / 2;

  const wallVisual = new THREE.BoxGeometry(0.01, boxHalfH * 2, 0.18);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 0.7 });

  // 10 inner walls placed exactly under the 10 bottom pegs
  for (let i = 0; i < PEG_COLS; i++) {        // PEG_COLS = 10
    const x = -extremePegX + i * COL_SPACING; // -1.125 .. +1.125 (step 0.25)

    const wall = new THREE.Mesh(wallVisual, wallMat);
    wall.position.set(x, dividerY, BALL_Z);
    rig.add(wall);

    addFixedCuboid(x, dividerY, BALL_Z, 0.005, boxHalfH, 0.09, {
      friction: 0.6,
      restitution: 0.02, // lower bounce helps
    });
  }
}


// ---------- Outer frame containment (vertical, full height) ----------
{
  // const limit = BOARD_W / 2 + 0.05;
  const limit = Math.max(funnelHalfWTop, triHalfWBottom, boxHalfW) + 0.08;
  const totalH = (TOP_Y0 - 0.0);
  const midY = totalH / 2;

  addFixedCuboid(-limit, midY, BALL_Z, 0.02, totalH / 2, WALL_Z_HALF);
  addFixedCuboid(+limit, midY, BALL_Z, 0.02, totalH / 2, WALL_Z_HALF);

  addFixedCuboid(0, TOP_Y0 + 0.05, BALL_Z, BOARD_W, 0.02, WALL_Z_HALF);
}

function spawnBall() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x6ec1ff, roughness: 0.65 })
  );

  const x = (Math.random() - 0.5) * (BOARD_W * 0.6);
  const y = TOP_Y0 - 0.10;
  const z = BALL_Z;

  ball.position.set(x, y, z);
  rig.add(ball);

  addDynamicBall(ball, x, y, z, BALL_R, {
    restitution: 0.12,
    friction: 0.12,
    angularDamping: 0.08,
    linearDamping: 0.015,
    density: 2.2
  });
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
spawnBatch(30, 500);

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
  updateRapierDebug();
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