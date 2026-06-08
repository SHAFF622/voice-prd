// Three.js centerpiece: a realistic Ready Player Me avatar, studio-lit, that idles + blinks
// and lip-syncs to the agent's voice. Vapi gives us amplitude (volume-level), not phonemes,
// so the mouth is driven by smoothed volume on the ARKit `jawOpen` morph (+ a little viseme
// jitter) — which reads clearly as talking. Each PRD item spawns a soft mote orbiting the
// figure. Exposed as window.SCENE for the page to drive.
//
// Graceful degradation: if WebGL can't start, or the avatar GLB can't load (e.g. offline /
// DNS-blocked), we keep the page alive — the module never throws on stage.
import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js";

// Avatar source: user override → bundled local GLB → public RPM URL (needs internet).
const AVATAR_URL = window.RPM_AVATAR_URL || "/avatar.glb";

const canvas = document.getElementById("scene");
const label = document.querySelector(".center .label");
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
  if (label) label.textContent = "3D unavailable (WebGL off) — dashboard fully live";
  console.warn("WebGL unavailable — running without the 3D avatar.");
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
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 1.5, 2.2);          // refined once the avatar's bounds are known
  camera.lookAt(0, 1.45, 0);

  // ---- studio lighting: soft env for PBR + a key and rim so the face reads on black ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x141422, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(1.4, 2.4, 2.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.6);
  rim.position.set(-2.0, 1.8, -2.4); scene.add(rim);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- shared state driven from the page (read by the render loop) ----
  const state = { talk: 0 };                 // 0 idle … 1 actively speaking
  let volume = 0, smoothVol = 0, appliedMouth = 0;

  // ---- the avatar (loaded async) ----
  let avatar = null;                         // root group once loaded
  let morphMeshes = [];                      // meshes carrying ARKit/viseme morphs
  let bones = {};                            // Head / Neck / Spine2 for idle motion
  let blinkT = 2 + Math.random() * 3;        // seconds until next blink

  function setMorph(name, v) {
    for (const m of morphMeshes) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = v;
    }
  }

  const draco = new DRACOLoader().setDecoderPath(
    "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

  loader.load(AVATAR_URL, (gltf) => {
    avatar = gltf.scene;
    avatar.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;             // morphs expand bounds; don't cull the head
        if (o.morphTargetDictionary) morphMeshes.push(o);
      }
      if (o.isBone || o.isObject3D) {
        if (["Head", "Neck", "Spine2", "Spine1"].includes(o.name)) bones[o.name] = o;
      }
    });

    // frame an upper-body presenter shot from the avatar's actual bounds
    const box = new THREE.Box3().setFromObject(avatar);
    const center = box.getCenter(new THREE.Vector3());
    const topY = box.max.y;                   // ~top of head
    const targetY = topY - 0.42;              // chin / upper chest → head sits high in frame
    camera.position.set(center.x + 0.1, targetY + 0.06, center.z + 1.55);
    camera.lookAt(center.x, targetY, center.z);
    avatar.rotation.y = 0;                     // RPM faces +Z (toward camera)

    setMorph("mouthSmile", 0.12);             // pleasant resting expression
    scene.add(avatar);
    if (label) label.textContent = "";        // no caption under the avatar
  }, undefined, (err) => {
    console.warn("Avatar failed to load (" + AVATAR_URL + "); scene stays live.", err);
    if (label) label.textContent = "avatar offline — set RPM_AVATAR_URL · dashboard live";
  });

  // ---- orbiting nodes (one soft mote per PRD item), around the avatar's upper body ----
  const SECTION_COLORS = [0x9aa0ff, 0x4ade80, 0xfacc15, 0xf97316];
  const nodes = [];
  const nodeGeo = new THREE.SphereGeometry(0.035, 16, 16);
  function spawnNode() {
    const color = SECTION_COLORS[nodes.length % SECTION_COLORS.length];
    const m = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false }));
    m.userData = { radius: 0.95 + Math.random() * 0.5, speed: 0.25 + Math.random() * 0.3,
                   phase: Math.random() * Math.PI * 2, tilt: (Math.random() - 0.5) * 0.5 };
    scene.add(m); nodes.push(m);
    m.scale.setScalar(0.01);
    gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: "back.out(2.5)" });
    gsap.to(m.material, { opacity: 0.9, duration: 0.5 });
  }

  // ---- SCENE API (installed immediately; safe to call before the avatar loads) ----
  const SCENE = {
    emitNodes(n) { for (let i = 0; i < n; i++) spawnNode(); },
    pulse() { gsap.to(state, { talk: 1, duration: 0.25, overwrite: true }); },
    calm()  { gsap.to(state, { talk: 0, duration: 0.7, overwrite: true }); },
    setVolume(v) { volume = Math.max(0, Math.min(1, v || 0)); },
    setStage(_stage) { /* reserved */ },
    reset() {
      nodes.splice(0).forEach((n) => { scene.remove(n); n.material.dispose(); });
    },
  };
  window.SCENE = SCENE;

  // ---- render loop ----
  const clock = new THREE.Clock();
  const VISEMES = ["viseme_aa", "viseme_E", "viseme_O", "viseme_U", "viseme_I"];
  let lastViseme = "viseme_aa";
  (function tick() {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    smoothVol += (volume - smoothVol) * 0.3;
    // Mouth opening comes from speech VOLUME only (no constant "talk" floor that gapes it),
    // above a small noise gate, gated to the agent's speaking turn. Kept deliberately subtle.
    const voiceOpen = Math.min(1, Math.max(0, smoothVol - 0.05) / 0.4) * state.talk;

    if (avatar) {
      // lip-sync: ease toward the target, then apply a discrete jaw drop (never a wide gape)
      appliedMouth += (voiceOpen - appliedMouth) * 0.3;
      setMorph("jawOpen", appliedMouth * 0.3);
      setMorph("mouthOpen", appliedMouth * 0.14);
      // gently vary the mouth SHAPE with a viseme so it isn't a static "O"
      if (state.talk > 0.1 && Math.random() < 0.05) {
        setMorph(lastViseme, 0);
        lastViseme = VISEMES[(Math.random() * VISEMES.length) | 0];
      }
      setMorph(lastViseme, appliedMouth * 0.18);

      // blink
      blinkT -= dt;
      let blink = 0;
      if (blinkT < 0.18) blink = 1 - Math.abs(blinkT - 0.09) / 0.09;   // quick close→open
      if (blinkT < 0) blinkT = 2.5 + Math.random() * 3.5;
      setMorph("eyeBlinkLeft", blink); setMorph("eyeBlinkRight", blink);

      // gentle, life-like idle: breathing sway on the spine + head bob/turn
      const b = bones, sway = Math.sin(t * 0.9) * 0.025, breath = Math.sin(t * 1.3) * 0.02;
      if (b.Spine2) { b.Spine2.rotation.x = breath; b.Spine2.rotation.y = sway * 0.6; }
      if (b.Neck) b.Neck.rotation.y = sway * 0.5;
      if (b.Head) {
        b.Head.rotation.y = Math.sin(t * 0.5) * 0.08 + sway;
        b.Head.rotation.x = Math.sin(t * 0.7) * 0.03 + voiceOpen * 0.03;
      }
    }

    // motes orbit the upper body (centered on the camera target height)
    for (const n of nodes) {
      const u = n.userData, a = t * u.speed + u.phase;
      n.position.set(Math.cos(a) * u.radius,
                     1.45 + Math.sin(a * 1.3) * 0.25 + u.tilt,
                     Math.sin(a) * u.radius * 0.7);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();
}
