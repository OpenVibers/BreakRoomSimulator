// Amazon Break Room Simulator — client bootstrap & game loop.
import * as THREE from 'three';
import { buildWorld, resolveCollisions, W } from './world.js';
import { makeAvatar, buildHeldMesh, SKINS, SHIRTS, HAIRS, HATS } from './avatar.js';
import { initInventory, ITEMS } from './inventory.js';
import { input, initInput, keyMove, uiFocus } from './input.js';
import { net, api, connect } from './net.js';
import { initMinigames, beep } from './minigames.js';
import { initProps } from './props.js';
import { initEditor } from './editor.js';
import { initPhysics, PHYS_KINDS } from './physics.js';
import { initLighting, enableShadows } from './lighting.js';
import { ct, woodTexture } from './textures.js';

const $ = (id) => document.getElementById(id);

// ============================== AUTH UI ==============================
let authMode = 'login';
$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');
function setMode(m) {
  authMode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'Badge in →' : 'Create & badge in →';
}
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api(authMode === 'login' ? 'login' : 'register', {
    name: $('auth-name').value, pass: $('auth-pass').value,
  });
  if (r.error) { $('auth-error').textContent = r.error; return; }
  start(r.token, r.user);
});
$('btn-guest').onclick = async () => {
  const r = await api('guest');
  if (!r.error) start(r.token, r.user);
};

// auto-login with saved token (or ?autoguest for quick testing)
let started = false; // must be initialized BEFORE start() runs from this block —
                     // as a `let` below it, the call hit the temporal dead zone and
                     // silently killed every saved-token auto-login
const saved = localStorage.getItem('brs-token');
const savedUser = localStorage.getItem('brs-user');
if (saved && savedUser) {
  try { start(saved, JSON.parse(savedUser)); }
  catch (err) {
    console.error('start() failed:', err);
    window.__startErr = String(err?.stack || err);
    localStorage.clear();
  }
} else if (location.search.includes('autoguest')) {
  api('guest').then(r => { if (!r.error) start(r.token, r.user); });
}

