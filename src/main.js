import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

// ---------- scene / camera / renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 2.0, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.xr.enabled = true;
// window.renderer = renderer;
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

// ---------- VR rig (everything goes in here) ----------
const rig = new THREE.Group();
rig.position.set(0, 0, -2.2); // put content ~2.2m in front of where you start in VR
scene.add(rig);

// ---------- helpers (optional but nice) ----------
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  rig.add(floor);
}

// ---------- board params (VR-friendly meters) ----------
const BOARD_W = 2.2;
const BOARD_H = 2.6;

const PEG_ROWS = 10;
const PEG_COLS = 10;
const PEG_R = 0.03;

const BIN_COUNT = PEG_COLS + 1;

// backboard 
{
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1c2541, roughness: 0.8 })
  );
  back.position.set(0, BOARD_H / 2 + 0.35, 0);
  rig.add(back);
}

// pegs 
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
      peg.position.set(x, y, 0.04);
      rig.add(peg);
      pegs.push(peg);
    }
  }
}

// bins / dividers
{
  const binW = BOARD_W / BIN_COUNT;
  const wallGeom = new THREE.BoxGeometry(0.01, 0.35, 0.6);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 0.7 });

  for (let i = 0; i <= BIN_COUNT; i++) {
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wall.position.set(-BOARD_W / 2 + i * binW, 0.3, 0.12);
    rig.add(wall);
  }
}

// balls (simple fake physics for now)
const balls = [];
const BALL_R = 0.05;
const GRAVITY = 0.006;
const FLOOR_Y = 0.15;

function spawnBall() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0x6ec1ff, roughness: 0.35 })
  );

  ball.position.set((Math.random() - 0.5) * 0.08, BOARD_H + 0.35 - 0.05, 0.12);
  ball.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.002, 0, 0);

  rig.add(ball);
  balls.push(ball);

  if (balls.length > 160) {
    const old = balls.shift();
    rig.remove(old);
    old.geometry.dispose();
    old.material.dispose();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") spawnBall();
});

function updateBalls() {
  for (const ball of balls) {
    const v = ball.userData.v;

    v.y -= GRAVITY;
    ball.position.add(v);

    // cheap peg bounce
    for (const peg of pegs) {
      const d = ball.position.distanceTo(peg.position);
      if (d < BALL_R + PEG_R) {
        const dx = ball.position.x - peg.position.x;
        const s = dx >= 0 ? 1 : -1;
        v.x = s * (0.01 + Math.random() * 0.01);
        v.y = Math.abs(v.y) * 0.08;
        break;
      }
    }

    // floor settle
    if (ball.position.y < FLOOR_Y) {
      ball.position.y = FLOOR_Y;
      v.y *= -0.15;
      v.x *= 0.985;
      if (Math.abs(v.y) < 0.0015 && Math.abs(v.x) < 0.0015) v.set(0, 0, 0);
    }

    // keep on board width
    const limit = BOARD_W / 2 - 0.06;
    if (ball.position.x < -limit) { ball.position.x = -limit; v.x *= -0.5; }
    if (ball.position.x >  limit) { ball.position.x =  limit; v.x *= -0.5; }
  }
}

// start with a few
for (let i = 0; i < 8; i++) spawnBall();

// resize + render loop 
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  updateBalls();
  controls.update();
  renderer.render(scene, camera);
});
