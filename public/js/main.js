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
import { ct } from './textures.js';

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
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
    { wheel: 'zoom', sens: 1.0, fov: 70, invertY: false, shadows: true },
    JSON.parse(localStorage.getItem('brs-cfg') || '{}'));
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
      if (item === 'physgun') toast('🧲 Hold left-click on a prop or empty car to grab · wheel push/pull · R spin · X delete · Q spawns props', 4600);
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
    if (!my.held || ITEMS[my.held]?.type !== 'melee') return;
    myAvatar.swing();
    vmSwing = 1;
    net.send({ t: 'swing' });
    beep(240, .09, 'sawtooth', .07);
    // send nearby physics props flying
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    if (phys.smack(my.x, my.y, my.z, fx, fz)) beep(160, .08, 'square', .09);
  }
  net.on('swing', (m) => {
    if (m.id === myId) return;
    const o = others.get(m.id);
    if (o) { o.avatar.swing(); beep(240, .07, 'sawtooth', .04); }
  });
  function useKey() {
    const r = invApi.useSelected();
    if (!r) return;
    if (r.melee === 'physgun') { toast('🧲 Hold left-click to grab · wheel push/pull · R spin · X delete · Q spawns props'); return; }
    if (r.melee === 'flashlight') { toast('🔦 Lights wherever you look — best after dark.'); return; }
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
    else if (e.code === 'KeyQ') toggleSpawn();
    else if (e.code === 'KeyG') { e.preventDefault(); openTag(); }
    else if (e.code === 'KeyH') { const dropId = invApi.dropSelected(); if (dropId) { dropItemInWorld(dropId); beep(340, .05, 'sine', .07); } }
    else if (e.code === 'KeyX' && pgState.held && !pgState.held.isCar) net.send({ t: 'prop', op: 'del', id: pgState.held.id });
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
      // Escape closes the top UI panel (spawn/inventory/settings) like any game menu
      if (spawnOpen) toggleSpawn(false);
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
    // retro associate counter by the front walkway — proof the place remembers
    if (m.visitorNum) {
      const pad6 = (v) => String(Math.min(v, 999999)).padStart(6, '0');
      const signTex = ct(512, 224, (g, w, h) => {
        g.fillStyle = '#101418'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#2c343e'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
        g.textAlign = 'center';
        g.fillStyle = '#8fa0b3'; g.font = '700 26px "Segoe UI", sans-serif';
        g.fillText(`YOU ARE ASSOCIATE Nº ${m.visitorNum}`, w / 2, 44);
        g.fillStyle = '#5d6b7a'; g.font = '700 22px "Segoe UI", sans-serif';
        g.fillText('TOTAL BADGE-INS, ALL TIME', w / 2, 84);
        g.fillStyle = '#ffb52e'; g.font = '700 76px "Consolas", monospace';
        g.shadowColor = '#ffb52e'; g.shadowBlur = 18;
        g.fillText(pad6(m.stats?.joins ?? m.visitorNum), w / 2, 154);
        g.shadowBlur = 0;
        g.fillStyle = '#5d6b7a'; g.font = '22px "Consolas", monospace';
        g.fillText(`naps: ${m.stats?.naps ?? 0} · marks: ${m.stats?.marks ?? 0} · the lights stay on`, w / 2, 196);
      });
      const sg = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.0, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: .6 }));
      post.position.y = 1.0;
      sg.add(post);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.0), new THREE.MeshBasicMaterial({ map: signTex }));
      panel.position.y = 2.1;
      sg.add(panel);
      sg.position.set(103, 0, 6.4);
      sg.rotation.y = Math.PI;
      scene.add(sg);
      W.colliders.push({ x0: 102.7, x1: 103.3, z0: 6.1, z1: 6.7 });
      addChat(`📟 You are associate №${m.visitorNum}. The break room remembers everyone.`, 'sys');
      addChat('🖊️ G leaves a permanent mark · Q spawns props · H (or right-click a slot) drops items · the 🧲 is out on 172nd St.', 'sys');
    }
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
    sleeperMap.set(s.key, { root, zz, t: Math.random() * 6 });
  }
  function removeSleeper(key) {
    const e = sleeperMap.get(key);
    if (!e) return;
    scene.remove(e.root);
    sleeperMap.delete(key);
  }
  net.on('sleep', (m) => addSleeper(m.s));
  net.on('wake', (m) => removeSleeper(m.key));

  // ---------- dropped items on the floor (minecraft style) ----------
  const worldDrops = new Map(); // id -> {group, mesh, inter, t}
  function nearFire() {
    const f = W.anchors.fire;
    return f && Math.hypot(my.x - f.x, my.z - f.z) < 2.2;
  }
  function burnItems(id, n = 1) {
    toast(`🔥 ${ITEMS[id].icon} ${ITEMS[id].name}${n > 1 ? ' ×' + n : ''} went up in flames`, 3200);
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

  // ---------- sandbox: spawn menu (Q) ----------
  const spawnEl = $('spawn-menu'), spawnGrid = $('spawn-grid');
  for (const [kind, def] of Object.entries(PHYS_KINDS)) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ico">${def.icon}</span>${def.label}`;
    b.onclick = () => { spawnProp(kind); toggleSpawn(false); };
    spawnGrid.appendChild(b);
  }
  let spawnOpen = false;
  function toggleSpawn(open) {
    spawnOpen = open ?? !spawnOpen;
    spawnEl.classList.toggle('hidden', !spawnOpen);
    uiFocus('spawn', spawnOpen);
  }
  function spawnProp(kind) {
    const fx = -Math.sin(my.yaw), fz = -Math.cos(my.yaw);
    net.send({ t: 'prop', op: 'spawn', kind, p: [+(my.x + fx * 2.2).toFixed(2), 1.3, +(my.z + fz * 2.2).toFixed(2)] });
    toast(`${PHYS_KINDS[kind].icon} ${PHYS_KINDS[kind].label} incoming!`);
  }

  // ---------- physgun: hold LMB to grab · wheel push/pull · R spin · X delete ----------
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
  function physgunGrab() {
    if (!pgEquipped() || pgState.held) return;
    const hit = pgPick();
    if (!hit) return;
    pgState.held = hit.e;
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
    }
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    pgState.lmb = false;
    if (pgState.held) physgunRelease();
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
  const beams = new Map(); // key ('me' | propId) -> {line, dot}
  const beamV = new THREE.Vector3();
  function beamFor(key) {
    let b = beams.get(key);
    if (!b) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthTest: false }));
      line.renderOrder = 7;
      line.frustumCulled = false;
      const dot = glowDot();
      scene.add(line, dot);
      b = { line, dot };
      beams.set(key, b);
    }
    return b;
  }
  function setBeam(key, from, to) {
    const b = beamFor(key);
    const pos = b.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    b.dot.position.copy(to);
  }
  function myBeamFrom() {
    if (fp) {
      const dir = camera.getWorldDirection(beamV.set(0, 0, 0));
      const from = camera.position.clone().addScaledVector(dir, .5);
      from.y -= .18;
      return from;
    }
    return myAvatar.heldAnchor.getWorldPosition(new THREE.Vector3());
  }
  function updateBeams() {
    const live = new Set();
    if (pgState.held) {
      live.add('me');
      setBeam('me', myBeamFrom(), pgState.held.body.position);
      beamFor('me').line.material.opacity = .8;
    } else if (pgState.lmb && pgEquipped()) {
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
      setBeam('me', myBeamFrom(), end);
      beamFor('me').line.material.opacity = .3;
    }
    for (const e of [...phys.props.values(), ...phys.cars.values()]) {
      if (e.grabbedBy && e.grabbedBy !== myId) {
        const o = others.get(e.grabbedBy);
        if (!o) continue;
        live.add(e.id);
        setBeam(e.id, o.avatar.heldAnchor.getWorldPosition(beamV), e.body.position);
        beamFor(e.id).line.material.opacity = .8;
      }
    }
    for (const [key, b] of beams) {
      if (!live.has(key)) { scene.remove(b.line, b.dot); beams.delete(key); }
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
      phys.remove(m.id);
    } else if (m.op === 'grab') {
      const e = phys.props.get(m.id);
      if (e) { e.grabbedBy = m.by; e.owned = false; }
    } else if (m.op === 'drop') {
      const e = phys.props.get(m.id);
      if (e) e.grabbedBy = null;
    }
  });

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
  $('btn-settings').onclick = () => {
    $('settings').classList.remove('hidden');
    uiFocus('settings', true);
    buildApRows();
    document.querySelectorAll('.vest').forEach(b => b.classList.toggle('sel', b.dataset.vest === me.vest));
    const s = me.stats;
    $('stats-box').innerHTML = me.guest
      ? 'Guest session — create an account to save stats.'
      : `🏓 Pong wins: <b>${s.pongWins || 0}</b> · 🔴 Connect 4 wins: <b>${s.c4Wins || 0}</b> · ♟️ Chess wins: <b>${s.chessWins || 0}</b>`;
  };
  const refreshCfgUI = () => {
    $('set-wheel-zoom').classList.toggle('sel', cfg.wheel === 'zoom');
    $('set-wheel-hotbar').classList.toggle('sel', cfg.wheel === 'hotbar');
    $('set-sens').value = cfg.sens;
    $('set-fov').value = cfg.fov;
    $('set-inverty').checked = cfg.invertY;
    $('set-shadows').checked = cfg.shadows !== false;
  };
  $('set-wheel-zoom').onclick = () => { cfg.wheel = 'zoom'; saveCfg(); refreshCfgUI(); };
  $('set-wheel-hotbar').onclick = () => { cfg.wheel = 'hotbar'; saveCfg(); refreshCfgUI(); };
  $('set-sens').oninput = (e) => { cfg.sens = +e.target.value; saveCfg(); };
  $('set-fov').oninput = (e) => { cfg.fov = +e.target.value; camera.fov = cfg.fov; camera.updateProjectionMatrix(); saveCfg(); };
  $('set-inverty').onchange = (e) => { cfg.invertY = e.target.checked; saveCfg(); };
  $('set-shadows').onchange = (e) => { cfg.shadows = e.target.checked; daylight.setShadows(cfg.shadows); saveCfg(); };
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
          }
          return;
        case 'dropitem':
          net.send({ t: 'drop', op: 'take', id: nearest.data.drop });
          return;
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
    // clicking with a melee prop equipped = attack (first OR third person)
    if (my.held && ITEMS[my.held]?.type === 'melee') doSwing();
  };

  // ---------- movement & camera ----------
  const clock = new THREE.Clock();
  let sendTimer = 0, lastSent = '';
  function sendPos(force = false) {
    const d = [+my.x.toFixed(2), +my.y.toFixed(2), +my.z.toFixed(2), +my.ry.toFixed(2), my.anim];
    const s = d.join(',');
    if (force || s !== lastSent) { net.send({ t: 'p', d }); lastSent = s; }
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);

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

    if (input.actionQueued) { input.actionQueued = false; doAction(); }
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

    // avatar
    myAvatar.group.position.set(my.x, my.y + (myAvatar.bobY || 0), my.z);
    myAvatar.group.rotation.y = my.ry;
    myAvatar.anim = my.anim;
    myAvatar.airborne = !my.onGround && !my.seat;
    myAvatar.animate(dt);

    // others interpolate
    for (const o of others.values()) {
      const g = o.avatar.group, t = o.target;
      g.position.x += (t.x - g.position.x) * Math.min(1, dt * 10);
      g.position.z += (t.z - g.position.z) * Math.min(1, dt * 10);
      g.position.y = t.y + (o.avatar.bobY || 0);
      let dr = t.ry - g.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      g.rotation.y += dr * Math.min(1, dt * 10);
      o.avatar.animate(dt);
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

    // ---- sandbox physics ----
    if (pgState.held) {
      const held = pgState.held;
      if (!pgEquipped() || !(held.isCar ? phys.cars : phys.props).has(held.id)) physgunRelease(false);
      else { // drag the grabbed prop toward the point pgState.dist along the view ray
        const b = held.body;
        b.wakeUp();
        const dir2 = camera.getWorldDirection(beamV);
        const tx3 = camera.position.x + dir2.x * pgState.dist;
        const ty3 = Math.max(.3, camera.position.y + dir2.y * pgState.dist);
        const tz3 = camera.position.z + dir2.z * pgState.dist;
        let vx3 = (tx3 - b.position.x) * 10, vy3 = (ty3 - b.position.y) * 10, vz3 = (tz3 - b.position.z) * 10;
        const vl = Math.hypot(vx3, vy3, vz3);
        if (vl > 22) { vx3 *= 22 / vl; vy3 *= 22 / vl; vz3 *= 22 / vl; }
        b.velocity.set(vx3, vy3, vz3);
        if (input.keys.KeyR) b.angularVelocity.set(0, 2.8, 0);
      }
    }
    phys.step(dt, my);
    updateBeams();

    // sleepers dream
    for (const s of sleeperMap.values()) {
      s.t += dt;
      s.zz.position.y = .7 + Math.sin(s.t * 1.6) * .07;
      s.zz.material.opacity = .65 + Math.sin(s.t * 1.6) * .3;
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
      if (k.t < 1.1) { // topple with a wobble at the end
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
      } else if (k.t > k.respawn) { // grow back
        const gr = (k.t - k.respawn) / .5;
        o.quaternion.copy(o.userData.homeQuat);
        o.position.copy(o.userData.homePos);
        if (gr >= 1) {
          k.down = false;
          o.scale.setScalar(1);
          if (k.col) k.col.off = false;
        } else o.scale.setScalar(Math.max(.05, gr));
      }
    }

    // headlights on driven cars, brighter after dark
    for (const e2 of phys.cars.values()) {
      const car = e2.car;
      if (car.driver != null) {
        if (!e2.hlLight) {
          const sp = new THREE.SpotLight(0xfff2cf, 0, 36, .52, .5, 1.1);
          sp.position.set(0, .85, 2.0);
          const tgt = new THREE.Object3D();
          tgt.position.set(0, .25, 15);
          car.group.add(sp, tgt);
          sp.target = tgt;
          e2.hlLight = sp;
        }
        e2.hlLight.intensity = .25 + (1 - (W.dayFactor ?? 1)) * 3.4;
      } else if (e2.hlLight) e2.hlLight.intensity = 0;
    }
    // flashlight follows your view
    torch.intensity = my.held === 'flashlight' ? .5 + (1 - (W.dayFactor ?? 1)) * 3.6 : 0;

    daylight.update(dt, my.x, my.z);
    W.dynamic.fires?.forEach(f => f.update(dt));

    scanInteractables();
    mg.update(dt);

    // network send 10Hz
    sendTimer += dt;
    if (sendTimer > .1) { sendTimer = 0; sendPos(); }

    renderer.render(scene, camera);
  }
  frame();

  // debug/testing handle
  window.__brs = {
    my, mg, scene, W, phys, input, renderer, daylight, teleport: (x, z, yaw) => { my.x = x; my.z = z; if (yaw !== undefined) my.yaw = yaw; sendPos(true); },
    action: doAction, nearest: () => nearest?.id || nearestSeat?.id || null,
    spawnProp, toggleSpawn, physgunGrab, physgunRelease, pgState, sleepers: sleeperMap, inv: invApi,
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
