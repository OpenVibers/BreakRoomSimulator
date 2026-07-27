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
const saved = localStorage.getItem('brs-token');
const savedUser = localStorage.getItem('brs-user');
if (saved && savedUser) {
  try { start(saved, JSON.parse(savedUser)); } catch { localStorage.clear(); }
} else if (location.search.includes('autoguest')) {
  api('guest').then(r => { if (!r.error) start(r.token, r.user); });
}

// ============================== GAME ==============================
let started = false;
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
  let editor = null;

  // ---------- drivable cars (arcade vehicle physics) ----------
  const carState = { driving: null, speed: 0 }; // driving = W.cars entry
  let carSendT = 0;
  // keep a car's visuals, heading-aware collider and E-interact spot in sync
  // with wherever it actually is (they used to stay at the parking spot)
  function syncCar(car) {
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.ry;
    const s = Math.abs(Math.sin(car.ry)), c = Math.abs(Math.cos(car.ry));
    const hl = car.hl || 2.15, hw = car.hw || 1.0;
    const ex = hl * s + hw * c, ez = hl * c + hw * s;
    car.col.x0 = car.x - ex; car.col.x1 = car.x + ex;
    car.col.z0 = car.z - ez; car.col.z1 = car.z + ez;
    if (car.inter) { car.inter.x = car.x; car.inter.z = car.z; }
  }
  function enterCar(car) {
    if (car.driver && car.driver !== myId) { toast('🚗 Someone is already driving that one.'); return; }
    carState.driving = car;
    carState.speed = 0;
    car.col.off = true;
    car.driver = myId;
    net.send({ t: 'car', id: car.id, op: 'enter' });
    toast('🚗 W/S throttle · A/D steer · Space handbrake · E to get out');
  }
  function exitCar() {
    const car = carState.driving;
    if (!car) return;
    carState.driving = null;
    car.col.off = false;
    car.driver = null;
    // step out beside the driver door
    my.x = car.x + Math.cos(car.ry) * 1.6;
    my.z = car.z - Math.sin(car.ry) * 1.6;
    my.vel.x = 0; my.vel.z = 0;
    syncCar(car);
    net.send({ t: 'car', id: car.id, op: 'exit' });
    sendPos(true);
  }
  net.on('car', (m) => {
    const car = W.cars?.find(c => c.id === m.id);
    if (!car) return;
    if (m.op === 'enter') {
      car.driver = m.driver;
      if (m.driver !== myId) car.col.off = true;
    } else if (m.op === 'exit') {
      car.driver = null;
      car.col.off = false;
      if (Number.isFinite(m.x)) { car.x = m.x; car.z = m.z; car.ry = m.ry; }
      syncCar(car);
      if (Number.isFinite(m.x)) { car.x = m.x; car.z = m.z; car.ry = m.ry; }
    } else if (m.op === 'state' && m.driver !== myId) {
      car.driver = m.driver;
      car.tx = m.x; car.tz = m.z; car.try = m.ry; // lerp targets
    }
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
    { wheel: 'zoom', sens: 1.0, fov: 70, invertY: false },
    JSON.parse(localStorage.getItem('brs-cfg') || '{}'));
  const saveCfg = () => localStorage.setItem('brs-cfg', JSON.stringify(cfg));
  let myAvatar = makeAvatar(me.name, me.vest, me.guest, me.ap);
  scene.add(myAvatar.group);
  function rebuildMyAvatar() {
    const held = myAvatar.held, seatId = myAvatar.seatId;
    scene.remove(myAvatar.group);
    myAvatar = makeAvatar(me.name, me.vest, me.guest, me.ap);
    myAvatar.setHeld(held);
    myAvatar.seatId = seatId;
    scene.add(myAvatar.group);
    updateViewmodel(); // refresh first-person hands to the new look
  }

  const others = new Map(); // id -> {avatar, target, name}
  let myId = null;

  // ---------- inventory / equipment ----------
  const invApi = initInventory({
    me,
    onEquip: (item) => {
      my.held = item;
      myAvatar.setHeld(item);
      net.send({ t: 'held', item });
      updateViewmodel();
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
  }
  net.on('swing', (m) => {
    if (m.id === myId) return;
    const o = others.get(m.id);
    if (o) { o.avatar.swing(); beep(240, .07, 'sawtooth', .04); }
  });
  function useKey() {
    const r = invApi.useSelected();
    if (!r) return;
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
    else if (e.code === 'Escape' && input.chatOpen) closeChat();
    else if (e.code === 'Escape' && started) {
      // Escape closes the top UI panel (inventory/settings) like any game menu
      if (invApi.state.open) invApi.toggle(false);
      else if (!$('settings').classList.contains('hidden')) { $('settings').classList.add('hidden'); uiFocus('settings', false); }
    }
  });
  $('btn-chat').addEventListener('touchstart', (e) => { e.preventDefault(); input.chatOpen ? closeChat() : openChat(); }, { passive: false });

  // ---------- net handlers ----------
  net.on('init', (m) => {
    myId = m.id;
    my.x = m.you.x; my.y = m.you.y; my.z = m.you.z; my.ry = m.you.ry;
    mg.applyInit(m);
    for (const [cid, c] of Object.entries(m.cars || {})) {
      const car = W.cars?.find(k => k.id === cid);
      if (!car) continue;
      if (Number.isFinite(c.x)) { car.x = c.x; car.z = c.z; car.ry = c.ry; syncCar(car); }
      car.driver = c.driver;
      if (c.driver) car.col.off = true;
    }
    me.admin = !!m.admin;
    (m.mapEdits || []).forEach(p => props.add(p));
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
    scene.add(avatar.group);
    others.set(p.id, { avatar, name: p.name, vest: p.vest, ap: p.ap, target: { x: p.x, y: p.y, z: p.z, ry: p.ry } });
  }

  connect(token, {
    onOpen: () => {},
    onClose: (e) => {
      $('hud').classList.add('hidden');
      if (e.code === 4001) { localStorage.clear(); location.reload(); return; }
      $('disc-reason').textContent = e.code === 4002 ? 'You logged in from another device.' : 'Lost connection to the break room.';
      $('disconnected').classList.remove('hidden');
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
  };
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
          }
          return;
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
      // ---- arcade car physics: throttle, speed-scaled steering, drift, crash ----
      const car = carState.driving;
      const throttle = -kv.y;                       // W forward, S reverse/brake
      const steer = -kv.x;
      const handbrake = input.keys.Space;
      const maxF = car.top || 17, maxR = 6;
      if (throttle > 0) carState.speed += (car.acc || 9) * throttle * dt;
      else if (throttle < 0) carState.speed += (carState.speed > 0 ? 14 : 5) * throttle * dt;
      carState.speed -= carState.speed * (handbrake ? 2.4 : .5) * dt; // drag
      carState.speed = Math.max(-maxR, Math.min(maxF, carState.speed));
      if (Math.abs(carState.speed) > .2) {
        const grip = handbrake ? 1.7 : 1.0;
        car.ry += steer * grip * Math.min(Math.abs(carState.speed) / 7, 1) * 1.9 * dt * Math.sign(carState.speed);
      }
      let cx2 = car.x + Math.sin(car.ry) * carState.speed * dt;
      let cz2 = car.z + Math.cos(car.ry) * carState.speed * dt;
      const [rx, rz] = resolveCollisions(cx2, cz2, 1.25);
      if (Math.hypot(rx - cx2, rz - cz2) > .01) { // crash
        if (Math.abs(carState.speed) > 5) beep(90, .2, 'sawtooth', .2);
        carState.speed *= .35;
      }
      car.x = rx; car.z = rz;
      syncCar(car);
      // player rides in the seat; engine hum
      my.x = car.x; my.z = car.z; my.y = .45; my.ry = car.ry;
      my.anim = 'sit';
      carSendT += dt;
      if (carSendT > .1) { carSendT = 0; net.send({ t: 'car', id: car.id, op: 'state', x: +car.x.toFixed(2), z: +car.z.toFixed(2), ry: +car.ry.toFixed(3) }); }
      if (input.actionQueued2) {} // noop
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

    // remote-driven cars interpolate toward their latest state
    if (W.cars) for (const car of W.cars) {
      if (car.driver && car.driver !== myId && car.tx !== undefined) {
        car.x += (car.tx - car.x) * Math.min(1, dt * 10);
        car.z += (car.tz - car.z) * Math.min(1, dt * 10);
        let cdr = (car.try - car.ry + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        car.ry += cdr * Math.min(1, dt * 10);
        syncCar(car);
      }
    }

    // badge-gate paddle animation
    if (W.gates) for (const g of W.gates) {
      const target = g.open ? 1.15 : 0;
      g.pl.rotation.y += (-target - g.pl.rotation.y) * Math.min(1, dt * 8);
      g.pr.rotation.y += (target - g.pr.rotation.y) * Math.min(1, dt * 8);
    }

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
    my, mg, scene, W, teleport: (x, z, yaw) => { my.x = x; my.z = z; if (yaw !== undefined) my.yaw = yaw; sendPos(true); },
    action: doAction, nearest: () => nearest?.id || nearestSeat?.id || null,
  };

  addEventListener('wheel', (e) => {
    if (input.uiOpen) return; // scrolling a panel shouldn't zoom/cycle
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
    for (const id of ['a', 'b']) {
      const s = mg.c4[id], a = W.anchors[`c4-${id}`];
      if (s && a && s.seats.includes(me.name) && Math.hypot(my.x - a.x, my.z - a.z) > 4.5)
        net.send({ t: 'c4', id, op: 'leave' });
    }
    const cs = mg.chess, ca = W.anchors.chess;
    if (cs && ca && cs.seats.includes(me.name) && Math.hypot(my.x - ca.x, my.z - ca.z) > 4.5)
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
