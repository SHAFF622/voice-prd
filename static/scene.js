// Procedural Three.js centerpiece — NO Blender assets. A glowing wireframe HUMANOID
// that breathes, turns, and reacts to voice: the head/jaw move and a "voice orb" at the
// mouth swells with speech volume. Each PRD item spawns a node orbiting the figure.
// GSAP drives every transition. Exposed as window.SCENE for the page to drive.
//
// Graceful degradation: if WebGL can't start (projector quirk, disabled hardware
// accel, driver issue on the demo machine), we install a no-op SCENE so the rest of
// the page keeps working and show a subtle note — the module never throws on stage.
import * as THREE from "three";

const canvas = document.getElementById("scene");
const noop = () => {};
const NOOP_SCENE = { emitNodes: noop, pulse: noop, calm: noop, setVolume: noop,
                     setStage: noop, reset: noop };

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
              (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}

if (!webglOK()) {
  window.SCENE = NOOP_SCENE;
  const note = document.querySelector(".center .label");
  if (note) note.textContent = "3D core unavailable (WebGL off) — dashboard fully live";
  console.warn("WebGL unavailable — running without the 3D core.");
} else {
  try { initScene(); }
  catch (e) {
    window.SCENE = NOOP_SCENE;
    console.warn("3D init failed — dashboard still live:", e);
  }
}