// ============================== GAME ==============================
function start(token, user) {
  if (started) return;
  started = true;
  localStorage.setItem('brs-token', token);
  localStorage.setItem('brs-user', JSON.stringify(user));

  const me = { name: user.name, vest: user.vest, guest: user.guest, admin: !!user.admin, ap: user.ap || null, inv: user.inv, hotbar: user.hotbar, stats: user.stats || {} };

  // ---------- three ----------
  const cfg0 = JSON.parse(localStorage.getItem('brs-cfg') || '{}'); // pre-renderer options
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: cfg0.aa !== false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // >1.5 dpr is wasted fragments on this art style
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .1, 300);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  buildWorld(scene);
  initInput(canvas);

  const toast = (text, ms = 2600) => {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  };
  const mg = initMinigames(W, me, toast);
  const props = initProps(scene, () => me.admin);
  const phys = initPhysics(scene); // sandbox physics: dynamic props + physgun
  const daylight = initLighting(scene, renderer, // shared day/night cycle
    JSON.parse(localStorage.getItem('brs-cfg') || '{}').shadows !== false);
  let editor = null;

  // ---- static-matrix freeze: the world is thousands of meshes that never
  // move; recomposing their matrices every frame is pure CPU waste. Freeze
  // everything except the known movers. ----
  {
    const dyn = new Set();
    const markDyn = (o) => o && o.traverse(x => dyn.add(x));
    W.cars?.forEach(c => markDyn(c.group));
    W.gates?.forEach(g => { markDyn(g.pl); markDyn(g.pr); });
    W.knockables?.forEach(k => markDyn(k.obj));
    W.dynamic.fireGroups?.forEach(markDyn);
    for (const id of ['a', 'b']) {
      markDyn(W.anchors[`pong-${id}`]?.ball);
      W.anchors[`c4-${id}`]?.discs?.forEach(markDyn);
    }
    markDyn(W.anchors.chess?.group);
    scene.traverse(o => {
      if (dyn.has(o) || o.isLight || o.isCamera) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  // ---------- drivable cars (rigid-body vehicles — they roll and flip) ----------
  const carState = { driving: null }; // driving = W.cars entry
  let carSendT = 0;
  function enterCar(car) {
    if (car.driver && car.driver !== myId) { toast('🚗 Someone is already driving that one.'); return; }
    const e = phys.cars.get(car.id);
    if (pgState.held === e) physgunRelease(false);
    carState.driving = car;
    car.col.off = true;
    car.driver = myId;
    phys.claim(e);
    net.send({ t: 'car', id: car.id, op: 'enter' });
    toast('🚗 W/S throttle · A/D steer · Space handbrake · E to get out');
  }
  function exitCar() {
    const car = carState.driving;
    if (!car) return;
    const e = phys.cars.get(car.id);
    carState.driving = null;
    car.col.off = false;
    car.driver = null;
    e.owned = true; // keep streaming while it rolls to a stop
    // step out beside the driver door
    my.x = car.x + Math.cos(car.ry) * 1.7;
    my.z = car.z - Math.sin(car.ry) * 1.7;
    my.vel.x = 0; my.vel.z = 0;
    my.y = 0; my.vy = 0;
    net.send({ t: 'car', id: car.id, op: 'exit' });
    sendPos(true);
  }
  net.on('car', (m) => {
    const car = W.cars?.find(c => c.id === m.id);
    const e = phys.cars.get(m.id);
    if (!car || !e) return;
    if (m.op === 'enter') {
      car.driver = m.driver;
      if (m.driver !== myId) { car.col.off = true; e.owned = false; }
      e.grabbedBy = null;
      if (pgState.held === e) physgunRelease(false);
    } else if (m.op === 'exit') {
      car.driver = null;
      car.col.off = false;
      if (Array.isArray(m.p)) phys.applyCarState({ id: m.id, p: m.p, q: m.q, v: null }, true);
    } else if (m.op === 'state') {
      if (m.driver === myId) return;
      car.driver = m.driver;
      phys.applyCarState(m);
    } else if (m.op === 'phys') {
      if (m.owner === myId) return;
      phys.applyCarState(m);
    } else if (m.op === 'grab') {
      e.grabbedBy = m.by;
      e.owned = false;
    } else if (m.op === 'drop') e.grabbedBy = null;
  });

  // ---------- badge gates ----------
  function openGate(id) {
    const g = W.gates?.find(x => x.id === id);
    if (!g || g.open) return;
    g.open = true;
    g.col.off = true;
    beep(1240, .09, 'sine', .12);
    setTimeout(() => { g.open = false; g.col.off = false; }, 2600);
  }
  net.on('gate', (m) => openGate(m.id));

  // ---------- my player ----------
  const my = {
    x: -35, y: 0, z: 0, ry: -Math.PI / 2, vy: 0,
    vel: { x: 0, z: 0 },                    // source-style horizontal velocity
    yaw: Math.PI / 2, pitch: .25, dist: 4.4,
    anim: 'idle', seat: null, held: null, onGround: true, crouch: false,
  };
  let fp = false; // first-person mode
  // ---------- persistent game settings ----------
  const cfg = Object.assign(
    { wheel: 'zoom', sens: 1.0, fov: 70, invertY: false, shadows: true, shadowQ: null, rscale: 1, drawDist: 'far', xlights: true, fps: false, aa: true },
    JSON.parse(localStorage.getItem('brs-cfg') || '{}'));
  cfg.shadowQ ||= cfg.shadows === false ? 'off' : 'low'; // migrate the old checkbox
  const saveCfg = () => localStorage.setItem('brs-cfg', JSON.stringify(cfg));
  let myAvatar = makeAvatar(me.name, me.vest, me.guest, me.ap);
  enableShadows(myAvatar.group);
  scene.add(myAvatar.group);
  function rebuildMyAvatar() {
    const held = myAvatar.held, seatId = myAvatar.seatId;
    scene.remove(myAvatar.group);
    myAvatar = makeAvatar(me.name, me.vest, me.guest, me.ap);
    myAvatar.setHeld(held);
    myAvatar.seatId = seatId;
    enableShadows(myAvatar.group);
    scene.add(myAvatar.group);
    updateViewmodel(); // refresh first-person hands to the new look
  }

  const others = new Map(); // id -> {avatar, target, name}
  let myId = null;

  // ---------- inventory / equipment ----------
  const invApi = initInventory({
    me,
    onDropItem: (id) => dropItemInWorld(id),
    onEquip: (item) => {
      my.held = item;
      myAvatar.setHeld(item);
      net.send({ t: 'held', item });
      updateViewmodel();
      if (item === 'physgun') toast('🧲 Hold left-click to grab · wheel push/pull · hold E + mouse to rotate · right-click freezes · X takes yours back', 5200);
    },
    onWear: (def) => {
      if (def.ap) { me.ap = { ...(me.ap || {}), ...def.ap }; rebuildMyAvatar(); net.send({ t: 'appear', ap: me.ap }); }
      if (def.vest) { me.vest = def.vest; myAvatar.setVest(def.vest); net.send({ t: 'vest', vest: def.vest }); updateViewmodel(); }
      toast(`👕 Wearing: ${def.name}`);
      if (fp) myAvatar.group.visible = false;
    },
    toast,
  });

  // ---------- first person + viewmodel ----------
  const viewmodel = new THREE.Group();
  viewmodel.position.set(.34, -.34, -.6);
  viewmodel.rotation.set(-.2, -.35, .15);
  camera.add(viewmodel);
  scene.add(camera);
  // flashlight beam rides the camera so it points where you look
  const torch = new THREE.SpotLight(0xfff6d8, 0, 30, .5, .45, 1.2);
  torch.position.set(.25, -.2, .1);
  torch.target.position.set(0, -.4, -12);
  camera.add(torch, torch.target);
  // headlight pool (created up-front — stable light count, no shader hitches)
  const hlPool = [];
  for (let i = 0; i < 2; i++) {
    const sp = new THREE.SpotLight(0xfff2cf, 0, 36, .52, .5, 1.1);
    scene.add(sp, sp.target);
    hlPool.push(sp);
  }
  let vmSwing = 0;
  // per-item viewmodel pose so props read correctly in first person (Bug10)
  const VM_POSE = {
    // Bug12: blade/business-end UP and facing the camera, grip at the wrist
    paddle:  { p: [0, .16, 0], r: [2.7, .45, .18], s: 1.5 },
    broom:   { p: [0, .42, .08], r: [.5, .3, .12], s: 1.15 },
    tube:    { p: [0, .3, 0], r: [2.95, .2, .1], s: 1.25 },
    wrench:  { p: [0, .14, 0], r: [2.55, .35, .18], s: 1.6 },
    tapegun: { p: [0, .05, 0], r: [-.55, -.55, .25], s: 1.6 },
    banana:  { p: [0, .08, 0], r: [1.95, .4, .85], s: 1.7 },
    soda:    { p: [0, .05, 0], r: [-.15, 0, .08], s: 1.5 },
    coffee:  { p: [0, .05, 0], r: [-.15, 0, .08], s: 1.5 },
    energy:  { p: [0, .05, 0], r: [-.15, 0, .08], s: 1.5 },
    water:   { p: [0, .05, 0], r: [-.15, 0, .08], s: 1.5 },
    chips:   { p: [0, .05, 0], r: [-.4, .3, 0], s: 1.5 },
    candy:   { p: [0, .04, 0], r: [-.4, .3, 0], s: 1.6 },
    food:    { p: [0, .04, 0], r: [-.3, .3, 0], s: 1.5 },
  };
  let vmEquip = 0; // pop-in animation when switching items
  // first-person arms: sleeve/hand colors mirror your character (skin, shirt, vest)
  function vmArm(side) {
    const ap = me.ap || {};
    const skin = SKINS[ap.skin ?? 0] ?? 0xf0dbc0;
    const shirt = SHIRTS[ap.shirt ?? 0] ?? 0x3b4048;
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(.11, .11, .36), new THREE.MeshStandardMaterial({ color: shirt, roughness: .8 }));
    sleeve.position.set(0, -.02, .2);
    g.add(sleeve);
    if (me.vest && me.vest !== 'none') { // hi-vis cuff peeks in at the wrist end
      const vb = new THREE.Mesh(new THREE.BoxGeometry(.118, .118, .06), new THREE.MeshStandardMaterial({ color: me.vest === 'orange' ? 0xff7a1a : 0xd3e50b, roughness: .6 }));
      vb.position.set(0, -.02, .34);
      g.add(vb);
    }
    const handM = new THREE.MeshStandardMaterial({ color: skin, roughness: .7 });
    const hand = new THREE.Mesh(new THREE.BoxGeometry(.105, .09, .14), handM);
    hand.position.set(0, 0, -.02);
    g.add(hand);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(.035, .05, .07), handM);
    thumb.position.set(side * -.062, .015, .01);
    g.add(thumb);
    for (let f = 0; f < 3; f++) { // curled fingers over the grip
      const fin = new THREE.Mesh(new THREE.BoxGeometry(.026, .05, .05), handM);
      fin.position.set(-.035 + f * .035, -.045, -.06);
      g.add(fin);
    }
    return g;
  }
  function updateViewmodel() {
    while (viewmodel.children.length) viewmodel.remove(viewmodel.children[0]);
    if (!fp) return;
    if (my.held) {
      const m = buildHeldMesh(my.held);
      if (m) {
        const pose = VM_POSE[my.held] || { p: [0, 0, 0], r: [0, 0, 0], s: 1.4 };
        m.position.set(...pose.p);
        m.rotation.set(...pose.r);
        m.scale.setScalar(pose.s);
        viewmodel.add(m);
      }
      const arm = vmArm(1);
      arm.position.set(0, .07, .03);
      arm.rotation.set(1.25, .06, .03);
      arm.scale.setScalar(.8);
      viewmodel.add(arm);
    } else { // empty hands, loosely raised
      const armR = vmArm(1);
      armR.position.set(.1, .1, .02);
      armR.rotation.set(1.15, -.12, .05);
      armR.scale.setScalar(.78);
      viewmodel.add(armR);
      const armL = vmArm(-1);
      armL.position.set(-.5, .1, .02);
      armL.rotation.set(1.15, .12, -.05);
      armL.scale.setScalar(.78);
      viewmodel.add(armL);
    }
    vmEquip = 1;
  }
  function setFP(on) {
    fp = on;
    myAvatar.group.visible = !on;
    $('btn-fp').style.background = on ? '#ff9900' : '';
    if (on && !input.isTouch) $('crosshair').classList.remove('hidden');
    updateViewmodel();
  }
  $('btn-fp').onclick = () => setFP(!fp);
  $('btn-inv').onclick = () => invApi.toggle();

  // per-weapon first-person attack curves: rot(wind,smash) → euler deltas,
  // pos(wind,smash) → positional punch. Each prop swings differently.
  const VM_ANIM = {
    default: { speed: 3.8, rot: (w, s) => [w * .5 - s * 1.7, s * .8, -s * .3], pos: () => [0, 0, 0] },
    paddle:  { speed: 4.6, rot: (w, s) => [w * .35 - s * 1.25, -w * .5 + s * 1.5, -s * .7], pos: (w, s) => [-w * .06 + s * .1, 0, -s * .12] },
    broom:   { speed: 3.6, rot: (w, s) => [w * .15 - s * .3, -w * .9 + s * 1.9, w * .2 - s * .25], pos: (w, s) => [-w * .18 + s * .38, -w * .05, -s * .08] },
    tube:    { speed: 3.1, rot: (w, s) => [w * 1.1 - s * 2.3, 0, w * .15 - s * .2], pos: (w, s) => [0, w * .14 - s * .1, -s * .15] },
    wrench:  { speed: 3.9, rot: (w, s) => [w * .6 - s * 1.9, s * .5, w * .35 - s * .9], pos: (w, s) => [s * .05, 0, -s * .1] },
    tapegun: { speed: 6.0, rot: (w, s) => [w * .25 - s * .45, s * .2, 0], pos: (w, s) => [0, 0, -w * .08 - s * .34] },
    banana:  { speed: 4.4, rot: (w, s) => [w * .4 - s * .9, -w * .4 + s * 2.6, -w * .3 + s * 1.1], pos: (w, s) => [s * .08, w * .08, -s * .1] },
  };

  function doSwing() {
    if (my.held && ITEMS[my.held]?.type !== 'melee') return; // empty hand = fists
    const nowS = performance.now();
    if (nowS - (doSwing._t || 0) < 320) return;
    doSwing._t = nowS;
    myAvatar.swing();
    vmSwing = 1;
    net.send({ t: 'swing' });
    beep(240, .09, 'sawtooth', .07);
    // send nearby physics props flying
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    if (phys.smack(my.x, my.y, my.z, fx, fz)) beep(160, .08, 'square', .09);
    // harvest: chop trees / mine rocks in front
    const toolWood = my.held === 'stoneaxe' ? 3 : my.held === 'axe' ? 2 : 1;
    const toolStone = my.held === 'stonepick' ? 3 : my.held === 'pickaxe' ? 2 : 1;
    for (const k of W.knockables) {
      if (k.down || (k.kind !== 'tree' && k.kind !== 'rock')) continue;
      const ddx = k.x - my.x, ddz = k.z - my.z;
      const d2 = Math.hypot(ddx, ddz);
      if (d2 > k.r + 1.6 || (ddx * fx + ddz * fz) / (d2 || 1) < .35) continue;
      const isTree = k.kind === 'tree';
      const power = isTree ? toolWood : toolStone;
      k.hp -= power;
      const mat = isTree ? 'wood' : 'stone';
      const got = power + (Math.random() < .5 ? 1 : 0);
      invApi.add(mat, got);
      toast(`${ITEMS[mat].icon} +${got} ${mat}`, 900);
      beep(isTree ? 190 : 320, .07, isTree ? 'square' : 'triangle', .13);
      k.obj.scale.setScalar(1.045);
      setTimeout(() => { if (!k.down) k.obj.scale.setScalar(1); }, 90);
      if (k.hp <= 0) {
        invApi.add(mat, 4); // felling / shattering bonus
        toast(`${ITEMS[mat].icon} +4 bonus — ${isTree ? 'timber!' : 'rock shattered!'}`, 1600);
        knockIt(k, ddx / (d2 || 1), ddz / (d2 || 1), true);
      }
      return; // the swing spent itself on the resource
    }
    // whack placed base pieces
    for (const e of buildMap.values()) {
      const ddx = e.b.p[0] - my.x, ddz = e.b.p[2] - my.z;
      const d2 = Math.hypot(ddx, ddz);
      if (d2 > 3 || (ddx * fx + ddz * fz) / (d2 || 1) < .3) continue;
      net.send({ t: 'build', op: 'hit', id: e.b.id, item: my.held });
      beep(140, .07, 'square', .12);
      return;
    }
    // did we clock somebody? nearest target in a front cone
    let victim = null, bestD = 1.9;
    for (const [id, o] of others) {
      const g = o.avatar.group.position;
      const ddx = g.x - my.x, ddz = g.z - my.z;
      const d2 = Math.hypot(ddx, ddz);
      if (d2 > bestD || (ddx * fx + ddz * fz) / (d2 || 1) < .5) continue;
      bestD = d2; victim = id;
    }
    if (victim != null) {
      net.send({ t: 'hit', target: victim, item: my.held });
      beep(320, .06, 'square', .1);
      return;
    }
    for (const [key, s] of sleeperMap) { // sleepers are fair game
      const g = s.root.position;
      const ddx = g.x - my.x, ddz = g.z - my.z;
      const d2 = Math.hypot(ddx, ddz);
      if (d2 > 1.9 || (ddx * fx + ddz * fz) / (d2 || 1) < .35) continue;
      net.send({ t: 'hit', sleeper: key, item: my.held });
      beep(280, .06, 'square', .09);
      return;
    }
    for (const [id, n] of npcMap) { // hunting / zombie defense
      const g = n.group.position;
      const ddx = g.x - my.x, ddz = g.z - my.z;
      const d2 = Math.hypot(ddx, ddz);
      if (d2 > 2.1 || (ddx * fx + ddz * fz) / (d2 || 1) < .35) continue;
      net.send({ t: 'hit', npc: id, item: my.held });
      beep(300, .06, 'square', .1);
      break;
    }
  }
  net.on('swing', (m) => {
    if (m.id === myId) return;
    const o = others.get(m.id);
    if (o) { o.avatar.swing(); beep(240, .07, 'sawtooth', .04); }
  });
  function useKey() {
    const r = invApi.useSelected();
    if (!r) { doSwing(); return; } // nothing selected: throw hands
    if (r.melee === 'physgun') { toast('🧲 Hold left-click to grab · wheel push/pull · hold E + mouse rotates · right-click freezes · X takes yours back'); return; }
    if (r.melee === 'flashlight') { toast('🔦 Lights wherever you look — best after dark.'); return; }
    if (ITEMS[r.melee]?.type === 'gun') { firePistol(); return; }
    if (ITEMS[r.melee]?.type === 'build') { placeBuild(); return; }
    if (ITEMS[r.melee]?.type === 'prop') { placeProp(); return; }
    if (ITEMS[r.melee]?.type === 'mat') { toast('🔨 Raw material — press C to craft with it.'); return; }
    if (r.melee) { doSwing(); return; }
    if (r.def) {
      toast(`😋 ${r.def.icon} ${r.def.name} — delicious.`);
      beep(420, .12, 'sine', .1);
      updateViewmodel();
    }
  }
  addEventListener('keydown', (e) => {
    if (!started || input.chatOpen || mg.inArcade()) return;
    if (e.code.startsWith('Digit')) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= 6) { invApi.select(n - 1); }
    } else if (e.code === 'Tab' || e.code === 'KeyI') {
      e.preventDefault();
      invApi.toggle();
    } else if (e.code === 'KeyV') setFP(!fp);
    else if (e.code === 'KeyF') useKey();
    else if (e.code === 'KeyQ') toggleCraft(); // Q = crafting too (spawn menu retired)
    else if (e.code === 'KeyC') toggleCraft();
    else if (e.code === 'KeyG') { e.preventDefault(); openTag(); }
    else if (e.code === 'KeyH') { const dropId = invApi.dropSelected(); if (dropId) { dropItemInWorld(dropId); beep(340, .05, 'sine', .07); } }
    else if (e.code === 'KeyX' && pgState.held && !pgState.held.isCar) {
      const heldX = pgState.held;
      pgState.takePending = heldX.id + ':' + heldX.kind;
      physgunRelease(false);
      pgState.lmb = false;
      net.send({ t: 'prop', op: 'del', id: heldX.id }); // server deletes only for owner/friends
    }
  });

  // ---------- chat ----------
  const chatLog = $('chat-log');
  function addChat(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'chat-line ' + cls;
    d.innerHTML = html;
    chatLog.appendChild(d);
    while (chatLog.children.length > 40) chatLog.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 12000);
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) net.send({ t: 'chat', text });
    $('chat-input').value = '';
    closeChat();
  });
  function openChat() {
    input.chatOpen = true;
    $('chat-form').classList.remove('hidden');
    $('chat-input').focus();
  }
  function closeChat() {
    input.chatOpen = false;
    $('chat-form').classList.add('hidden');
    $('chat-input').blur();
    canvas.focus?.();
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !input.chatOpen && !mg.inArcade() && started) { openChat(); e.preventDefault(); }
    else if (e.code === 'Escape' && input.chatOpen) { if (tagOpen) closeTag(); else closeChat(); }
    else if (e.code === 'Escape' && started) {
      // Escape closes the top UI panel (craft/spawn/inventory/settings) like any game menu
      if (craftOpen) toggleCraft(false);
      else if (invApi.state.open) invApi.toggle(false);
      else if (!$('settings').classList.contains('hidden')) { $('settings').classList.add('hidden'); uiFocus('settings', false); }
    }
  });
  $('btn-chat').addEventListener('touchstart', (e) => { e.preventDefault(); input.chatOpen ? closeChat() : openChat(); }, { passive: false });

  // ---------- net handlers ----------
  net.on('init', (m) => {
    myId = m.id;
    phys.setMyId(m.id);
    my.x = m.you.x; my.y = m.you.y; my.z = m.you.z; my.ry = m.you.ry;
    mg.applyInit(m);
    for (const [cid, c] of Object.entries(m.cars || {})) {
      const car = W.cars?.find(k => k.id === cid);
      if (!car) continue;
      if (Array.isArray(c.p)) phys.applyCarState({ id: cid, p: c.p, q: c.q || [0, 0, 0, 1], v: null }, true);
      car.driver = c.driver;
      if (c.driver) car.col.off = true;
    }
    me.admin = !!m.admin;
    invApi.restore(m.inv, m.hotbar); // server copy of the inventory wins
    (m.mapEdits || []).forEach(p => props.add(p));
    (m.sleepers || []).forEach(addSleeper);
    (m.props || []).forEach(pr => phys.add(pr));
    (m.tags || []).forEach(addMark);
    (m.drops || []).forEach(addWorldDrop);
    (m.builds || []).forEach(addBuild);
    (m.npcs || []).forEach(([id, kind, x, z, ry]) => ensureNpc(id, kind, x, z, ry));
    myFriends = m.friends || [];
    renderFriends();
    // the HALL OF RECORDS by the front walkway — numbers that only ever grow
    if (m.visitorNum) {
      const pad6 = (v) => String(Math.min(v ?? 0, 999999)).padStart(6, '0');
      const st = m.stats || {};
      const dayN = Math.max(1, Math.floor((Date.now() - (st.since || Date.now())) / 864e5) + 1);
      const signTex = ct(1024, 512, (g, w, h) => {
        g.fillStyle = '#0d1116'; g.fillRect(0, 0, w, h);
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, 'rgba(255,153,0,.08)'); grd.addColorStop(.4, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#2c343e'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
        g.textAlign = 'center';
        g.fillStyle = '#ff9900'; g.font = '800 46px "Segoe UI", sans-serif';
        g.fillText('PAE2 · HALL OF RECORDS', w / 2, 66);
        g.fillStyle = '#5d6b7a'; g.font = '600 27px "Segoe UI", sans-serif';
        g.fillText(`you are associate № ${m.visitorNum} · day ${dayN} of forever`, w / 2, 108);
        g.fillStyle = '#ffb52e'; g.font = '700 108px Consolas, monospace';
        g.shadowColor = '#ffb52e'; g.shadowBlur = 24;
        g.fillText(pad6(st.joins ?? m.visitorNum), w / 2, 222);
        g.shadowBlur = 0;
        g.fillStyle = '#8fa0b3'; g.font = '700 26px "Segoe UI", sans-serif';
        g.fillText('TOTAL BADGE-INS, ALL TIME', w / 2, 262);
        const rows = [
          ['💤 naps taken', st.naps], ['🖊️ marks left', st.marks],
          ['📦 props spawned', st.props], ['🌳 trees flattened', st.knocks],
          ['🎒 items dropped', st.drops], ['🔥 items burned', st.burns],
          ['🚗 joyrides', st.joyrides], ['🏎️ lambo found', st.lambo],
          ['🏆 games won', st.wins], ['💀 incidents', st.kills],
        ];
        rows.forEach(([label, v], i) => {
          const cx = (i % 2) ? w * .73 : w * .27;
          const cy = 316 + Math.floor(i / 2) * 38;
          g.fillStyle = '#9fb0c3'; g.font = '600 26px "Segoe UI", sans-serif'; g.textAlign = 'right';
          g.fillText(label, cx + 30, cy);
          g.fillStyle = '#ffd34d'; g.font = '700 26px Consolas, monospace'; g.textAlign = 'left';
          g.fillText(String(v ?? 0), cx + 48, cy);
        });
        g.textAlign = 'center';
        g.fillStyle = '#44515f'; g.font = 'italic 23px "Segoe UI", sans-serif';
        g.fillText('nothing here resets · the lights stay on', w / 2, 496);
      });
      const sg = new THREE.Group();
      const postM = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: .6 });
      for (const px of [-1.6, 1.6]) { // posts at the EDGES — nothing through the numbers
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 2.6, 8), postM);
        post.position.set(px, 1.3, 0);
        sg.add(post);
      }
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.85), new THREE.MeshBasicMaterial({ map: signTex }));
      panel.position.y = 2.6;
      sg.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.85), new THREE.MeshStandardMaterial({ color: 0x181d23, roughness: .8, side: THREE.BackSide }));
      back.position.set(0, 2.6, .012);
      sg.add(back);
      // plaque under the board: tell people about the marker
      const plaqueTex = ct(768, 96, (g, w, h) => {
        g.fillStyle = '#161b21'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#3a4450'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
        g.fillStyle = '#ffd34d'; g.font = '600 36px "Segoe UI", sans-serif'; g.textAlign = 'center';
        g.fillText('🖊️  press G to leave your mark — it stays forever', w / 2, 62);
      });
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.1, .39), new THREE.MeshBasicMaterial({ map: plaqueTex }));
      plaque.position.y = 1.43;
      sg.add(plaque);
      sg.position.set(103, 0, 6.6);
      sg.rotation.y = Math.PI;
      scene.add(sg);
      W.colliders.push({ x0: 101.2, x1: 101.6, z0: 6.4, z1: 6.8 }, { x0: 104.4, x1: 104.8, z0: 6.4, z1: 6.8 });
      addChat(`📟 You are associate №${m.visitorNum}. The break room remembers everyone.`, 'sys');
    }
    setHp(m.hp ?? 100, false);
    if (me.admin && !editor) editor = initEditor({ scene, camera, props, toast });
    $('online-count').textContent = m.online;
    for (const p of m.players) addOther(p);
    $('login').classList.add('hidden');
    $('hud').classList.remove('hidden');
    addChat(input.isTouch
      ? '🅿️ You are in the parking lot. Left thumb to walk — head inside and badge through the gates.'
      : '🅿️ You are in the parking lot. WASD to walk — head through the front doors and badge in (E at the gates).', 'sys');
    if (me.admin) addChat('👑 Admin: press the 🛠️ button to open the level editor.', 'sys');
  });
  net.on('pj', (m) => { addOther(m.p); $('online-count').textContent = m.online; });
  net.on('pl', (m) => {
    const o = others.get(m.id);
    if (o) { scene.remove(o.avatar.group); others.delete(m.id); }
    $('online-count').textContent = m.online;
  });
  net.on('ps', (m) => {
    for (const [id, x, y, z, ry, anim, seat, held] of m.d) {
      if (id === myId) continue;
      const o = others.get(id);
      if (!o) continue;
      o.target = { x, y, z, ry };
      o.avatar.anim = anim;
      o.avatar.airborne = y > .15 && anim !== 'sit';
      o.avatar.setHeld(held);
    }
  });
  net.on('chat', (m) => {
    addChat(`<span class="who">${esc(m.name)}:</span> ${esc(m.text)}`);
    beep(880, .03, 'sine', .05);
    if (m.id === myId) myAvatar.say(m.text);
    else others.get(m.id)?.avatar.say(m.text);
  });
  net.on('sys', (m) => addChat(esc(m.text), 'sys'));

  // ---------- health ----------
  const hpFill = $('hp-fill'), dmgFlash = $('dmg-flash');
  function setHp(v, hurt) {
    hpFill.style.width = Math.max(0, Math.min(100, v)) + '%';
    hpFill.style.background = v > 60 ? '#37e06f' : v > 30 ? '#f2c521' : '#e2262d';
    if (hurt) {
      dmgFlash.style.opacity = .6;
      setTimeout(() => { dmgFlash.style.opacity = 0; }, 130);
      beep(170, .1, 'sawtooth', .13);
    }
  }
  function hitmarker(hs) {
    const hm = $('hitmark');
    hm.style.opacity = 1;
    clearTimeout(hitmarker._t);
    hitmarker._t = setTimeout(() => { hm.style.opacity = 0; }, 140);
    beep(hs ? 1250 : 950, .05, 'sine', .14);
    if (hs) {
      const ht = $('headshot-tag');
      ht.style.opacity = 1;
      clearTimeout(hitmarker._h);
      hitmarker._h = setTimeout(() => { ht.style.opacity = 0; }, 550);
    }
  }
  net.on('hp', (m) => {
    if (m.id === myId) { setHp(m.hp, m.by != null); return; }
    others.get(m.id)?.avatar.flash?.(); // victims glow red so everyone can tell
    if (m.by === myId) hitmarker(m.hs === true);
  });
  net.on('died', (m) => {
    setHp(100, false);
    my.x = m.x; my.z = m.z; my.y = 0; my.vy = 0;
    my.vel.x = 0; my.vel.z = 0;
    my.held = null;
    myAvatar.setHeld(null);
    net.send({ t: 'held', item: null });
    invApi.restore(new Array(24).fill(null), new Array(6).fill(null));
    updateViewmodel();
    dmgFlash.style.opacity = .9;
    setTimeout(() => { dmgFlash.style.opacity = 0; }, 700);
    toast(`💀 ${m.by} got you. Your stuff is scattered where you fell.`, 5600);
    beep(90, .5, 'sawtooth', .18);
    sendPos(true);
  });
  net.on('edit', (m) => props.applyServer(m));
  net.on('vest', (m) => {
    if (m.id === myId) myAvatar.setVest(m.vest);
    else {
      const o = others.get(m.id);
      if (o) { o.vest = m.vest; o.avatar.setVest(m.vest); }
    }
  });
  net.on('appear', (m) => {
    if (m.id === myId) { me.ap = m.ap; rebuildMyAvatar(); return; }
    const o = others.get(m.id);
    if (!o) return;
    o.ap = m.ap;
    const pos = o.avatar.group.position.clone();
    const ry = o.avatar.group.rotation.y;
    const held = o.avatar.held;
    scene.remove(o.avatar.group);
    o.avatar = makeAvatar(o.name, o.vest, false, o.ap);
    o.avatar.group.position.copy(pos);
    o.avatar.group.rotation.y = ry;
    o.avatar.setHeld(held);
    scene.add(o.avatar.group);
  });

  function addOther(p) {
    if (others.has(p.id)) return;
    const avatar = makeAvatar(p.name, p.vest, false, p.ap);
    avatar.group.position.set(p.x, p.y, p.z);
    enableShadows(avatar.group);
    scene.add(avatar.group);
    others.set(p.id, { avatar, name: p.name, vest: p.vest, ap: p.ap, target: { x: p.x, y: p.y, z: p.z, ry: p.ry } });
  }

  // ---------- sleepers: nobody disappears — leavers nap where they stood ----------
  const sleeperMap = new Map(); // key -> {root, zz, t}
  function zzzSprite() {
    const tex = ct(96, 96, (g, w, h) => {
      g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('💤', w / 2, h / 2 + 6);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(.5, .5, 1);
    sp.renderOrder = 5;
    return sp;
  }
  function addSleeper(s) {
    removeSleeper(s.key);
    const av = makeAvatar(s.name, s.vest, s.guest, s.ap);
    const root = new THREE.Group();
    root.position.set(s.x, 0, s.z);
    root.rotation.y = s.ry || 0;
    av.group.rotation.x = -Math.PI / 2;  // flat on their back
    av.group.position.set(0, .16, .9);   // back on the floor, body centered on the spot
    av.parts.armL.rotation.z = .55;      // relaxed nap pose
    av.parts.armR.rotation.z = -.35;
    av.parts.legL.rotation.x = -.35;     // one knee up, break-room classic
    av.parts.head.rotation.y = .4;
    av.shadow.visible = false;           // the round shadow would stand upright now
    av.group.remove(av.tag);             // name tag floats over the napper, not the feet
    av.tag.position.set(0, 1.0, 0);
    root.add(av.group, av.tag);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(.55, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .22, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = .02;
    sh.scale.set(.7, 1.6, 1);
    root.add(sh);
    const zz = zzzSprite();
    zz.position.set(.2, .7, -.7);
    root.add(zz);
    enableShadows(root);
    scene.add(root);
    sleeperMap.set(s.key, { root, zz, av, t: Math.random() * 6 });
  }
  function removeSleeper(key) {
    const e = sleeperMap.get(key);
    if (!e) return;
    scene.remove(e.root);
    sleeperMap.delete(key);
  }
  net.on('sleep', (m) => addSleeper(m.s));
  net.on('wake', (m) => removeSleeper(m.key));
  net.on('sleephurt', (m) => {
    sleeperMap.get(m.key)?.av?.flash?.();
    if (m.by === myId) hitmarker(false);
  });

  // ---------- dropped items on the floor (minecraft style) ----------
  const worldDrops = new Map(); // id -> {group, mesh, inter, t}
  function nearFire() {
    const f = W.anchors.fire;
    return f && Math.hypot(my.x - f.x, my.z - f.z) < 2.2;
  }
  function burnItems(id, n = 1) {
    toast(`🔥 ${ITEMS[id].icon} ${ITEMS[id].name}${n > 1 ? ' ×' + n : ''} went up in flames`, 3200);
    net.send({ t: 'burn', n }); // hall-of-records bookkeeping
    beep(200, .25, 'sawtooth', .1);
    setTimeout(() => beep(140, .3, 'sawtooth', .06), 180);
  }
  function dropItemInWorld(id, n = 1) {
    if (nearFire()) { burnItems(id, n); return; } // dropped into the barrel
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    // resolve against the walls so a drop can't land inside (or beyond) one
    const [dx2, dz2] = resolveCollisions(my.x + fx * 1.3, my.z + fz * 1.3, .3);
    net.send({ t: 'drop', op: 'add', item: id, n, x: +dx2.toFixed(2), y: .35, z: +dz2.toFixed(2) });
  }
  function addWorldDrop(d) {
    removeWorldDrop(d.id);
    const held = buildHeldMesh(d.item);
    if (!held) return;
    const group = new THREE.Group();
    const mesh = new THREE.Group(); // spin/bob pivot
    held.scale.setScalar(1.4);
    mesh.add(held);
    group.add(mesh);
    // held-item meshes are modeled around the hand grip — a broom extends a
    // meter BELOW its origin, so dropped ones sank through the floor (or,
    // lifted naively, hovered head-high). Lay tall items flat, then float
    // the bounding box just above the ground.
    let bb = new THREE.Box3().setFromObject(held);
    if (bb.max.y - bb.min.y > .7) {
      held.rotation.x = Math.PI / 2;
      held.updateMatrixWorld(true);
      bb = new THREE.Box3().setFromObject(held);
    }
    const lift = Math.max(.28, .16 - bb.min.y);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(.16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .2, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = .012;
    group.add(sh);
    group.position.set(d.x, 0, d.z);
    enableShadows(group);
    scene.add(group);
    const def = ITEMS[d.item];
    const it = { id: `drop-${d.id}`, type: 'dropitem', x: d.x, z: d.z, r: 1.2, label: `Pick up ${def.icon} ${def.name}${d.n > 1 ? ' ×' + d.n : ''}`, data: { drop: d.id } };
    W.interactables.push(it);
    worldDrops.set(d.id, { group, mesh, inter: it, t: Math.random() * 6, baseY: lift });
  }
  function removeWorldDrop(id) {
    const e = worldDrops.get(id);
    if (!e) return;
    scene.remove(e.group);
    const i = W.interactables.indexOf(e.inter);
    if (i !== -1) W.interactables.splice(i, 1);
    worldDrops.delete(id);
  }
  net.on('drop', (m) => {
    if (m.op === 'add') addWorldDrop(m.d);
    else if (m.op === 'del') { removeWorldDrop(m.id); if (m.taker === myId) beep(600, .06, 'sine', .1); }
    else if (m.op === 'grant') {
      if (invApi.add(m.item, m.n)) toast(`${ITEMS[m.item].icon} ${ITEMS[m.item].name} → inventory`);
      else dropItemInWorld(m.item); // full backpack: put it back on the floor
    }
  });

  // ---------- permanent marks (G): sharpie on the floor, forever ----------
  const tagGroup = new THREE.Group();
  scene.add(tagGroup);
  function addMark(tg) {
    const n = parseInt(String(tg.id).slice(1), 10) || 0;
    const tex = ct(256, 96, (g, w) => {
      let f = 30;
      const setF = () => { g.font = `italic 700 ${f}px "Segoe Print", "Comic Sans MS", cursive`; };
      setF();
      while (g.measureText(tg.text).width > w - 14 && f > 13) { f -= 2; setF(); }
      g.fillStyle = `hsla(${tg.hue}, 70%, 30%, .95)`; // dark enough to read on pale floors
      g.textAlign = 'center';
      g.fillText(tg.text, w / 2, 46);
      g.font = 'italic 15px "Segoe UI", sans-serif';
      g.fillStyle = 'rgba(20,26,34,.6)';
      g.fillText('— ' + tg.name, w / 2, 76);
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .64), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    // readable from where the writer stood, with a little hand-drawn wobble
    mesh.rotation.z = (tg.ry || 0) + Math.PI + ((n % 5) - 2) * .12;
    mesh.position.set(tg.x, .022 + (n % 7) * .0014, tg.z); // stacked ink never z-fights
    mesh.renderOrder = 2;
    tagGroup.add(mesh);
  }
  net.on('tag', (m) => { if (m.op === 'add') addMark(m.tag); });


  // ---------- NPCs: the herd and the horde ----------
  const npcMap = new Map(); // id -> {kind, group, legs, arms, head, t, tx, tz, try, mats}
  function buildNpcMesh(kind) {
    const g = new THREE.Group();
    const legs = [], arms = [];
    let head = null;
    const mats = [];
    const M2 = (c, r = .85) => { const m2 = new THREE.MeshStandardMaterial({ color: c, roughness: r }); mats.push(m2); return m2; };
    const bx = (w, h, d, m2, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m2); o.position.set(x, y, z); return o; };
    if (kind === 'cow') {
      const white = M2(0xf2efe8), black = M2(0x26262a);
      g.add(bx(.8, .7, 1.25, white, 0, .95, 0));
      g.add(bx(.82, .3, .45, black, 0, 1.05, .2));
      g.add(bx(.82, .25, .3, black, 0, .85, -.4));
      head = bx(.42, .42, .4, white, 0, 1.25, .8);
      head.add(bx(.44, .18, .12, M2(0xe8b8c8), 0, -.14, .18)); // muzzle
      g.add(head);
      for (const [lx, lz] of [[-.28, .45], [.28, .45], [-.28, -.45], [.28, -.45]]) {
        const leg = bx(.16, .6, .16, white, lx, .3, lz);
        legs.push(leg); g.add(leg);
      }
    } else if (kind === 'chicken') {
      const white = M2(0xf5f2ea);
      g.add(bx(.32, .3, .42, white, 0, .35, 0));
      head = bx(.18, .2, .18, white, 0, .62, .16);
      head.add(bx(.06, .05, .12, M2(0xe8920c, .6), 0, -.02, .14)); // beak
      head.add(bx(.05, .08, .06, M2(0xd42020, .7), 0, .12, .02));  // comb
      g.add(head);
      for (const lx of [-.08, .08]) {
        const leg = bx(.045, .22, .045, M2(0xe8920c, .6), lx, .11, 0);
        legs.push(leg); g.add(leg);
      }
    } else { // zombie
      const skin = M2(0x6a9c4e, .9), shirt = M2(0x3a3f46, .95);
      g.add(bx(.44, .62, .26, shirt, 0, 1.12, 0));
      head = bx(.3, .3, .3, skin, 0, 1.62, 0);
      // ember eyes so they read at night
      const eyeM = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff7a2a, emissiveIntensity: 2 });
      head.add(bx(.05, .04, .02, eyeM, -.07, .03, .16));
      head.add(bx(.05, .04, .02, eyeM, .07, .03, .16));
      g.add(head);
      // a lit torch in hand — see them coming
      const torchG = new THREE.Group();
      torchG.add(bx(.05, .4, .05, M2(0x5a4028, .9), 0, 0, 0));
      const flameM = new THREE.MeshStandardMaterial({ color: 0xffb42e, emissive: 0xff8a1c, emissiveIntensity: 2.6 });
      torchG.add(bx(.1, .16, .1, flameM, 0, .27, 0));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ct(64, 64, (gg, w2, h2) => {
          const gr = gg.createRadialGradient(w2 / 2, h2 / 2, 3, w2 / 2, h2 / 2, 30);
          gr.addColorStop(0, 'rgba(255,190,90,.9)'); gr.addColorStop(1, 'rgba(255,140,30,0)');
          gg.fillStyle = gr; gg.fillRect(0, 0, w2, h2);
        }),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(1.1, 1.1, 1);
      glow.position.y = .3;
      torchG.add(glow);
      torchG.position.set(.42, 1.25, .3);
      g.add(torchG);
      for (const ax of [-.3, .3]) { // arms out front, classic
        const arm = bx(.11, .11, .55, skin, ax, 1.3, .34);
        arms.push(arm); g.add(arm);
      }
      for (const lx of [-.12, .12]) {
        const leg = bx(.15, .8, .18, M2(0x2b3038, .95), lx, .4, 0);
        legs.push(leg); g.add(leg);
      }
    }
    enableShadows(g);
    return { group: g, legs, arms, head, mats };
  }
  function ensureNpc(id, kind, x, z, ry) {
    let n = npcMap.get(id);
    if (n) return n;
    const built = buildNpcMesh(kind);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = ry;
    scene.add(built.group);
    n = { id, kind, ...built, t: Math.random() * 9, tx: x, tz: z, try: ry };
    npcMap.set(id, n);
    return n;
  }
  function removeNpc(id, burn) {
    const n = npcMap.get(id);
    if (!n) return;
    scene.remove(n.group);
    npcMap.delete(id);
    if (burn) { // minecraft sunrise: they go up in flames
      beep(190, .3, 'sawtooth', .08);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ct(64, 96, (gg, w2, h2) => {
          const gr = gg.createLinearGradient(0, h2, 0, 0);
          gr.addColorStop(0, 'rgba(255,120,20,.95)'); gr.addColorStop(.7, 'rgba(255,200,60,.5)'); gr.addColorStop(1, 'rgba(255,240,160,0)');
          gg.fillStyle = gr; gg.fillRect(0, 0, w2, h2);
        }),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      fl.position.set(n.group.position.x, 1.1, n.group.position.z);
      fl.scale.set(1.2, 2, 1);
      scene.add(fl);
      let life = 1;
      const fade = () => {
        life -= .06;
        fl.material.opacity = Math.max(0, life);
        fl.position.y += .05;
        if (life > 0) requestAnimationFrame(fade);
        else scene.remove(fl);
      };
      fade();
    }
  }
  net.on('npcs', (m) => {
    const seen = new Set();
    for (const [id, kind, x, z, ry] of m.d) {
      seen.add(id);
      const n = ensureNpc(id, kind, x, z, ry);
      n.tx = x; n.tz = z; n.try = ry;
    }
    for (const id of [...npcMap.keys()]) if (!seen.has(id)) removeNpc(id);
  });
  net.on('npc', (m) => {
    if (m.op === 'del') removeNpc(m.id, m.burn);
    else if (m.op === 'hurt') {
      const n = npcMap.get(m.id);
      if (!n) return;
      for (const mt of n.mats) { mt.emissive.setHex(0xd42020); mt.emissiveIntensity = .8; }
      setTimeout(() => { for (const mt of n.mats) { mt.emissive.setHex(0); mt.emissiveIntensity = 0; } }, 150);
    }
  });

  // ---------- knockables: mow down the landscaping, it grows back ----------
  const knockAxis = new THREE.Vector3();
  function knockIt(k, dx, dz, mine) {
    if (k.down) return;
    k.down = true;
    k.t = 0;
    k.dx = dx; k.dz = dz;
    k.respawn = 24 + Math.random() * 8;
    if (k.col) k.col.off = true;
    if (mine) net.send({ t: 'knock', id: k.id, dx: +dx.toFixed(2), dz: +dz.toFixed(2) });
    beep(150, .12, 'square', .1);
  }
  net.on('knock', (m) => {
    const k = W.knockables.find(x => x.id === m.id);
    if (k && Number.isFinite(m.dx) && Number.isFinite(m.dz)) knockIt(k, m.dx, m.dz, false);
  });

  const tagForm = $('tag-form'), tagInput = $('tag-input');
  let tagOpen = false;
  function openTag() {
    if (tagOpen || carState.driving) return;
    tagOpen = true;
    input.chatOpen = true; // reuse the "typing" suppression of game keys
    tagForm.classList.remove('hidden');
    tagInput.focus();
  }
  function closeTag() {
    tagOpen = false;
    input.chatOpen = false;
    tagForm.classList.add('hidden');
    tagInput.blur();
    canvas.focus?.();
  }
  tagForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = tagInput.value.trim();
    if (text) net.send({ t: 'tag', text, x: my.x, z: my.z, ry: my.ry });
    tagInput.value = '';
    closeTag();
  });

  // props are CRAFTED now (C) — equip one and click to place it in the world
  function spawnProp(kind) { // kept for the debug handle / tests
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    net.send({ t: 'prop', op: 'spawn', kind, p: [+(my.x + fx * 2.2).toFixed(2), 1.3, +(my.z + fz * 2.2).toFixed(2)] });
  }
  function placeProp() {
    const kind = my.held;
    if (ITEMS[kind]?.type !== 'prop') return;
    const used = invApi.dropSelected();
    if (used !== kind) return;
    spawnProp(kind);
    toast(`${ITEMS[kind].icon} placed`);
  }

  // ---------- crafting (C) — rust-lite ----------
  const RECIPES = [
    { id: 'axe', cost: { wood: 15 }, desc: 'Chops trees 2× faster, 14 dmg' },
    { id: 'pickaxe', cost: { wood: 12, stone: 6 }, desc: 'Mines rocks 2× faster, 12 dmg' },
    { id: 'stoneaxe', cost: { wood: 12, stone: 18 }, desc: 'Upgraded axe: 3× wood, 18 dmg' },
    { id: 'stonepick', cost: { wood: 10, stone: 22 }, desc: 'Upgraded pick: 3× stone, 15 dmg' },
    { id: 'wall', cost: { wood: 12 }, desc: 'Placeable wall · upgradable to stone' },
    { id: 'floor', cost: { wood: 8 }, desc: 'Placeable floor panel' },
    { id: 'pistol', cost: { wood: 25, stone: 40 }, desc: 'Hitscan, 20 dmg — 40 on headshots' },
    { id: 'door', cost: { wood: 14 }, desc: 'Fading door — E opens it for you & friends' },
    { id: 'box', cost: { wood: 2 }, desc: 'Physics prop' },
    { id: 'crate', cost: { wood: 6 }, desc: 'Physics prop, heavy' },
    { id: 'ball', cost: { wood: 2, stone: 2 }, desc: 'Physics prop, bouncy' },
    { id: 'barrel', cost: { stone: 6 }, desc: 'Physics prop' },
    { id: 'melon', cost: { wood: 3 }, desc: 'Physics prop, organic' },
    { id: 'cone', cost: { stone: 3 }, desc: 'Physics prop, official' },
  ];
  const craftEl = $('craft-menu'), craftList = $('craft-list'), craftHave = $('craft-have');
  let craftOpen = false;
  function renderCraft() {
    craftHave.textContent = `you have: 🪵 ${invApi.count('wood')} wood · 🪨 ${invApi.count('stone')} stone`;
    craftList.innerHTML = '';
    for (const r of RECIPES) {
      const d = ITEMS[r.id];
      const cost = Object.entries(r.cost).map(([k, v]) => `${ITEMS[k].icon}${v}`).join(' + ');
      const can = Object.entries(r.cost).every(([k, v]) => invApi.count(k) >= v);
      const row = document.createElement('div');
      row.className = 'craft-row';
      row.innerHTML = `<span class="ci">${d.icon}</span><span class="cn">${d.name}<small>${cost} — ${r.desc}</small></span>`;
      const b = document.createElement('button');
      b.textContent = 'Craft';
      b.disabled = !can;
      b.onclick = () => {
        if (!Object.entries(r.cost).every(([k, v]) => invApi.count(k) >= v)) return;
        for (const [k, v] of Object.entries(r.cost)) invApi.consume(k, v);
        invApi.add(r.id);
        beep(740, .09, 'sine', .1);
        toast(`🔨 Crafted ${d.icon} ${d.name}`);
        renderCraft();
      };
      row.appendChild(b);
      craftList.appendChild(row);
    }
  }
  function toggleCraft(open) {
    craftOpen = open ?? !craftOpen;
    craftEl.classList.toggle('hidden', !craftOpen);
    uiFocus('craft', craftOpen);
    if (craftOpen) renderCraft();
  }
  // inventory ⇄ crafting cross links
  $('btn-inv-craft').onclick = () => { invApi.toggle(false); toggleCraft(true); };
  $('btn-craft-inv').onclick = () => { toggleCraft(false); invApi.toggle(true); };

  // ---------- base building: walls & floors with hp and upgrades ----------
  const buildMap = new Map(); // id -> {b, mesh, col, body, inter}
  const tierM = {
    woodWall: new THREE.MeshStandardMaterial({ map: woodTexture('#a8896a', '#8a6a4e'), roughness: .85 }),
    stoneWall: new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: .95 }),
  };
  function buildLabel(b) {
    if (b.kind === 'door') return 'Door — E opens (owner & friends)';
    return b.tier === 'wood'
      ? `${b.kind === 'wall' ? 'Wall' : 'Floor'} (wood) — E: upgrade to stone (15 🪨)`
      : `${b.kind === 'wall' ? 'Wall' : 'Floor'} (stone)`;
  }
  function addBuild(b) {
    removeBuild(b.id);
    let mat = b.tier === 'wood' ? tierM.woodWall : tierM.stoneWall;
    if (b.kind === 'door') mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: .8, transparent: true }); // per-door: it fades
    const mesh = b.kind === 'wall'
      ? new THREE.Mesh(new THREE.BoxGeometry(3, 3, .22), mat)
      : b.kind === 'door'
        ? new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.7, .16), mat)
        : new THREE.Mesh(new THREE.BoxGeometry(3, .15, 3), mat);
    mesh.position.set(b.p[0], b.p[1], b.p[2]);
    mesh.rotation.y = b.ry;
    enableShadows(mesh);
    scene.add(mesh);
    let col = null, body = null;
    if (b.kind === 'wall' || b.kind === 'door') { // yaw-aware AABB + static body
      const hw2 = b.kind === 'door' ? .8 : 1.5;
      const s = Math.abs(Math.sin(b.ry)), c = Math.abs(Math.cos(b.ry));
      const ex = hw2 * s + .13 * c, ez = hw2 * c + .13 * s;
      col = { x0: b.p[0] - ex, x1: b.p[0] + ex, z0: b.p[2] - ez, z1: b.p[2] + ez };
      W.colliders.push(col);
      body = phys.addStatic(col.x0, col.x1, col.z0, col.z1, 0, b.kind === 'door' ? 2.7 : 3);
    }
    const inter = { id: `build-${b.id}`, type: 'build', x: b.p[0], z: b.p[2], r: 2.4, label: buildLabel(b), data: { build: b.id } };
    W.interactables.push(inter);
    buildMap.set(b.id, { b, mesh, col, body, inter });
  }
  function removeBuild(id) {
    const e = buildMap.get(id);
    if (!e) return;
    scene.remove(e.mesh);
    if (e.col) { const i = W.colliders.indexOf(e.col); if (i !== -1) W.colliders.splice(i, 1); }
    if (e.body) phys.removeStatic(e.body);
    const j = W.interactables.indexOf(e.inter);
    if (j !== -1) W.interactables.splice(j, 1);
    buildMap.delete(id);
  }
  net.on('build', (m) => {
    if (m.op === 'add') addBuild(m.b);
    else if (m.op === 'del') { removeBuild(m.id); beep(120, .2, 'square', .12); }
    else if (m.op === 'hp') {
      const e = buildMap.get(m.id);
      if (e) { e.b.hp = m.hp; e.mesh.position.y += .015; setTimeout(() => { e.mesh.position.y = e.b.p[1]; }, 60); }
    } else if (m.op === 'upgrade') {
      const e = buildMap.get(m.id);
      if (e) { e.b.tier = m.tier; e.b.hp = m.hp; addBuild(e.b); beep(820, .1, 'sine', .12); }
    } else if (m.op === 'fade') { // gmod fading door: see-through + passable for 4s
      const e = buildMap.get(m.id);
      if (!e || e.fading) return;
      e.fading = true;
      e.mesh.material.opacity = .22;
      if (e.col) e.col.off = true;
      if (e.body) { phys.removeStatic(e.body); e.body = null; }
      beep(980, .08, 'sine', .1);
      setTimeout(() => {
        if (!buildMap.has(m.id)) return;
        e.fading = false;
        e.mesh.material.opacity = 1;
        if (e.col) {
          e.col.off = false;
          e.body = phys.addStatic(e.col.x0, e.col.x1, e.col.z0, e.col.z1, 0, 2.7);
        }
        beep(620, .08, 'sine', .09);
      }, 4000);
    }
  });
  // placement ghost while a build item is equipped
  const ghostM = new THREE.MeshBasicMaterial({ color: 0x37e06f, transparent: true, opacity: .35, depthWrite: false });
  const ghosts = {
    wall: new THREE.Mesh(new THREE.BoxGeometry(3, 3, .22), ghostM),
    floor: new THREE.Mesh(new THREE.BoxGeometry(3, .15, 3), ghostM),
    door: new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.7, .16), ghostM),
  };
  ghosts.wall.visible = ghosts.floor.visible = ghosts.door.visible = false;
  scene.add(ghosts.wall, ghosts.floor, ghosts.door);
  function ghostPose() {
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    const ry = Math.round(my.yaw / (Math.PI / 12)) * (Math.PI / 12);
    return { x: +(my.x + fx * 2.9).toFixed(2), z: +(my.z + fz * 2.9).toFixed(2), ry: +ry.toFixed(3) };
  }
  function placeBuild() {
    // walls/floors/doors are PROPS now (darkrp): they spawn frozen at the
    // ghost pose, and you physgun-grab to reposition, right-click to refreeze
    const kind = my.held;
    const g = ghostPose();
    const used = invApi.dropSelected(); // consumes one from the equipped stack
    if (used !== kind) return;
    const y = kind === 'wall' ? 1.5 : kind === 'door' ? 1.35 : .1;
    const h = g.ry / 2;
    net.send({ t: 'prop', op: 'spawn', kind, p: [g.x, y, g.z], q: [0, +Math.sin(h).toFixed(3), 0, +Math.cos(h).toFixed(3)], frozen: true });
    beep(520, .07, 'sine', .1);
  }

  // ---------- pistol ----------
  const tracers = []; // {line, ttl}
  const tracerM = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthTest: false });
  function drawTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, tracerM.clone());
    line.renderOrder = 8;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, ttl: .12 });
  }
  let lastFire = 0;
  function firePistol() {
    const now = performance.now();
    if (now - lastFire < 380) return;
    lastFire = now;
    myAvatar.swing();
    vmSwing = 1;
    beep(1600, .03, 'square', .12);
    beep(160, .12, 'sawtooth', .16);
    // small ray fan — a single hairline ray whiffs on thin avatars at range
    let best = null; // {d, kind, id, point, hs}
    for (const [ox, oy] of [[0, 0], [.012, 0], [-.012, 0], [0, .012], [0, -.012]]) {
      pgRay.setFromCamera(new THREE.Vector2(ox, oy), camera);
      pgRay.far = 50;
      for (const [id, o] of others) {
        const hits = pgRay.intersectObject(o.avatar.group, true);
        if (hits.length && (!best || hits[0].distance < best.d)) {
          const hy = hits[0].point.y - o.avatar.group.position.y;
          best = { d: hits[0].distance, kind: 'player', id, point: hits[0].point, hs: hy > 1.45 };
        }
      }
      for (const [key, s] of sleeperMap) {
        const hits = pgRay.intersectObject(s.root, true);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { d: hits[0].distance, kind: 'sleeper', id: key, point: hits[0].point, hs: false };
      }
      for (const [nid, n] of npcMap) {
        const hits = pgRay.intersectObject(n.group, true);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { d: hits[0].distance, kind: 'npc', id: nid, point: hits[0].point };
      }
      for (const e of buildMap.values()) {
        const hits = pgRay.intersectObject(e.mesh, false);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { d: hits[0].distance, kind: 'build', id: e.b.id, point: hits[0].point };
      }
    }
    pgRay.setFromCamera(new THREE.Vector2(0, 0), camera);
    pgRay.far = 50;
    const wallHits = pgRay.intersectObjects(W.camBlockers, false);
    if (wallHits.length && (!best || wallHits[0].distance < best.d)) best = { d: wallHits[0].distance, kind: 'world', point: wallHits[0].point };
    const end = best ? best.point : pgRay.ray.origin.clone().addScaledVector(pgRay.ray.direction, 50);
    drawTracer(myBeamFrom(), end);
    net.send({ t: 'shoot', to: [+end.x.toFixed(1), +end.y.toFixed(1), +end.z.toFixed(1)] });
    if (best?.kind === 'player') net.send({ t: 'hit', target: best.id, item: 'pistol', hs: best.hs });
    else if (best?.kind === 'sleeper') net.send({ t: 'hit', sleeper: best.id, item: 'pistol' });
    else if (best?.kind === 'npc') net.send({ t: 'hit', npc: best.id, item: 'pistol' });
    else if (best?.kind === 'build') net.send({ t: 'build', op: 'hit', id: best.id, item: 'pistol' });
  }
  net.on('shoot', (m) => {
    const o = others.get(m.id);
    const from = o ? o.avatar.heldAnchor.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(m.from[0], m.from[1], m.from[2]);
    drawTracer(from, new THREE.Vector3(m.to[0], m.to[1], m.to[2]));
    beep(1400, .03, 'square', .07);
  });

  // ---------- physgun: hold LMB to grab · wheel push/pull · R spin · X delete ----------
  const muzzleV = new THREE.Vector3();
  function myBeamFrom() { // the beam starts at the GUN, gmod-style
    if (fp) return camera.localToWorld(muzzleV.set(.31, -.26, -.75)); // viewmodel gun tip
    return myAvatar.heldAnchor.getWorldPosition(muzzleV);
  }
  const pgState = { held: null, dist: 0, lmb: false, missT: 0 };
  const pgRay = new THREE.Raycaster();
  function pgEquipped() { return my.held === 'physgun'; }
  function pgPick() {
    // fan of rays around the crosshair so edge clicks still land
    let best = null;
    for (const [ox, oy] of [[0, 0], [.028, 0], [-.028, 0], [0, .028], [0, -.028], [.055, 0], [-.055, 0], [0, .055], [0, -.055]]) {
      pgRay.setFromCamera(new THREE.Vector2(ox, oy), camera);
      const hit = phys.raycast(pgRay, 22);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
  function physgunGrab(hitOpt = null) {
    if (!pgEquipped() || pgState.held) return;
    const hit = hitOpt || pgPick();
    if (!hit) return;
    if (hit.e.frozen) phys.setFrozen(hit.e, false); // thaw to move (server re-freezes on veto)
    pgState.held = hit.e;
    pgState.lastYaw = my.yaw; // view-follow rotation baseline
    // gmod grip: remember WHERE on the object you grabbed it
    pgState.anchor = phys.grabLocal(hit.e, hit.point.x, hit.point.y, hit.point.z);
    pgState.anchorOut = new hit.e.body.position.constructor();
    pgState.dist = Math.max(1.6, Math.min(hit.e.isCar ? 16 : 12, hit.distance));
    hit.e.grabbedBy = myId;
    phys.claim(hit.e);
    hit.e.body.angularDamping = .92;
    net.send({ t: hit.e.isCar ? 'car' : 'prop', op: 'grab', id: hit.e.id });
    beep(880, .06, 'square', .05);
  }
  function physgunRelease(throwIt = true) {
    const e = pgState.held;
    if (!e) return;
    pgState.held = null;
    e.grabbedBy = null;
    e.body.angularDamping = e.isCar ? .6 : .35;
    net.send({ t: e.isCar ? 'car' : 'prop', op: 'drop', id: e.id });
    if (throwIt) (e.isCar ? phys.sendCarState : phys.sendState)(e); // carries the fling velocity
    beep(440, .05, 'square', .04);
  }
  addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !input.locked || input.uiOpen || input.chatOpen) return;
    if (pgEquipped()) {
      pgState.lmb = true;
      physgunGrab();
      if (!pgState.held) beep(220, .05, 'square', .04); // dry-fire click
    } else if (my.held === 'pistol') firePistol();
    else if (ITEMS[my.held]?.type === 'build') placeBuild();
    else if (ITEMS[my.held]?.type === 'prop') placeProp();
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    pgState.lmb = false;
    if (pgState.held) physgunRelease();
  });
  // gmod: right-click freezes the held prop right where it is. Under pointer
  // lock the reliable signal is mousedown button 2 — the contextmenu event
  // doesn't fire consistently while locked.
  function freezeHeld() {
    if (!pgEquipped() || !pgState.held || pgState.held.isCar) return;
    const now2 = performance.now();
    if (now2 - (freezeHeld._t || 0) < 150) return; // both events may arrive
    freezeHeld._t = now2;
    const held = pgState.held;
    const b = held.body;
    const fp = [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)];
    const fq = [+b.quaternion.x.toFixed(3), +b.quaternion.y.toFixed(3), +b.quaternion.z.toFixed(3), +b.quaternion.w.toFixed(3)];
    physgunRelease(false);
    pgState.lmb = false; // fresh click required — no instant re-grab
    phys.setFrozen(held, true);
    net.send({ t: 'prop', op: 'freeze', id: held.id, frozen: true, p: fp, q: fq });
    toast('🧊 Frozen in place — physgun-grab it to move it again.');
    beep(1150, .07, 'sine', .1);
  }
  addEventListener('mousedown', (e) => {
    if (e.button === 2 && input.locked) { e.preventDefault(); freezeHeld(); }
  });
  addEventListener('contextmenu', (e) => {
    if (!input.locked) return;
    e.preventDefault(); // no browser menu in-game; freeze fallback for odd setups
    freezeHeld();
  });

  // beams: one for me, plus one per prop another player is holding
  function glowDot() {
    const tex = ct(64, 64, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 30);
      r.addColorStop(0, 'rgba(150,240,255,1)'); r.addColorStop(1, 'rgba(53,224,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false }));
    sp.scale.set(.55, .55, 1);
    sp.renderOrder = 7;
    return sp;
  }
  // physgun beam: a real glowing beam (outer haze + bright core) instead of a
  // 1px line, anchored at the gun muzzle
  function makeBeamMesh() {
    const g = new THREE.Group();
    const geoOut = new THREE.CylinderGeometry(.03, .016, 1, 6, 1, true);
    geoOut.rotateX(Math.PI / 2);
    const geoIn = new THREE.CylinderGeometry(.011, .006, 1, 6, 1, true);
    geoIn.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(geoOut, new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false })));
    g.add(new THREE.Mesh(geoIn, new THREE.MeshBasicMaterial({ color: 0xd8f8ff, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false })));
    g.renderOrder = 7;
    return g;
  }
  const beams = new Map(); // key ('me' | id) -> {group, dot}
  const beamV = new THREE.Vector3();
  const beamMid = new THREE.Vector3();
  const beamV2 = new THREE.Vector3();
  function beamFor(key) {
    let b = beams.get(key);
    if (!b) {
      const group = makeBeamMesh();
      const dot = glowDot();
      scene.add(group, dot);
      b = { group, dot };
      beams.set(key, b);
    }
    return b;
  }
  function setBeam(key, from, to, alpha = 1) {
    const b = beamFor(key);
    beamMid.addVectors(from, to).multiplyScalar(.5);
    b.group.position.copy(beamMid);
    b.group.lookAt(to);
    const len = from.distanceTo(to);
    b.group.scale.set(1, 1, Math.max(.001, len));
    b.group.children[0].material.opacity = .3 * alpha;
    b.group.children[1].material.opacity = .85 * alpha;
    b.dot.position.copy(to);
    b.dot.material.opacity = alpha;
  }
  function updateBeams() {
    const live = new Set();
    if (pgState.held) {
      live.add('me');
      const aw = phys.anchorWorld(pgState.held, pgState.anchor, pgState.anchorOut);
      setBeam('me', myBeamFrom(), beamV.set(aw.x, aw.y, aw.z), 1);
    } else if (pgState.lmb && pgEquipped()) {
      physgunGrab(); // sweep the beam onto something and it latches on
      if (pgState.held) { updateBeams(); return; }
      // gmod-style: the beam fires even with nothing grabbed, ending on
      // whatever the crosshair touches (dimmer — it isn't holding anything)
      live.add('me');
      pgRay.setFromCamera(new THREE.Vector2(0, 0), camera);
      pgRay.far = 20;
      let end = null;
      const hit = phys.raycast(pgRay, 20);
      if (hit) end = hit.point;
      else {
        const wallHits = pgRay.intersectObjects(W.camBlockers, false);
        if (wallHits.length) end = wallHits[0].point;
        else if (pgRay.ray.direction.y < -.001) { // floor
          const t = -pgRay.ray.origin.y / pgRay.ray.direction.y;
          if (t > 0 && t < 20) end = pgRay.ray.origin.clone().addScaledVector(pgRay.ray.direction, t);
        }
        if (!end) end = pgRay.ray.origin.clone().addScaledVector(pgRay.ray.direction, 20);
      }
      setBeam('me', myBeamFrom(), end, .35);
    }
    for (const e of [...phys.props.values(), ...phys.cars.values()]) {
      if (e.grabbedBy && e.grabbedBy !== myId) {
        const o = others.get(e.grabbedBy);
        if (!o) continue;
        live.add(e.id);
        const ip2 = e.body.interpolatedPosition;
        setBeam(e.id, o.avatar.heldAnchor.getWorldPosition(beamV), beamV2.set(ip2.x, ip2.y, ip2.z), 1);
      }
    }
    for (const [key, b] of beams) {
      if (!live.has(key)) { scene.remove(b.group, b.dot); beams.delete(key); }
    }
  }

  net.on('prop', (m) => {
    if (m.op === 'add') {
      const mine = m.owner === myId;
      phys.add(m.prop, { mine });
      if (mine) beep(620, .07, 'sine', .08);
    } else if (m.op === 'state') phys.applyState(m);
    else if (m.op === 'del') {
      if (pgState.held?.id === m.id) physgunRelease(false);
      if (pgState.takePending?.startsWith(m.id + ':')) { // confirmed: back to my pockets
        const kind = pgState.takePending.split(':')[1];
        pgState.takePending = null;
        if (ITEMS[kind]) { invApi.add(kind); toast(`${ITEMS[kind].icon} ${ITEMS[kind].name} → inventory`); }
        beep(640, .07, 'sine', .1);
      }
      phys.remove(m.id);
    } else if (m.op === 'grab') {
      const e = phys.props.get(m.id);
      if (e) { e.grabbedBy = m.by; e.owned = false; }
    } else if (m.op === 'drop') {
      const e = phys.props.get(m.id);
      if (e) {
        e.grabbedBy = null;
        if (pgState.held === e) { physgunRelease(false); pgState.lmb = false; toast('🔒 Not yours — ask the owner to add you as a friend.'); }
      }
    } else if (m.op === 'freeze') {
      const e = phys.props.get(m.id);
      if (!e) return;
      if (m.frozen && Array.isArray(m.p)) {
        e.body.position.set(m.p[0], m.p[1], m.p[2]);
        e.body.quaternion.set(m.q[0], m.q[1], m.q[2], m.q[3]);
        e.body.interpolatedPosition.copy(e.body.position);
        e.body.interpolatedQuaternion.copy(e.body.quaternion);
        e.mesh.position.copy(e.body.position);
        e.mesh.quaternion.copy(e.body.quaternion);
      }
      phys.setFrozen(e, m.frozen === true);
      if (m.frozen && pgState.held === e) physgunRelease(false);
    } else if (m.op === 'fade') { // fading door: passable + see-through for 4s
      const e = phys.props.get(m.id);
      if (!e || e.fading) return;
      e.fading = true;
      e.mesh.traverse(o => { if (o.material?.transparent !== undefined && o.material.color) o.material.opacity = .22; });
      e.body.collisionResponse = false;
      if (e.walkCol) e.walkCol.off = true;
      beep(980, .08, 'sine', .1);
      setTimeout(() => {
        if (!phys.props.has(m.id)) return;
        e.fading = false;
        e.mesh.traverse(o => { if (o.material?.color) o.material.opacity = 1; });
        e.body.collisionResponse = true;
        if (e.walkCol && e.frozen) e.walkCol.off = false;
        beep(620, .08, 'sine', .09);
      }, 4000);
    }
  });

  addEventListener('pagehide', () => { try { invApi.flush(); } catch {} });
  connect(token, {
    onOpen: () => {},
    onClose: (e) => {
      $('hud').classList.add('hidden');
      if (e.code === 4001) { localStorage.clear(); location.reload(); return; }
      if (e.code === 4002) {
        $('disc-reason').textContent = 'You logged in from another device.';
        $('disconnected').classList.remove('hidden');
        return;
      }
      // server restart / blip: your napper is holding your spot — poll until
      // the server is back, then rejoin (a blind reload would strand the tab
      // on a connection-refused page)
      $('disc-reason').textContent = 'Lost connection — waking you back up…';
      $('disconnected').classList.remove('hidden');
      const retry = async () => {
        try { await fetch('/play', { method: 'HEAD', cache: 'no-store' }); location.reload(); }
        catch { setTimeout(retry, 2000); }
      };
      setTimeout(retry, 1800);
    },
  });
  $('btn-reconnect').onclick = () => location.reload();

  // ---------- settings ----------
  const AP_DEFS = [
    ['ap-skin', 'skin', SKINS.map(c => '#' + c.toString(16).padStart(6, '0'))],
    ['ap-shirt', 'shirt', SHIRTS.map(c => '#' + c.toString(16).padStart(6, '0'))],
    ['ap-hair', 'hair', HAIRS.map(c => '#' + c.toString(16).padStart(6, '0'))],
    ['ap-hat', 'hat', HATS],
  ];
  function buildApRows() {
    for (const [elId, field, opts] of AP_DEFS) {
      const row = $(elId);
      row.innerHTML = '';
      opts.forEach((opt, i) => {
        const b = document.createElement('button');
        if (String(opt).startsWith('#')) b.style.setProperty('--c', opt);
        else { b.classList.add('txt'); b.textContent = opt; }
        b.classList.toggle('sel', (me.ap?.[field] ?? -1) === i);
        b.onclick = () => {
          me.ap = { ...(me.ap || {}), [field]: i };
          rebuildMyAvatar();
          net.send({ t: 'appear', ap: me.ap });
          row.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
        };
        row.appendChild(b);
      });
    }
  }
  const openSettings = () => {
    $('settings').classList.remove('hidden');
    uiFocus('settings', true);
    buildApRows();
    document.querySelectorAll('.vest').forEach(b => b.classList.toggle('sel', b.dataset.vest === me.vest));
    const s = me.stats;
    $('stats-box').innerHTML = me.guest
      ? 'Guest session — create an account to save stats.'
      : `🏓 Pong wins: <b>${s.pongWins || 0}</b> · 🔴 Connect 4 wins: <b>${s.c4Wins || 0}</b> · ♟️ Chess wins: <b>${s.chessWins || 0}</b>`;
  };
  // friends whitelist (prop & base protection)
  let myFriends = [];
  function renderFriends() {
    const el = $('friends-list');
    el.innerHTML = '';
    for (const f of myFriends) {
      const chip = document.createElement('span');
      chip.className = 'fr';
      chip.textContent = f + ' ✕';
      chip.title = 'remove';
      chip.onclick = () => net.send({ t: 'friend', op: 'del', name: f });
      el.appendChild(chip);
    }
    if (!myFriends.length) el.innerHTML = '<span style="color:#5d6b7a;font-size:.82rem">nobody yet — friends can move your props and open your doors</span>';
  }
  net.on('friends', (m) => { myFriends = m.list || []; renderFriends(); });
  $('btn-friend-add').onclick = () => {
    const v = $('friend-name').value.trim();
    if (v) net.send({ t: 'friend', op: 'add', name: v });
    $('friend-name').value = '';
  };
  $('btn-settings').onclick = openSettings;
  $('btn-settings2').onclick = openSettings; // the ⚙️ — same panel, graphics on top
  const refreshCfgUI = () => {
    $('set-wheel-zoom').classList.toggle('sel', cfg.wheel === 'zoom');
    $('set-wheel-hotbar').classList.toggle('sel', cfg.wheel === 'hotbar');
    $('set-sens').value = cfg.sens;
    $('set-fov').value = cfg.fov;
    $('set-inverty').checked = cfg.invertY;
    for (const [id, v] of [['set-sh-off', 'off'], ['set-sh-low', 'low'], ['set-sh-high', 'high']])
      $(id).classList.toggle('sel', cfg.shadowQ === v);
    $('set-rscale').value = cfg.rscale;
    $('set-dd-near').classList.toggle('sel', cfg.drawDist === 'near');
    $('set-dd-far').classList.toggle('sel', cfg.drawDist !== 'near');
    $('set-xlights').checked = cfg.xlights !== false;
    $('set-aa').checked = cfg.aa !== false;
    $('set-fps').checked = !!cfg.fps;
  };
  // ---- graphics application ----
  const baseDpr = Math.min(devicePixelRatio, 1.5);
  function applyGraphics() {
    daylight.setShadowQuality(cfg.shadowQ);
    renderer.setPixelRatio(baseDpr * cfg.rscale);
    renderer.setSize(innerWidth, innerHeight);
    const far = cfg.drawDist === 'near' ? 170 : 300;
    camera.far = far;
    camera.updateProjectionMatrix();
    scene.fog.far = Math.min(260, far - 15);
    scene.fog.near = cfg.drawDist === 'near' ? 60 : 90;
    daylight.setExtraLights(cfg.xlights !== false);
    $('fps-meter').classList.toggle('hidden', !cfg.fps);
  }
  for (const [id, v] of [['set-sh-off', 'off'], ['set-sh-low', 'low'], ['set-sh-high', 'high']])
    $(id).onclick = () => { cfg.shadowQ = v; cfg.shadows = v !== 'off'; saveCfg(); applyGraphics(); refreshCfgUI(); };
  $('set-rscale').oninput = (e) => { cfg.rscale = +e.target.value; saveCfg(); applyGraphics(); };
  $('set-dd-near').onclick = () => { cfg.drawDist = 'near'; saveCfg(); applyGraphics(); refreshCfgUI(); };
  $('set-dd-far').onclick = () => { cfg.drawDist = 'far'; saveCfg(); applyGraphics(); refreshCfgUI(); };
  $('set-xlights').onchange = (e) => { cfg.xlights = e.target.checked; saveCfg(); applyGraphics(); };
  $('set-aa').onchange = (e) => { // MSAA can only change at context creation
    cfg.aa = e.target.checked;
    saveCfg();
    toast('🎨 Antialiasing applies after a quick reload…', 1800);
    setTimeout(() => location.reload(), 900);
  };
  $('set-fps').onchange = (e) => { cfg.fps = e.target.checked; saveCfg(); applyGraphics(); };
  applyGraphics();
  // fps counter (1s window)
  let fpsN = 0, fpsT = performance.now();
  function tickFps() {
    if (!cfg.fps) return;
    fpsN++;
    const now2 = performance.now();
    if (now2 - fpsT > 1000) {
      $('fps-meter').textContent = `${Math.round(fpsN * 1000 / (now2 - fpsT))} fps · ${renderer.info.render.calls} draws`;
      fpsN = 0;
      fpsT = now2;
    }
  }
  $('set-wheel-zoom').onclick = () => { cfg.wheel = 'zoom'; saveCfg(); refreshCfgUI(); };
  $('set-wheel-hotbar').onclick = () => { cfg.wheel = 'hotbar'; saveCfg(); refreshCfgUI(); };
  $('set-sens').oninput = (e) => { cfg.sens = +e.target.value; saveCfg(); };
  $('set-fov').oninput = (e) => { cfg.fov = +e.target.value; camera.fov = cfg.fov; camera.updateProjectionMatrix(); saveCfg(); };
  $('set-inverty').onchange = (e) => { cfg.invertY = e.target.checked; saveCfg(); };
  camera.fov = cfg.fov; camera.updateProjectionMatrix();
  refreshCfgUI();
  $('btn-close-settings').onclick = () => { $('settings').classList.add('hidden'); uiFocus('settings', false); };
  $('btn-logout').onclick = () => { localStorage.clear(); location.reload(); };
  document.querySelectorAll('.vest').forEach(b => b.onclick = () => {
    me.vest = b.dataset.vest;
    myAvatar.setVest(me.vest);
    net.send({ t: 'vest', vest: me.vest });
    document.querySelectorAll('.vest').forEach(x => x.classList.toggle('sel', x === b));
  });
  $('btn-fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  // ---------- interaction ----------
  const promptEl = $('prompt'), promptText = $('prompt-text');
  let nearest = null, nearestSeat = null;

  function scanInteractables() {
    nearest = null; nearestSeat = null;
    let best = 1e9;
    for (const it of W.interactables) {
      const d = Math.hypot(my.x - it.x, my.z - it.z);
      if (d < it.r && d < best) { best = d; nearest = it; }
    }
    let bestS = 1.44;
    if (!my.seat) {
      for (const s of W.seats) {
        const d2 = (my.x - s.x) ** 2 + (my.z - s.z) ** 2;
        if (d2 < bestS) {
          // occupied?
          let occ = false;
          for (const o of others.values()) if (o.avatar.seatId === s.id) { occ = true; break; }
          if (!occ) { bestS = d2; nearestSeat = s; }
        }
      }
    }
    // focus panel for boards
    mg.setFocus(nearest && (nearest.type === 'c4' || nearest.type === 'chess') ? nearest : null);
    // prompt
    let label = null;
    if (my.seat) label = 'Stand up';
    else if (mg.myPongTable) label = 'Swing! (or walk away to quit)';
    else if (nearest && nearest.type !== 'c4' && nearest.type !== 'chess') label = nearest.label;
    else if (nearestSeat) label = nearestSeat.type === 'couch' ? 'Sit on the couch' : 'Take a seat';
    if (label) { promptEl.classList.remove('hidden'); promptText.textContent = label; }
    else promptEl.classList.add('hidden');
  }

  const HELD_BY_KIND = { soda: ['soda', 'a cold soda'], snack: ['chips', 'a bag of chips'], drinks: ['soda', 'a cold drink'], food: ['food', 'a fresh sandwich'], redbull: ['energy', 'an energy drink'] };
  function doAction() {
    if (mg.inArcade()) return;
    if (carState.driving) { exitCar(); return; }
    if (my.seat) { standUp(); return; }
    if (mg.myPongTable) { mg.swing(); return; }
    if (nearest) {
      switch (nearest.type) {
        case 'pong': case 'arcade': case 'c4': case 'chess':
          mg.interact(nearest); return;
        case 'vend': {
          const [item, label] = HELD_BY_KIND[nearest.data?.kind] || ['chips', 'a snack'];
          if (invApi.add(item)) {
            net.send({ t: 'held', item: my.held, announce: label });
            toast(`🛒 ${ITEMS[item].icon} ${label} → inventory`);
            beep(520, .08, 'sine', .1);
          }
          return;
        }
        case 'water':
          if (invApi.add('water')) toast('💧 Ice water → inventory');
          return;
        case 'coffee':
          if (invApi.add('coffee')) { net.send({ t: 'held', item: my.held, announce: 'a fresh coffee' }); toast('☕ Coffee → inventory'); }
          return;
        case 'pickup':
          if (invApi.add(nearest.data.item)) {
            toast(`${ITEMS[nearest.data.item].icon} ${ITEMS[nearest.data.item].name} → inventory`);
            beep(600, .06, 'sine', .1);
            if (nearest.data.item === 'physgun') // the sandbox manual comes with the tool
              addChat('🧲 Hold left-click to grab (props & empty cars) · wheel push/pull · hold E + mouse rotates · right-click freezes in place · X takes your prop back · C crafts', 'sys');
          }
          return;
        case 'dropitem':
          net.send({ t: 'drop', op: 'take', id: nearest.data.drop });
          return;
        case 'fadedoor':
          net.send({ t: 'prop', op: 'fade', id: nearest.data.prop });
          return;
        case 'build': {
          const be = buildMap.get(nearest.data.build);
          if (!be) return;
          if (be.b.kind === 'door') { net.send({ t: 'build', op: 'fade', id: be.b.id }); return; }
          if (be.b.tier !== 'wood') { toast('🧱 Already stone — solid.'); return; }
          if (invApi.count('stone') < 15) { toast('Need 15 🪨 to upgrade this to stone.'); return; }
          invApi.consume('stone', 15);
          net.send({ t: 'build', op: 'upgrade', id: be.b.id });
          return;
        }
        case 'fire': {
          const sel = invApi.selectedItem();
          if (!sel) { toast('🔥 Warm. Select an item (1–6) and press E to burn it.'); return; }
          const burned = invApi.dropSelected();
          if (burned) burnItems(burned);
          return;
        }
        case 'micro':
          toast('🍜 *microwave hums for 90 seconds*', 3200);
          beep(980, .5, 'sine', .06);
          return;
        case 'car': {
          const car = W.cars?.find(c => c.id === nearest.data.car);
          if (car) enterCar(car);
          return;
        }
        case 'gate':
          openGate(nearest.data.gate);
          net.send({ t: 'gate', id: nearest.data.gate });
          toast('🪪 *badge beep* — welcome to PAE2');
          return;
        case 'desk':
          toast('🦺 Security: "Have a great shift! Break room is through the Locker Room hallway."', 3600);
          return;
        case 'smoke':
          toast('🚬 You take a moment in the smoke cage. The parking lot hums.', 3200);
          return;
        case 'home':
          toast('🏠 You made it home! Shift over, feet up. See you at PAE2 tomorrow.', 4600);
          beep(720, .12, 'sine', .1);
          return;
      }
    }
    if (nearestSeat) sitDown(nearestSeat);
  }

  function sitDown(s) {
    my.seat = s;
    my.x = s.x; my.z = s.z; my.y = 0;
    my.ry = s.ry;
    my.anim = 'sit';
    myAvatar.seatId = s.id;
    net.send({ t: 'sit', seat: s.id });
    sendPos(true);
  }
  function standUp() {
    const s = my.seat;
    my.seat = null;
    my.anim = 'idle';
    myAvatar.seatId = null;
    if (s?.exitX !== undefined) { my.x = s.exitX; my.z = s.exitZ; }
    net.send({ t: 'sit', seat: null });
    sendPos(true);
  }

  // click/tap raycast for boards
  const raycaster = new THREE.Raycaster();
  const camRay = new THREE.Raycaster();
  input.onTap = (sx, sy) => {
    if (mg.inArcade() || input.chatOpen) return;
    if (editor?.active) { editor.tap(sx, sy); return; }
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (mg.worldClick(raycaster)) return;
    // clicking with a melee prop (or bare fists) = attack, first OR third person
    if (!my.held || ITEMS[my.held]?.type === 'melee') doSwing();
  };

  // ---------- movement & camera ----------
  const clock = new THREE.Clock();
  let sendTimer = 0, lastSent = '', frameCount = 0;
  function sendPos(force = false) {
    const d = [+my.x.toFixed(2), +my.y.toFixed(2), +my.z.toFixed(2), +my.ry.toFixed(2), my.anim];
    const s = d.join(',');
    if (force || s !== lastSent) { net.send({ t: 'p', d }); lastSent = s; }
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);

    // physgun rotate mode: hold E while carrying — the mouse turns the OBJECT
    if (pgState.held && input.keys.KeyE && !pgState.held.isCar) {
      const rdx = input.lookDX * .005, rdy = input.lookDY * .005;
      input.lookDX = 0; input.lookDY = 0; // eaten: camera stays put
      if (rdx) phys.yawBody(pgState.held, -rdx, pgState.anchor);
      if (rdy) phys.rotateBody(pgState.held, Math.cos(my.yaw), 0, -Math.sin(my.yaw), -rdy, pgState.anchor);
    }
    // look (sensitivity + optional inverted Y; FP allows full look up/down)
    my.lookVX = input.lookDX;
    my.yaw -= input.lookDX * .0028 * cfg.sens;
    const dy = input.lookDY * .0028 * cfg.sens * (cfg.invertY ? -1 : 1);
    my.pitch = Math.max(fp ? -1.35 : -.2, Math.min(fp ? 1.35 : 1.2, my.pitch + dy));
    input.lookDX = 0; input.lookDY = 0;

    // move — hybrid devices (touchscreen laptops, Steam Deck) get BOTH inputs:
    // keyboard wins whenever a key is held, joystick otherwise
    const km = keyMove();
    const kv = (km.x || km.y) ? km : input.move;
    const running = input.keys.ShiftLeft || input.keys.ShiftRight || (kv === input.move && Math.hypot(kv.x, kv.y) > .92);
    const mvLen = Math.hypot(kv.x, kv.y);

    if (input.actionQueued) {
      input.actionQueued = false;
      if (!pgState.held) doAction(); // E while carrying = rotate mode, not interact
    }
    if (input.jumpQueued) {
      input.jumpQueued = false;
      if (carState.driving) { /* Space is the handbrake while driving */ }
      else if (mg.myPongTable && !my.seat) mg.swing();
      else if (my.onGround && !my.seat) { my.vy = my.crouch ? 4.2 : 5.4; my.onGround = false; my.crouch = false; beep(520, .04, 'sine', .05); }
      else if (my.seat) standUp();
    }

    if (carState.driving) {
      // ---- rigid-body driving: forces on the chassis, physics handles the rest ----
      const car = carState.driving;
      const e = phys.cars.get(car.id);
      phys.drive(e, -kv.y, -kv.x, !!input.keys.Space, dt);
      // ride the chassis (car.x/z/ry are synced from the body in phys.step)
      my.x = car.x; my.z = car.z;
      my.y = Math.max(0, e.body.position.y - .15);
      my.ry = car.ry;
      my.anim = 'sit';
      carSendT += dt;
      if (carSendT > .1) {
        carSendT = 0;
        const b = e.body;
        net.send({
          t: 'car', id: car.id, op: 'state',
          p: [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)],
          q: [+b.quaternion.x.toFixed(3), +b.quaternion.y.toFixed(3), +b.quaternion.z.toFixed(3), +b.quaternion.w.toFixed(3)],
          v: [+b.velocity.x.toFixed(2), +b.velocity.y.toFixed(2), +b.velocity.z.toFixed(2)],
        });
      }
    } else if (my.seat) {
      if (mvLen > .4) standUp();
      my.anim = 'sit';
    } else {
      // ---- source-style movement: friction, accelerate, air control ----
      my.crouch = (input.keys.ControlLeft || input.keys.ControlRight || input.crouchTouch) && my.onGround ? true : (my.crouch && !my.onGround);
      const target = my.crouch ? 2.1 : running ? 7.0 : 4.3;
      let wx = 0, wz = 0;
      if (mvLen > .01) {
        const a = Math.atan2(-kv.x, -kv.y) + my.yaw;
        wx = -Math.sin(a); wz = -Math.cos(a);
      }
      const sp = Math.hypot(my.vel.x, my.vel.z);
      if (my.onGround) { // sv_friction ≈ 7
        if (sp > .001) {
          const drop = Math.max(sp, 1.0) * 7.0 * dt;
          const scale = Math.max(sp - drop, 0) / sp;
          my.vel.x *= scale; my.vel.z *= scale;
        } else { my.vel.x = 0; my.vel.z = 0; }
      }
      if (wx || wz) { // quake accelerate: project current onto wishdir
        const cur = my.vel.x * wx + my.vel.z * wz;
        // ground: normal accel · air: classic 30ups cap with high airaccelerate —
        // this is what makes A/D air-strafing and bhop speed gain work
        const cap = my.onGround ? target : .85;
        const accel = my.onGround ? 14 : 90;
        const add = Math.min(Math.max(cap - cur, 0), accel * target * dt);
        my.vel.x += wx * add; my.vel.z += wz * add;
      }
      let nx = my.x + my.vel.x * dt, nz = my.z + my.vel.z * dt;
      [nx, nz] = resolveCollisions(nx, nz, .34);
      if (dt > 0) { my.vel.x = (nx - my.x) / dt; my.vel.z = (nz - my.z) / dt; } // wall clip
      my.x = nx; my.z = nz;
      const hsp = Math.hypot(my.vel.x, my.vel.z);
      // face movement direction (or view direction in first person)
      const targetRy = fp ? my.yaw + Math.PI
        : hsp > .6 ? Math.atan2(-my.vel.x, -my.vel.z) + Math.PI : my.ry;
      let dr = targetRy - my.ry;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      my.ry += dr * Math.min(1, dt * (fp ? 20 : 14));
      my.anim = !my.onGround ? (hsp > 5 ? 'run' : 'walk')
        : my.crouch ? (hsp > .5 ? 'crouchwalk' : 'crouch')
        : hsp > 5.2 ? 'run' : hsp > .5 ? 'walk' : 'idle';
      // gravity
      my.vy -= 16 * dt;
      my.y += my.vy * dt;
      if (my.y <= 0) {
        if (!my.onGround && my.vy < -5) beep(140, .05, 'sine', .05); // landing thud
        my.y = 0; my.vy = 0; my.onGround = true;
      }
      // walked away from pong table?
      if (mg.myPongTable) {
        // anchors from the rotated cafeteria group carry world coords in wx/wz
        const a = W.anchors[`pong-${mg.myPongTable}`];
        if (a && Math.hypot(my.x - (a.wx ?? a.x), my.z - (a.wz ?? a.z)) > 4.5) net.send({ t: 'pong', id: mg.myPongTable, op: 'leave' });
      }
    }

    // ---- sandbox physics: step BEFORE the camera/avatar read positions, so
    // the car you're riding and the mesh you see are the same frame (chop fix)
    if (pgState.held) {
      const held = pgState.held;
      if (!pgEquipped() || !(held.isCar ? phys.cars : phys.props).has(held.id)) physgunRelease(false);
      else { // drag the grabbed body toward the point pgState.dist along the view ray
        const b = held.body;
        b.wakeUp();
        const dir2 = camera.getWorldDirection(beamV);
        const tx3 = camera.position.x + dir2.x * pgState.dist;
        const ty3 = Math.max(.3, camera.position.y + dir2.y * pgState.dist);
        const tz3 = camera.position.z + dir2.z * pgState.dist;
        const aw = phys.anchorWorld(held, pgState.anchor, pgState.anchorOut);
        let vx3 = (tx3 - aw.x) * 10, vy3 = (ty3 - aw.y) * 10, vz3 = (tz3 - aw.z) * 10;
        const vl = Math.hypot(vx3, vy3, vz3);
        if (vl > 22) { vx3 *= 22 / vl; vy3 *= 22 / vl; vz3 *= 22 / vl; }
        b.velocity.set(vx3, vy3, vz3);
        // gmod grip: the object turns with your view and otherwise holds its pose
        const dyaw = my.yaw - (pgState.lastYaw ?? my.yaw);
        pgState.lastYaw = my.yaw;
        b.angularVelocity.set(0, 0, 0);
        if (!input.keys.KeyE && Math.abs(dyaw) > 1e-4) phys.yawBody(held, dyaw, pgState.anchor); // view-follow (E = manual rotate instead)
      }
    }
    phys.step(dt, my);
    if (carState.driving) { // re-sync the seat to the freshly stepped chassis
      const car = carState.driving;
      const ce2 = phys.cars.get(car.id);
      my.x = car.x; my.z = car.z;
      my.y = Math.max(0, ce2.body.position.y - .15);
      my.ry = car.ry;
    }

    // avatar
    myAvatar.group.position.set(my.x, my.y + (myAvatar.bobY || 0), my.z);
    myAvatar.group.rotation.y = my.ry;
    myAvatar.anim = my.anim;
    myAvatar.airborne = !my.onGround && !my.seat;
    myAvatar.animate(dt);

    // others interpolate (full limb animation only within 55m — LOD)
    for (const o of others.values()) {
      const g = o.avatar.group, t = o.target;
      g.position.x += (t.x - g.position.x) * Math.min(1, dt * 10);
      g.position.z += (t.z - g.position.z) * Math.min(1, dt * 10);
      g.position.y = t.y + (o.avatar.bobY || 0);
      let dr = t.ry - g.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      g.rotation.y += dr * Math.min(1, dt * 10);
      const ddx = g.position.x - my.x, ddz = g.position.z - my.z;
      if (ddx * ddx + ddz * ddz < 3025) o.avatar.animate(dt);
    }

    if (carState.driving && !fp) my.dist = Math.max(my.dist, 6.5);
    if (fp) {
      // first person: eye-height camera, look along yaw/pitch
      const eyeY = my.y + (my.crouch ? 1.08 : 1.62);
      camera.position.set(my.x, eyeY, my.z);
      const fwd = new THREE.Vector3(
        -Math.sin(my.yaw) * Math.cos(my.pitch),
        -Math.sin(my.pitch),
        -Math.cos(my.yaw) * Math.cos(my.pitch),
      );
      camera.lookAt(camera.position.clone().add(fwd));
      // viewmodel: walk bob + look sway + equip pop + two-phase swing
      const hsp2 = Math.hypot(my.vel.x, my.vel.z);
      const bobT = performance.now() / 1000 * (hsp2 > 5 ? 11 : 8);
      const bobA = my.onGround ? Math.min(hsp2 / 7, 1) * .022 : 0;
      vmEquip = Math.max(0, vmEquip - dt * 5);
      my.vmSway = (my.vmSway || 0) + ((my.lookVX || 0) - (my.vmSway || 0)) * Math.min(1, dt * 12);
      const swayX = -(my.vmSway || 0) * .0011;
      const landDip = !my.onGround ? .015 : 0;
      viewmodel.position.set(
        .34 + Math.cos(bobT) * bobA + swayX,
        -.34 + Math.abs(Math.sin(bobT)) * bobA - vmEquip * .28 - landDip,
        -.6);
      if (vmSwing > 0) {
        const A = VM_ANIM[my.held] || VM_ANIM.default;
        vmSwing = Math.max(0, vmSwing - dt * A.speed);
        const t3 = 1 - vmSwing;
        const wind = Math.sin(Math.min(t3 / .3, 1) * Math.PI / 2);
        const smash = t3 < .3 ? 0 : Math.sin((t3 - .3) / .7 * Math.PI);
        const [rx, ry3, rz] = A.rot(wind, smash);
        viewmodel.rotation.set(-.2 + rx, -.35 + ry3, .15 + rz);
        const [px3, py3, pz3] = A.pos(wind, smash);
        viewmodel.position.x += px3; viewmodel.position.y += py3; viewmodel.position.z += pz3;
      } else viewmodel.rotation.set(-.2 + swayX * 2, -.35, .15);
    } else {
      // camera orbit with occlusion (pull in when a wall/furniture blocks the view)
      const head = new THREE.Vector3(my.x, my.y + 1.7, my.z);
      const dir = new THREE.Vector3(
        Math.sin(my.yaw) * Math.cos(my.pitch),
        Math.sin(my.pitch),
        Math.cos(my.yaw) * Math.cos(my.pitch),
      );
      let cd = my.dist;
      camRay.set(head, dir);
      camRay.far = cd + .3;
      const blocks = camRay.intersectObjects(W.camBlockers, false);
      if (blocks.length && blocks[0].distance < cd) cd = Math.max(1.2, blocks[0].distance - .25);
      const camPos = head.clone().addScaledVector(dir, cd);
      if (camPos.y < .35) camPos.y = .35;
      camera.position.copy(camPos);
      camera.lookAt(my.x, my.y + 1.45, my.z);
    }

    // badge-gate paddle animation
    if (W.gates) for (const g of W.gates) {
      const target = g.open ? 1.15 : 0;
      g.pl.rotation.y += (-target - g.pl.rotation.y) * Math.min(1, dt * 8);
      g.pr.rotation.y += (target - g.pr.rotation.y) * Math.min(1, dt * 8);
    }

    updateBeams();

    // sleepers dream
    for (const s of sleeperMap.values()) {
      s.t += dt;
      s.zz.position.y = .7 + Math.sin(s.t * 1.6) * .07;
      s.zz.material.opacity = .65 + Math.sin(s.t * 1.6) * .3;
    }
    // NPCs walk toward their server targets with a simple gait
    for (const n of npcMap.values()) {
      n.t += dt;
      const g = n.group;
      const mvx = n.tx - g.position.x, mvz = n.tz - g.position.z;
      const moving = Math.hypot(mvx, mvz) > .05;
      g.position.x += mvx * Math.min(1, dt * 6);
      g.position.z += mvz * Math.min(1, dt * 6);
      let drN = n.try - g.rotation.y;
      while (drN > Math.PI) drN -= Math.PI * 2;
      while (drN < -Math.PI) drN += Math.PI * 2;
      g.rotation.y += drN * Math.min(1, dt * 8);
      const sw = moving ? Math.sin(n.t * (n.kind === 'chicken' ? 16 : 8)) * .5 : 0;
      n.legs.forEach((leg, li) => { leg.rotation.x = sw * (li % 2 ? -1 : 1); });
      if (n.kind === 'chicken' && n.head) n.head.position.z = .16 + (moving ? Math.sin(n.t * 16) * .05 : 0);
      if (n.kind === 'zombie') {
        n.arms.forEach((a, ai) => { a.rotation.x = Math.sin(n.t * 3 + ai) * .12; });
        g.rotation.z = Math.sin(n.t * 2.2) * .04; // shamble
      }
    }

    // dropped items spin and bob, minecraft style
    for (const e of worldDrops.values()) {
      e.t += dt;
      e.mesh.rotation.y += dt * 1.6;
      e.mesh.position.y = e.baseY + Math.sin(e.t * 2.2) * .06;
    }

    // plow through knockables while driving fast enough
    if (carState.driving) {
      const ce = phys.cars.get(carState.driving.id);
      const cv = ce.body.velocity;
      const spd = Math.hypot(cv.x, cv.z);
      if (spd > 3.5) {
        for (const k of W.knockables) {
          if (k.down) continue;
          const dx = k.x - my.x, dz = k.z - my.z;
          if (dx * dx + dz * dz < (k.r + 1.9) ** 2) knockIt(k, cv.x / spd, cv.z / spd, true);
        }
      }
    }
    for (const k of W.knockables) {
      if (!k.down) continue;
      k.t += dt;
      const o = k.obj;
      if (k.t < 1.1) {
        if (k.kind === 'rock') { // rocks crumble instead of toppling
          const p = Math.min(1, k.t / .6);
          o.scale.setScalar(Math.max(.1, 1 - p * .9));
          o.position.y = o.userData.homePos.y - p * .3;
        } else { // topple with a wobble at the end
          const p = Math.min(1, k.t / 1.1);
          const fall = 1 - (1 - p) ** 2;
          const wob = p > .75 ? Math.sin((p - .75) * 26) * .18 * (1 - p) : 0;
          knockAxis.set(k.dz, 0, -k.dx).normalize();
          o.quaternion.setFromAxisAngle(knockAxis, (Math.PI / 2 - .1) * fall + wob);
          o.position.set(
            o.userData.homePos.x + k.dx * fall * .6,
            o.userData.homePos.y,
            o.userData.homePos.z + k.dz * fall * .6,
          );
        }
      } else if (k.t > k.respawn) { // grow back
        const gr = (k.t - k.respawn) / .5;
        o.quaternion.copy(o.userData.homeQuat);
        o.position.copy(o.userData.homePos);
        if (gr >= 1) {
          k.down = false;
          k.hp = k.maxHp; // fresh tree, fresh rock
          o.scale.setScalar(1);
          if (k.col) k.col.off = false;
        } else o.scale.setScalar(Math.max(.05, gr));
      }
    }

    // pistol tracers fade fast
    for (let ti = tracers.length - 1; ti >= 0; ti--) {
      const tr = tracers[ti];
      tr.ttl -= dt;
      tr.line.material.opacity = Math.max(0, tr.ttl / .12) * .9;
      if (tr.ttl <= 0) { scene.remove(tr.line); tracers.splice(ti, 1); }
    }
    // build-placement ghost follows your aim while a piece is equipped
    const bkind = ITEMS[my.held]?.type === 'build' && !carState.driving ? my.held : null;
    for (const k2 of ['wall', 'floor', 'door']) ghosts[k2].visible = bkind === k2;
    if (bkind) {
      const gp = ghostPose();
      ghosts[bkind].position.set(gp.x, bkind === 'wall' ? 1.5 : bkind === 'door' ? 1.35 : .08, gp.z);
      ghosts[bkind].rotation.y = gp.ry;
    }

    // headlights: a fixed POOL of 3 spotlights shared by driven cars — the
    // light count never changes, so shaders never recompile mid-game (the
    // old per-car lazy lights caused a full recompile hitch on every enter)
    {
      let hi = 0;
      for (const e2 of phys.cars.values()) {
        if (e2.car.driver == null || hi >= hlPool.length) continue;
        const hl2 = hlPool[hi++];
        if (hl2.parent !== e2.car.group) {
          e2.car.group.add(hl2, hl2.target);
          hl2.position.set(0, .85, 2.0);
          hl2.target.position.set(0, .25, 15);
        }
        hl2.intensity = .25 + (1 - (W.dayFactor ?? 1)) * 3.4;
      }
      for (; hi < hlPool.length; hi++) hlPool[hi].intensity = 0;
    }
    // flashlight follows your view
    torch.intensity = my.held === 'flashlight' ? .5 + (1 - (W.dayFactor ?? 1)) * 3.6 : 0;

    daylight.update(dt, my.x, my.z);
    W.dynamic.fires?.forEach(f => f.update(dt));

    // interactable scan every 3rd frame — a prompt appearing 30ms late is
    // invisible; scanning a few hundred entries per frame is not
    if ((frameCount = (frameCount + 1) % 3) === 0) scanInteractables();
    mg.update(dt);

    // network send 10Hz
    sendTimer += dt;
    if (sendTimer > .1) { sendTimer = 0; sendPos(); }

    renderer.render(scene, camera);
    tickFps();
  }
  frame();

  // debug/testing handle
  window.__brs = {
    my, mg, scene, W, phys, input, renderer, daylight, teleport: (x, z, yaw) => { my.x = x; my.z = z; if (yaw !== undefined) my.yaw = yaw; sendPos(true); },
    action: doAction, nearest: () => nearest?.id || nearestSeat?.id || null,
    spawnProp, physgunGrab, physgunRelease, pgState, pgPick, sleepers: sleeperMap, inv: invApi,
    drops: worldDrops, dropItem: dropItemInWorld, knockIt,
  };

  addEventListener('wheel', (e) => {
    if (input.uiOpen) return; // scrolling a panel shouldn't zoom/cycle
    if (pgState.held) { // physgun: wheel pushes/pulls the grabbed prop
      pgState.dist = Math.max(1.6, Math.min(12, pgState.dist - e.deltaY * .004));
      return;
    }
    if (fp) {
      if (cfg.wheel === 'hotbar') { // cycle hotbar
        const s = invApi.state;
        const dir = e.deltaY > 0 ? 1 : -1;
        const i = s.sel === -1 ? (dir > 0 ? 0 : 5) : (s.sel + dir + 6) % 6;
        invApi.select(i);
      } else if (e.deltaY > 0) { // zoom mode: scrolling out leaves first person
        setFP(false);
        my.dist = 2.6;
      }
      return;
    }
    const nd = my.dist + e.deltaY * .0035;
    if (nd < 1.8) { setFP(true); my.dist = 2.4; return; }
    my.dist = Math.max(2.2, Math.min(9, nd));
  }, { passive: true });

  // ---------- ambient updates ----------
  // walking away abandons a board seat
  setInterval(() => {
    // rotated-cafeteria anchors keep group-local x/z — world coords live in
    // wx/wz (comparing against local coords ejected players instantly)
    for (const id of ['a', 'b']) {
      const s = mg.c4[id], a = W.anchors[`c4-${id}`];
      if (s && a && s.seats.includes(me.name) && Math.hypot(my.x - (a.wx ?? a.x), my.z - (a.wz ?? a.z)) > 4.5)
        net.send({ t: 'c4', id, op: 'leave' });
    }
    const cs = mg.chess, ca = W.anchors.chess;
    if (cs && ca && cs.seats.includes(me.name) && Math.hypot(my.x - (ca.wx ?? ca.x), my.z - (ca.wz ?? ca.z)) > 4.5)
      net.send({ t: 'chess', op: 'leave' });
  }, 1500);

  let breakSecs = 15 * 60;
  setInterval(() => {
    breakSecs--;
    if (breakSecs <= 0) {
      breakSecs = 15 * 60;
      toast("⏰ Break's over — back to the floor! …or start another 15 😏", 4200);
    }
    $('break-timer').textContent = `${Math.floor(breakSecs / 60)}:${String(breakSecs % 60).padStart(2, '0')}`;
  }, 1000);
  setInterval(() => {
    const pa = mg.pong.a, pb = mg.pong.b;
    const line = (s, n) => !s ? `Table ${n} open` :
      (s.seats[0] || s.seats[1])
        ? `${n}: ${s.seats[0] || '—'} ${s.score[0]}-${s.score[1]} ${s.seats[1] || '—'}`
        : `Table ${n} open`;
    const info = { online: others.size + 1, pongLine1: line(pa, 'A'), pongLine2: line(pb, 'B') };
    W.dynamic.tvs?.forEach(tv => tv.draw(info));
  }, 6000);
  setInterval(() => W.dynamic.clocks?.forEach(c => c.draw()), 10000);
}
