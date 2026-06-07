// Procedural Three.js centerpiece — NO Blender assets. A glowing wireframe core
// that breathes, spins, and reacts to voice; each PRD item spawns an orbiting node.
// GSAP drives every transition. Exposed as window.SCENE for the page to drive.
import * as THREE from "three";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 6);

function resize(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- the core: solid icosahedron + wireframe shell ----
const coreGroup = new THREE.Group();
scene.add(coreGroup);

const geo = new THREE.IcosahedronGeometry(1.5, 1);
const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
  color: 0x1a1a3a, transparent: true, opacity: 0.55 }));
const wire = new THREE.LineSegments(
  new THREE.WireframeGeometry(geo),
  new THREE.LineBasicMaterial({ color: 0x7c7cff, transparent: true, opacity: 0.9 }));
coreGroup.add(core, wire);

// inner glow point cloud
const pts = new THREE.Points(
  new THREE.IcosahedronGeometry(1.1, 2),
  new THREE.PointsMaterial({ color: 0x9aa0ff, size: 0.04 }));
coreGroup.add(pts);

// ---- ambient starfield ----
const starGeo = new THREE.BufferGeometry();
const starN = 350, sp = new Float32Array(starN * 3);
for (let i = 0; i < starN * 3; i++) sp[i] = (Math.random() - 0.5) * 30;
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
scene.add(new THREE.Points(starGeo,
  new THREE.PointsMaterial({ color: 0x33335a, size: 0.05 })));

// ---- orbiting nodes (one per PRD item) ----
const SECTION_COLORS = [0x7c7cff, 0x4ade80, 0xfacc15, 0xf97316];
const nodes = [];
const nodeGeo = new THREE.SphereGeometry(0.12, 16, 16);

function spawnNode(){
  const color = SECTION_COLORS[nodes.length % SECTION_COLORS.length];
  const m = new THREE.Mesh(nodeGeo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
  const radius = 2.6 + Math.random() * 1.1;
  const speed  = 0.15 + Math.random() * 0.25;
  const phase  = Math.random() * Math.PI * 2;
  const tilt   = (Math.random() - 0.5) * 1.4;
  m.userData = { radius, speed, phase, tilt };
  scene.add(m);
  nodes.push(m);
  // GSAP pop-in
  m.scale.setScalar(0.01);
  gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: "back.out(2.5)" });
  gsap.to(m.material, { opacity: 0.95, duration: 0.5 });
  // a quick energetic pulse of the core whenever a node is born
  pulse();
}

// ---- state driven from the page ----
let spin = 0.15;          // base spin speed
let targetScale = 1;      // core scale target (volume / speech)
let volume = 0;

const SCENE = {
  emitNodes(n){ for (let i = 0; i < n; i++) spawnNode(); },
  pulse(){ // AI speaking / node born: energize
    gsap.to(state, { spin: 0.6, duration: 0.3, overwrite: true });
    targetScale = 1.18;
    gsap.killTweensOf(coreGroup.scale);
    gsap.to(coreGroup.scale, { x: 1.18, y: 1.18, z: 1.18, duration: 0.25, ease: "power2.out" });
  },
  calm(){
    gsap.to(state, { spin: 0.15, duration: 0.8, overwrite: true });
    targetScale = 1;
    gsap.to(coreGroup.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: "power2.out" });
  },
  setVolume(v){ volume = Math.max(0, Math.min(1, v || 0)); },
  setStage(_stage){ /* reserved: could recolor wire per stage */ },
  reset(){
    nodes.splice(0).forEach(n => { scene.remove(n); n.geometry.dispose?.(); n.material.dispose(); });
  },
};
const state = { spin };          // tweenable spin holder
window.SCENE = SCENE;

// ---- render loop ----
const clock = new THREE.Clock();
function tick(){
  const t = clock.getElapsedTime();

  coreGroup.rotation.y += state.spin * 0.02;
  coreGroup.rotation.x += state.spin * 0.008;

  // volume nudges the core scale live while the agent talks
  const vScale = targetScale + volume * 0.25;
  coreGroup.scale.lerp(new THREE.Vector3(vScale, vScale, vScale), 0.12);
  wire.material.opacity = 0.6 + volume * 0.4;

  for (const n of nodes){
    const u = n.userData;
    const a = t * u.speed + u.phase;
    n.position.set(Math.cos(a) * u.radius,
                   Math.sin(a) * u.radius * 0.5 + u.tilt,
                   Math.sin(a) * u.radius);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
