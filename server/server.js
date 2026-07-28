// Amazon Break Room Simulator — game server.
// Express serves the client; ws handles realtime state (players, chat, mini-games).
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as store from './store.js';
import { Connect4, Chess, PongTable } from './games.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true); // behind Caddy/nginx on simulator.rest
app.use(express.json());
// Game code must be no-store: Cloudflare bypasses no-store entirely, whereas
// no-cache gets rewritten by its Browser Cache TTL (players kept stale js for
// hours after deploys). Vendor libs never change → long cache; images 1h.
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', setHeaders: (res, p) => {
  if (p.includes(`${path.sep}vendor${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=86400');
  else if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
} }));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'play.html')));

app.post('/api/register', (req, res) => res.json(store.register(req.body.name, req.body.pass)));
app.post('/api/login', (req, res) => res.json(store.login(req.body.name, req.body.pass)));
app.post('/api/guest', (req, res) => res.json(store.guest()));
app.get('/api/stats', (req, res) => res.json({
  joins: stats.joins, naps: stats.naps, marks: tags.length,
  sleepers: sleepers.size, props: props.size, online: players.size,
}));

// CLI: node server/server.js --admin SomeName   (grants admin to an account)
const adminIdx = process.argv.indexOf('--admin');
if (adminIdx !== -1 && process.argv[adminIdx + 1]) {
  console.log(store.setAdmin(process.argv[adminIdx + 1])
    ? `[admin] granted admin to ${process.argv[adminIdx + 1]}`
    : `[admin] no such account: ${process.argv[adminIdx + 1]}`);
}

// ---------- persistent level-editor map edits ----------
import fs from 'fs';
const EDITS_FILE = path.join(__dirname, '..', 'data', 'map-edits.json');
let mapEdits = [];
try { mapEdits = JSON.parse(fs.readFileSync(EDITS_FILE, 'utf8')); } catch {}
let nextPropId = mapEdits.reduce((m, p) => Math.max(m, Number(String(p.id).slice(1)) || 0), 0) + 1;
let editSaveTimer = null;
function saveEdits() {
  if (editSaveTimer) return;
  editSaveTimer = setTimeout(() => {
    editSaveTimer = null;
    fs.writeFileSync(EDITS_FILE, JSON.stringify(mapEdits, null, 1));
  }, 300);
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---------- world state ----------
let nextId = 1;
const players = new Map(); // id -> {id, key, name, vest, ws, x,y,z,ry,anim,seat,held, lastMsg}

const broadcast = (msg, exceptId = null) => {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
};

const pongEvents = (ev, data) => {
  broadcast({ t: 'pongev', ev, ...data });
  if (ev === 'gameover') {
    const table = pong[data.id];
    const w = table?.seats?.[data.winner];
    if (w) store.addWin(w.key, 'pongWins');
    sys(`🏓 ${data.winnerName} wins ping pong ${data.score[data.winner]}-${data.score[1 - data.winner]}!`);
  }
};

const c4 = { a: new Connect4('a'), b: new Connect4('b') };
const chess = new Chess();
const pong = { a: new PongTable('a', pongEvents), b: new PongTable('b', pongEvents) };

function sys(text) { broadcast({ t: 'sys', text }); }

const cars = {}; // id -> {x, z, ry, driver}

// ---------- persistent world state: sleepers, car positions, physics props ----------
// The break room is a place, not a session: people who leave stay behind as
// nappers, cars stay where they were parked, spawned props survive restarts.
const WORLD_FILE = path.join(__dirname, '..', 'data', 'world-state.json');
const clampX = (n) => Math.max(-78, Math.min(148, n));
const clampZ = (n) => Math.max(-58, Math.min(186, n));
let savedWorld = {};
try { savedWorld = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')); } catch {}
const sleepers = new Map(Object.entries(savedWorld.sleepers || {})); // key -> {key,name,vest,ap,guest,x,y,z,ry,ts}
const props = new Map(Object.entries(savedWorld.props || {}));       // id -> {id,kind,p:[x,y,z],q:[x,y,z,w]}
for (const [cid, c] of Object.entries(savedWorld.cars || {})) {
  if (!/^(car\d+|lambo)$/.test(cid)) continue;
  if (Array.isArray(c.p)) cars[cid] = { p: c.p, q: Array.isArray(c.q) ? c.q : [0, 0, 0, 1], driver: null };
  else if (Number.isFinite(c.x)) { // migrate pre-rigid-body saves {x,z,ry}
    const h = (c.ry || 0) / 2;
    cars[cid] = { p: [c.x, .55, c.z], q: [0, +Math.sin(h).toFixed(3), 0, +Math.cos(h).toFixed(3)], driver: null };
  }
}
let nextPhysId = [...props.keys()].reduce((m, id) => Math.max(m, Number(String(id).slice(2)) || 0), 0) + 1;
// dropped items lying on the floor — minecraft style, persisted like all else
const drops = new Map(Object.entries(savedWorld.drops || {})); // id -> {id, item, n, x, y, z}
let nextDropId = [...drops.keys()].reduce((m, id) => Math.max(m, Number(String(id).slice(1)) || 0), 0) + 1;
// permanent marker tags — the "I was here" layer. They outlive everyone.
const tags = Array.isArray(savedWorld.tags) ? savedWorld.tags : [];
let nextTagId = tags.reduce((m, t) => Math.max(m, Number(String(t.id).slice(1)) || 0), 0) + 1;
// lifetime counters for the retro hit-counter energy
const stats = Object.assign({ joins: 0, naps: 0 }, savedWorld.stats || {});
function pruneSleepers() { // nappers expire after a week; keep the 60 most recent
  const cutoff = Date.now() - 7 * 864e5;
  for (const [k, s] of sleepers) if ((s.ts || 0) < cutoff) sleepers.delete(k);
  while (sleepers.size > 60) {
    const oldest = [...sleepers.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))[0][0];
    sleepers.delete(oldest);
  }
}
pruneSleepers();
let worldDirty = false;
function saveWorld() {
  worldDirty = false;
  const tmp = WORLD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ sleepers: Object.fromEntries(sleepers), cars, props: Object.fromEntries(props), drops: Object.fromEntries(drops), tags, stats }));
  fs.renameSync(tmp, WORLD_FILE); // atomic: a crash mid-write can't corrupt the state
}
setInterval(() => { if (worldDirty) saveWorld(); }, 10000);
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try {
      // snapshot everyone still connected as sleepers so a restart/deploy
      // puts them right back where they were standing
      for (const p of players.values()) {
        sleepers.set(p.key, {
          key: p.key, name: p.name, vest: p.vest, ap: p.ap || null, guest: !!p.guest,
          x: +p.x.toFixed(2), y: +Math.max(0, Math.min(8, p.y)).toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2), ts: Date.now(),
        });
      }
      pruneSleepers();
      saveWorld();
      store.saveNow();
    } catch {}
    process.exit(0);
  });
}

function pubState(p) {
  return { id: p.id, name: p.name, vest: p.vest, ap: p.ap || null, x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim, seat: p.seat, held: p.held };
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const user = store.byToken(url.searchParams.get('token') || '');
  if (!user) { ws.close(4001, 'bad token'); return; }

  // one connection per account: boot the older one
  for (const p of players.values()) {
    if (p.key === user.key) { try { p.ws.close(4002, 'logged in elsewhere'); } catch {} }
  }

  const id = nextId++;
  // spawn on the landscaped front walkway, facing the main entry — badge in!
  const p = {
    id, key: user.key, name: user.name, vest: user.vest, admin: user.admin, ap: user.ap, guest: !!user.guest, ws,
    x: 105 + Math.random() * 3, y: 0, z: -1 + Math.random() * 2, ry: -Math.PI / 2,
    anim: 'idle', seat: null, held: null, lastChat: 0,
  };
  // returning player: wake their napper and resume exactly where they dozed off
  const slept = sleepers.get(user.key);
  if (slept) {
    p.x = slept.x; p.y = Math.max(0, Math.min(8, slept.y || 0)); p.z = slept.z; p.ry = slept.ry || 0;
    sleepers.delete(user.key);
    worldDirty = true;
  }
  players.set(id, p);
  stats.joins++;
  worldDirty = true;

  ws.send(JSON.stringify({
    t: 'init', id, you: pubState(p), guest: user.guest, admin: user.admin,
    inv: user.inv, hotbar: user.hotbar,
    visitorNum: stats.joins, stats: { joins: stats.joins, naps: stats.naps, marks: tags.length },
    tags,
    drops: [...drops.values()],
    mapEdits,
    players: [...players.values()].filter(q => q.id !== id).map(pubState),
    c4: { a: c4.a.state(), b: c4.b.state() },
    chess: chess.state(),
    pong: { a: pong.a.state(), b: pong.b.state() },
    highscores: store.getHighscores(),
    cars,
    sleepers: [...sleepers.values()],
    props: [...props.values()],
    online: players.size,
  }));
  if (slept) broadcast({ t: 'wake', key: user.key }, id);
  broadcast({ t: 'pj', p: pubState(p), online: players.size }, id);
  sys(slept
    ? `🌅 ${p.name} woke up from their nap (${players.size} online)`
    : `👋 ${p.name} walked into the break room (${players.size} online)`);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { handle(p, m); } catch (e) { console.error('msg error', e); }
  });

  ws.on('close', () => {
    players.delete(id);
    for (const [cid, c] of Object.entries(cars)) {
      if (c.driver === id) { c.driver = null; broadcast({ t: 'car', id: cid, op: 'exit', p: c.p, q: c.q }); }
    }
    for (const g of [c4.a, c4.b]) { g.leave(p.key); broadcast({ t: 'c4', s: g.state() }); }
    chess.leave(p.key); broadcast({ t: 'chess', s: chess.state() });
    for (const t of [pong.a, pong.b]) if (t.leave(p.key)) broadcast({ t: 'pong', s: t.state() });
    broadcast({ t: 'pl', id, online: players.size });
    // leave a napper behind — unless the same account reconnected already
    // (dupe-login boot fires this close AFTER the new connection is live)
    const stillOn = [...players.values()].some(q => q.key === p.key);
    if (!stillOn) {
      const s = {
        key: p.key, name: p.name, vest: p.vest, ap: p.ap || null, guest: !!user.guest,
        x: +p.x.toFixed(2), y: +Math.max(0, Math.min(8, p.y)).toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2), ts: Date.now(),
      };
      sleepers.set(p.key, s);
      pruneSleepers();
      stats.naps++;
      worldDirty = true;
      broadcast({ t: 'sleep', s });
      sys(`💤 ${p.name} dozed off mid-break`);
    }
  });
});

function handle(p, m) {
  switch (m.t) {
    case 'p': { // position update [x,y,z,ry,anim]
      const [x, y, z, ry, anim] = m.d || [];
      if (![x, y, z, ry].every(Number.isFinite)) return;
      p.x = Math.max(-78, Math.min(148, x));
      p.y = Math.max(0, Math.min(8, y));
      p.z = Math.max(-58, Math.min(186, z));
      p.ry = ry;
      p.anim = ['idle', 'walk', 'run', 'sit', 'crouch', 'crouchwalk'].includes(anim) ? anim : 'idle';
      break;
    }
    case 'chat': {
      const now = Date.now();
      if (now - p.lastChat < 600) return;
      p.lastChat = now;
      const text = String(m.text || '').slice(0, 160).trim();
      if (text) broadcast({ t: 'chat', id: p.id, name: p.name, text });
      break;
    }
    case 'sit':
      p.seat = m.seat ? String(m.seat).slice(0, 40) : null;
      break;
    case 'held': {
      p.held = m.item ? String(m.item).slice(0, 20) : null;
      if (m.item && m.announce) sys(`🛒 ${p.name} grabbed ${m.announce} from avenue C`);
      break;
    }
    case 'vest':
      store.setVest(p.key, m.vest);
      p.vest = m.vest;
      broadcast({ t: 'vest', id: p.id, vest: p.vest });
      break;
    case 'inv':
      store.setInventory(p.key, m.inv, m.hotbar);
      break;
    case 'swing': {
      const now = Date.now();
      if (now - (p.lastSwing || 0) < 280) return;
      p.lastSwing = now;
      broadcast({ t: 'swing', id: p.id });
      break;
    }
    case 'appear': {
      const ap = store.setAppearance(p.key, m.ap);
      if (!ap) return;
      p.ap = ap;
      broadcast({ t: 'appear', id: p.id, ap });
      break;
    }
    case 'c4': {
      const g = c4[m.id];
      if (!g) return;
      if (m.op === 'seat') { if (g.sit(m.seat, p)) sys(`🔴 ${p.name} sat down at big Connect 4 (${m.id === 'a' ? 'lounge' : 'games corner'})`); }
      else if (m.op === 'leave') g.leave(p.key);
      else if (m.op === 'drop') {
        const r = g.drop(p.key, m.col);
        if (r.error) return;
        if (g.winner === 0 || g.winner === 1) {
          const w = g.seats[g.winner];
          if (w) { store.addWin(w.key, 'c4Wins'); sys(`🎉 ${w.name} wins giant Connect 4!`); }
        }
      }
      else if (m.op === 'reset') { if (g.seats.some(s => s?.key === p.key)) g.reset(); }
      broadcast({ t: 'c4', s: g.state() });
      break;
    }
    case 'chess': {
      if (m.op === 'seat') { if (chess.sit(m.seat, p)) sys(`♟️ ${p.name} sat down at the chess table (${m.seat === 0 ? 'white' : 'black'})`); }
      else if (m.op === 'leave') chess.leave(p.key);
      else if (m.op === 'move') {
        const r = chess.move(p.key, m.from, m.to);
        if (r.error) return;
        if (r.winnerSeat !== null && r.winnerSeat !== undefined) {
          const w = chess.seats[r.winnerSeat];
          if (w) { store.addWin(w.key, 'chessWins'); sys(`♛ ${w.name} captured the king and wins at chess!`); }
        }
      }
      else if (m.op === 'reset') { if (chess.seats.some(s => s?.key === p.key)) chess.reset(); }
      broadcast({ t: 'chess', s: chess.state() });
      break;
    }
    case 'pong': {
      const t = pong[m.id];
      if (!t) return;
      if (m.op === 'seat') { if (t.sit(m.side, p)) sys(`🏓 ${p.name} picked up a paddle at table ${m.id.toUpperCase()}`); }
      else if (m.op === 'leave') t.leave(p.key);
      else if (m.op === 'hit') { t.hit(p.key); return; }
      broadcast({ t: 'pong', s: t.state() });
      break;
    }
    case 'arcade': {
      const hs = store.submitScore(p.name, m.score);
      broadcast({ t: 'hs', highscores: hs });
      if (m.score >= 500) sys(`🕹️ ${p.name} scored ${m.score} on Prime Breaker!`);
      break;
    }
    case 'car': {
      const id = String(m.id || '').slice(0, 12);
      if (!/^(car\d+|lambo)$/.test(id)) return;
      const c = cars[id] || (cars[id] = { p: null, q: [0, 0, 0, 1], driver: null });
      const readPose = () => { // full rigid-body pose: position + quaternion (+velocity)
        const pos = Array.isArray(m.p) ? m.p.map(Number) : null;
        const q = Array.isArray(m.q) ? m.q.map(Number) : null;
        if (!pos || pos.length !== 3 || !pos.every(Number.isFinite) || !q || q.length !== 4 || !q.every(Number.isFinite)) return false;
        c.p = [clampX(pos[0]), Math.max(0, Math.min(40, pos[1])), clampZ(pos[2])];
        c.q = q.map(n => +n.toFixed(3));
        worldDirty = true;
        return true;
      };
      const vel = () => Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite) ? m.v : null;
      if (m.op === 'enter') {
        if (c.driver && c.driver !== p.id) return;
        c.driver = p.id;
        broadcast({ t: 'car', id, op: 'enter', driver: p.id });
        sys(id === 'lambo' ? `🏎️ ${p.name} found THE LAMBO` : `🚗 ${p.name} got into a car`);
      } else if (m.op === 'exit') {
        if (c.driver !== p.id) return;
        c.driver = null;
        broadcast({ t: 'car', id, op: 'exit', p: c.p, q: c.q });
      } else if (m.op === 'state') { // driver's stream
        if (c.driver !== p.id) return;
        if (!readPose()) return;
        broadcast({ t: 'car', id, op: 'state', p: c.p, q: c.q, v: vel(), driver: p.id }, p.id);
      } else if (m.op === 'phys') { // driverless nudge: physgun, shoves, rolling to a stop
        if (c.driver) return;
        if (!readPose()) return;
        broadcast({ t: 'car', id, op: 'phys', p: c.p, q: c.q, v: vel(), owner: p.id }, p.id);
      } else if (m.op === 'grab' || m.op === 'drop') { // physgun beam relay
        if (m.op === 'grab' && c.driver) return;
        broadcast({ t: 'car', id, op: m.op, by: p.id }, p.id);
      }
      break;
    }
    case 'prop': { // sandbox physics props — spawn, owner-simulated motion, grab/drop, delete
      if (m.op === 'spawn') {
        const now = Date.now();
        if (now - (p.lastSpawn || 0) < 250) return;
        p.lastSpawn = now;
        if (props.size >= 150) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '📦 Prop limit reached (150) — grab some with the physgun and press X to clear them.' })); return; }
        const KINDS = ['box', 'crate', 'ball', 'barrel', 'melon', 'cone'];
        if (!KINDS.includes(m.kind)) return;
        const pos = Array.isArray(m.p) ? m.p.map(Number) : [];
        if (pos.length !== 3 || !pos.every(Number.isFinite)) return;
        const prop = { id: 'fp' + nextPhysId++, kind: m.kind, p: [clampX(pos[0]), Math.max(0, Math.min(30, pos[1])), clampZ(pos[2])], q: [0, 0, 0, 1] };
        props.set(prop.id, prop);
        worldDirty = true;
        broadcast({ t: 'prop', op: 'add', prop, owner: p.id });
      } else if (m.op === 'state') {
        const pr = props.get(String(m.id));
        if (!pr) return;
        const pos = Array.isArray(m.p) ? m.p.map(Number) : [];
        const q = Array.isArray(m.q) ? m.q.map(Number) : [];
        if (pos.length !== 3 || !pos.every(Number.isFinite) || q.length !== 4 || !q.every(Number.isFinite)) return;
        pr.p = [clampX(+pos[0].toFixed(2)), Math.max(-2, Math.min(40, +pos[1].toFixed(2))), clampZ(+pos[2].toFixed(2))];
        pr.q = q.map(n => +n.toFixed(3));
        worldDirty = true;
        const v = Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite) ? m.v : null;
        broadcast({ t: 'prop', op: 'state', id: pr.id, p: pr.p, q: pr.q, v, owner: p.id }, p.id);
      } else if (m.op === 'grab' || m.op === 'drop') {
        const pr = props.get(String(m.id));
        if (!pr) return;
        broadcast({ t: 'prop', op: m.op, id: pr.id, by: p.id }, p.id);
      } else if (m.op === 'del') {
        const pr = props.get(String(m.id));
        if (!pr) return;
        props.delete(pr.id);
        worldDirty = true;
        broadcast({ t: 'prop', op: 'del', id: pr.id });
      }
      break;
    }
    case 'gate': // badge-gate animation relay so everyone sees paddles open
      broadcast({ t: 'gate', id: String(m.id || '').slice(0, 20) });
      break;
    case 'drop': { // items tossed on the floor, minecraft style
      if (m.op === 'add') {
        const now = Date.now();
        if (now - (p.lastDrop || 0) < 250) return;
        p.lastDrop = now;
        if (!store.ITEM_IDS.includes(m.item)) return;
        if (drops.size >= 200) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '🎒 The floor is covered in stuff already — pick something up first.' })); return; }
        const n = Math.max(1, Math.min(99, Math.floor(Number(m.n) || 1)));
        const d = {
          id: 'd' + nextDropId++, item: m.item, n,
          x: clampX(+(+m.x || 0).toFixed(2)), y: Math.max(.05, Math.min(8, +(+m.y || 0).toFixed(2))), z: clampZ(+(+m.z || 0).toFixed(2)),
        };
        drops.set(d.id, d);
        worldDirty = true;
        broadcast({ t: 'drop', op: 'add', d });
      } else if (m.op === 'take') {
        const d = drops.get(String(m.id));
        if (!d) return;
        drops.delete(d.id);
        worldDirty = true;
        broadcast({ t: 'drop', op: 'del', id: d.id, taker: p.id });
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'drop', op: 'grant', item: d.item, n: d.n }));
      }
      break;
    }
    case 'tag': { // permanent marker on the floor — your mark stays forever
      const now = Date.now();
      if (now - (p.lastTag || 0) < 20000) {
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '🖊️ The marker needs a minute to dry — try again shortly.' }));
        return;
      }
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      if (!text) return;
      p.lastTag = now;
      const tag = {
        id: 't' + nextTagId++, name: p.name, text,
        x: clampX(+(+m.x || 0).toFixed(1)), z: clampZ(+(+m.z || 0).toFixed(1)),
        ry: +(+m.ry || 0).toFixed(2), hue: Math.floor(Math.random() * 360), ts: now,
      };
      tags.push(tag);
      if (tags.length > 600) tags.shift(); // eventually the oldest ink fades
      worldDirty = true;
      broadcast({ t: 'tag', op: 'add', tag });
      sys(`🖊️ ${p.name} left a mark`);
      break;
    }
    case 'edit': { // admin-only persistent level editor
      if (!p.admin) return;
      if (m.op === 'add' && m.prop && typeof m.prop.kind === 'string') {
        const prop = {
          id: 'p' + nextPropId++,
          kind: String(m.prop.kind).slice(0, 24),
          x: +(+m.prop.x || 0).toFixed(2), z: +(+m.prop.z || 0).toFixed(2),
          ry: +(+m.prop.ry || 0).toFixed(3), s: Math.max(.25, Math.min(4, +m.prop.s || 1)),
        };
        mapEdits.push(prop);
        saveEdits();
        broadcast({ t: 'edit', op: 'add', prop });
        sys(`🛠️ ${p.name} placed a ${prop.kind}`);
      } else if (m.op === 'update' && m.prop?.id) {
        const prop = mapEdits.find(e => e.id === m.prop.id);
        if (!prop) return;
        if (Number.isFinite(+m.prop.x)) prop.x = +(+m.prop.x).toFixed(2);
        if (Number.isFinite(+m.prop.z)) prop.z = +(+m.prop.z).toFixed(2);
        if (Number.isFinite(+m.prop.ry)) prop.ry = +(+m.prop.ry).toFixed(3);
        if (Number.isFinite(+m.prop.s)) prop.s = Math.max(.25, Math.min(4, +m.prop.s));
        saveEdits();
        broadcast({ t: 'edit', op: 'update', prop });
      } else if (m.op === 'del' && m.id) {
        const i = mapEdits.findIndex(e => e.id === m.id);
        if (i === -1) return;
        mapEdits.splice(i, 1);
        saveEdits();
        broadcast({ t: 'edit', op: 'del', id: m.id });
      }
      break;
    }
  }
}

// position snapshots at 12 Hz
setInterval(() => {
  if (players.size === 0) return;
  const d = [...players.values()].map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), p.anim, p.seat, p.held]);
  broadcast({ t: 'ps', d });
}, 83);

server.listen(PORT, HOST, () => {
  console.log(`Amazon Break Room Simulator running at http://${HOST}:${PORT}`);
});