function initScene() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.8, 7);
  camera.lookAt(0, 0.8, 0);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- the figure: a glowing wireframe humanoid from primitives ----
  // Built as dark translucent fills with bright wireframe overlays, matching the old core's
  // palette. Grouped so the whole body breathes/turns; the head is its own sub-group so it
  // can bob and the jaw/voice-orb can move independently with speech.
  const coreGroup = new THREE.Group();   // name kept: the page + tweens drive coreGroup
  coreGroup.position.y = -0.2;
  scene.add(coreGroup);

  const WIRE = 0x7c7cff, FILL = 0x1a1a3a;
  const wires = [];                      // every wireframe material, so volume can brighten all

  // body part: fill mesh + wireframe overlay, added to a parent group at (x,y,z)
  function part(geometry, parent, x = 0, y = 0, z = 0, fillOpacity = 0.5) {
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: FILL, transparent: true, opacity: fillOpacity }));
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.85 }));
    const g = new THREE.Group();
    g.add(fill, wire); g.position.set(x, y, z);
    parent.add(g); wires.push(wire.material);
    return g;
  }

  // torso (tapered: narrower at the waist), shoulders, hips, arms
  part(new THREE.CylinderGeometry(0.78, 0.5, 1.7, 14, 1), coreGroup, 0, 0.55, 0);
  part(new THREE.SphereGeometry(0.82, 16, 12), coreGroup, 0, 1.35, 0, 0.4);   // shoulder yoke
  part(new THREE.SphereGeometry(0.5, 14, 10), coreGroup, 0, -0.35, 0, 0.4);   // hips
  for (const s of [-1, 1]) {
    const arm = part(new THREE.CylinderGeometry(0.16, 0.13, 1.5, 10, 1),
                     coreGroup, s * 0.92, 0.55, 0);
    arm.rotation.z = s * 0.18;                                                // slight splay
  }

  // head sub-group (bobs with speech); jaw + voice orb live inside it
  const head = new THREE.Group();
  head.position.set(0, 1.95, 0);
  coreGroup.add(head);
  part(new THREE.SphereGeometry(0.52, 20, 16), head, 0, 0.18, 0, 0.45);       // skull
  const jaw = part(new THREE.SphereGeometry(0.3, 14, 10), head, 0, -0.15, 0.12, 0.45);

  // voice orb: emissive sphere at the mouth that swells + brightens with volume
  const voiceOrb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x9aa0ff, transparent: true, opacity: 0.85 }));
  voiceOrb.position.set(0, -0.16, 0.46);
  head.add(voiceOrb);

  // soft inner point cloud around the chest for depth
  coreGroup.add(new THREE.Points(
    new THREE.SphereGeometry(0.9, 8, 8),
    new THREE.PointsMaterial({ color: 0x9aa0ff, size: 0.035, transparent: true, opacity: 0.5 })));

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

  function spawnNode() {
    const color = SECTION_COLORS[nodes.length % SECTION_COLORS.length];
    const m = new THREE.Mesh(nodeGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
    m.userData = { radius: 2.6 + Math.random() * 1.1, speed: 0.15 + Math.random() * 0.25,
                   phase: Math.random() * Math.PI * 2, tilt: (Math.random() - 0.5) * 1.4 };
    scene.add(m);
    nodes.push(m);
    m.scale.setScalar(0.01);
    gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: "back.out(2.5)" });
    gsap.to(m.material, { opacity: 0.95, duration: 0.5 });
    SCENE.pulse();   // energize the core whenever a node is born
  }

  // ---- state driven from the page ----
  const state = { spin: 0.15, talk: 0 };   // talk: 0 idle … 1 actively speaking
  let targetScale = 1, volume = 0;

  const SCENE = {
    emitNodes(n) { for (let i = 0; i < n; i++) spawnNode(); },
    pulse() {
      gsap.to(state, { spin: 0.45, talk: 1, duration: 0.3, overwrite: true });
      targetScale = 1.08;
      gsap.killTweensOf(coreGroup.scale);
      gsap.to(coreGroup.scale, { x: 1.08, y: 1.08, z: 1.08, duration: 0.25, ease: "power2.out" });
    },
    calm() {
      gsap.to(state, { spin: 0.15, talk: 0, duration: 0.8, overwrite: true });
      targetScale = 1;
      gsap.to(coreGroup.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: "power2.out" });
    },
    setVolume(v) { volume = Math.max(0, Math.min(1, v || 0)); },
    setStage(_stage) { /* reserved: recolor wire per stage */ },
    reset() {
      nodes.splice(0).forEach(n => {
        scene.remove(n); n.geometry.dispose?.(); n.material.dispose();
      });
    },
  };
  window.SCENE = SCENE;

  // ---- render loop ----
  const clock = new THREE.Clock();
  let smoothVol = 0;
  const _v = new THREE.Vector3();
  (function tick() {
    const t = clock.getElapsedTime();
    smoothVol += (volume - smoothVol) * 0.25;          // ease the raw mic level

    // gentle human idle: sway + breathing, NOT a fast spin. spin/talk rise while speaking.
    coreGroup.rotation.y = Math.sin(t * 0.25) * 0.35 + state.spin * 0.1;
    const breathe = 1 + Math.sin(t * 1.4) * 0.012 * (1 + state.talk);
    const vScale = targetScale * breathe + smoothVol * 0.12;
    coreGroup.scale.lerp(_v.setScalar(vScale), 0.12);

    // head bob + slight tilt; stronger while speaking and with louder volume
    const drive = state.talk + smoothVol;
    head.position.y = 1.95 + Math.sin(t * 2.2) * 0.04 * (0.4 + drive);
    head.rotation.x = Math.sin(t * 1.1) * 0.05 + smoothVol * 0.12;
    head.rotation.z = Math.sin(t * 0.6) * 0.04;

    // jaw drop + voice orb swell/brighten = the "replicating the voice" beat
    const mouth = Math.min(1, drive);
    jaw.position.y = -0.15 - mouth * 0.12;
    jaw.scale.y = 1 + mouth * 0.25;
    voiceOrb.scale.setScalar(0.5 + mouth * 1.4);
    voiceOrb.material.opacity = 0.3 + mouth * 0.6;

    // brighten every wireframe with the voice
    const o = 0.6 + smoothVol * 0.4 + state.talk * 0.15;
    for (const w of wires) w.opacity = o;

    for (const n of nodes) {
      const u = n.userData, a = t * u.speed + u.phase;
      n.position.set(Math.cos(a) * u.radius,
                     Math.sin(a) * u.radius * 0.5 + u.tilt + 0.6,   // orbit centered on torso
                     Math.sin(a) * u.radius);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();
}
