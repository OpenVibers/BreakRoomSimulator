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
    if (w) { store.addWin(w.key, 'pongWins'); stats.wins++; worldDirty = true; }
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
for (const [id, d] of drops) { // sweep anything that ever ended up outside the world
  if (!Number.isFinite(d?.x) || !Number.isFinite(d?.z) || !(d.y >= 0 && d.y <= 8)) drops.delete(id);
}
let nextDropId = [...drops.keys()].reduce((m, id) => Math.max(m, Number(String(id).slice(1)) || 0), 0) + 1;
// base-building pieces: walls/floors with hp, wood→stone upgrades. Persisted.
const builds = new Map(Object.entries(savedWorld.builds || {})); // id -> {id, kind, tier, p:[x,y,z], ry, hp, owner}
let nextBuildId = [...builds.keys()].reduce((m, id) => Math.max(m, Number(String(id).slice(1)) || 0), 0) + 1;
const BUILD_HP = { wood: 200, stone: 500 };
// permanent marker tags — the "I was here" layer. They outlive everyone.
const tags = Array.isArray(savedWorld.tags) ? savedWorld.tags : [];
let nextTagId = tags.reduce((m, t) => Math.max(m, Number(String(t.id).slice(1)) || 0), 0) + 1;
// lifetime counters for the hall-of-records board — numbers that only grow
const stats = Object.assign(
  { joins: 0, naps: 0, props: 0, knocks: 0, drops: 0, joyrides: 0, lambo: 0, burns: 0, kills: 0, wins: 0, since: Date.now() },
  savedWorld.stats || {});
stats.since ||= Date.now();
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
  fs.writeFileSync(tmp, JSON.stringify({ sleepers: Object.fromEntries(sleepers), cars, props: Object.fromEntries(props), drops: Object.fromEntries(drops), builds: Object.fromEntries(builds), tags, stats }));
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

// death: spill everything, reset, respawn at the walkway — used by pvp AND npcs
function killPlayer(t, byName) {
  stats.kills++;
  worldDirty = true;
  spillInventory(t.key, t.x, t.z);
  t.hp = 100;
  t.x = 105 + Math.random() * 3; t.y = 0; t.z = -1 + Math.random() * 2;
  if (t.ws.readyState === 1) t.ws.send(JSON.stringify({ t: 'died', by: byName, x: t.x, z: t.z }));
  broadcast({ t: 'hp', id: t.id, hp: 100 });
}

// ---------- NPCs: pasture animals by the neighborhood, zombies after dark ----------
const NPC_STATS = { cow: { hp: 40, speed: .9 }, chicken: { hp: 12, speed: 1.5 }, zombie: { hp: 50, speed: 2.3 } };
const npcs = new Map(); // id -> {id, kind, x, z, ry, hp, hx, hz, tx, tz, atkT}
let nextNpcId = 1;
function spawnNpc(kind, x, z) {
  const n = { id: nextNpcId++, kind, x, z, ry: Math.random() * 6.28, hp: NPC_STATS[kind].hp, hx: x, hz: z, tx: null, tz: null, atkT: 0 };
  npcs.set(n.id, n);
  return n;
}
for (let i = 0; i < 4; i++) spawnNpc('cow', 38 + i * 7, 148 + (i % 2) * 10);
for (let i = 0; i < 5; i++) spawnNpc('chicken', 58 + i * 3.5, 156 + (i % 3) * 5);
function dayFactorNow() { // must match lighting.js (skewed 8-min cycle)
  const rawT = (Date.now() / 1000 % 480) / 480;
  const t = rawT < .3 ? rawT / .3 * .5 : .5 + (rawT - .3) / .7 * .5;
  const elev = -Math.cos(t * Math.PI * 2);
  const k = Math.max(0, Math.min(1, (elev + .14) / .42));
  return k * k * (3 - 2 * k);
}
function npcSnapshot() {
  return [...npcs.values()].map(n => [n.id, n.kind, +n.x.toFixed(1), +n.z.toFixed(1), +n.ry.toFixed(2), n.hp]);
}
setInterval(() => { // 5Hz herd-and-horde tick
  const night = dayFactorNow() < .22;
  const zCount = [...npcs.values()].filter(n => n.kind === 'zombie').length;
  if (night && players.size > 0 && zCount < 6 && Math.random() < .35) {
    const ps = [...players.values()];
    const t = ps[Math.floor(Math.random() * ps.length)];
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 10;
    spawnNpc('zombie', clampX(t.x + Math.cos(a) * r), clampZ(t.z + Math.sin(a) * r));
    if (zCount === 0) sys('🧟 something is shuffling around out there…');
  }
  if (!night && zCount) { // sunrise burns them off
    for (const [id, n] of npcs) if (n.kind === 'zombie') { npcs.delete(id); broadcast({ t: 'npc', op: 'del', id, burn: true }); }
  }
  // herd upkeep
  if (Math.random() < .012) {
    const cows = [...npcs.values()].filter(n => n.kind === 'cow').length;
    const hens = [...npcs.values()].filter(n => n.kind === 'chicken').length;
    if (cows < 4) spawnNpc('cow', 38 + Math.random() * 24, 148 + Math.random() * 14);
    else if (hens < 5) spawnNpc('chicken', 56 + Math.random() * 16, 154 + Math.random() * 12);
  }
  const step = .2; // seconds per tick
  for (const n of npcs.values()) {
    const sp = NPC_STATS[n.kind].speed;
    if (n.kind === 'zombie') {
      let best = null, bd = 45;
      for (const p of players.values()) { const dd = Math.hypot(p.x - n.x, p.z - n.z); if (dd < bd) { bd = dd; best = p; } }
      if (best) {
        n.ry = Math.atan2(best.x - n.x, best.z - n.z);
        if (bd > 1.4) {
          const nx2 = n.x + Math.sin(n.ry) * sp * step, nz2 = n.z + Math.cos(n.ry) * sp * step;
          // the facility is lit — zombies won't set foot inside
          const INDOORS = [[58, 92, 31, 107], [62, 92, -17, 17], [58, 92, 17, 31], [52.5, 58, 39, 99], [48, 53, 63, 82]];
          if (!INDOORS.some(([x0, x1, z0, z1]) => nx2 >= x0 && nx2 <= x1 && nz2 >= z0 && nz2 <= z1)) { n.x = nx2; n.z = nz2; }
        }
        else if (Date.now() - n.atkT > 1200) {
          n.atkT = Date.now();
          best.hp = (best.hp ?? 100) - 8;
          if (best.hp <= 0) { killPlayer(best, 'a zombie'); sys(`🧟 ${best.name} got eaten by a zombie`); }
          else broadcast({ t: 'hp', id: best.id, hp: best.hp, by: -1 });
        }
      }
    } else { // graze around the home spot
      if (n.tx == null || Math.hypot(n.tx - n.x, n.tz - n.z) < .6) {
        if (Math.random() < .08) { n.tx = n.hx + (Math.random() - .5) * 26; n.tz = n.hz + (Math.random() - .5) * 20; }
      } else {
        n.ry = Math.atan2(n.tx - n.x, n.tz - n.z);
        n.x += Math.sin(n.ry) * sp * step;
        n.z += Math.cos(n.ry) * sp * step;
      }
    }
    n.x = clampX(n.x); n.z = clampZ(n.z);
  }
  if (players.size) broadcast({ t: 'npcs', d: npcSnapshot() });
}, 200);

// a victim's whole inventory scatters on the floor around where they fell
function spillInventory(key, x, z) {
  const u = store.getInventory(key);
  if (!u) return;
  for (const s of [...u.inv, ...u.hotbar]) {
    if (!s || drops.size >= 200) continue;
    const d = {
      id: 'd' + nextDropId++, item: s.id, n: s.n || 1,
      x: clampX(+(x + (Math.random() - .5) * 2.2).toFixed(2)), y: .35, z: clampZ(+(z + (Math.random() - .5) * 2.2).toFixed(2)),
    };
    drops.set(d.id, d);
    broadcast({ t: 'drop', op: 'add', d });
  }
  store.clearInventory(key);
  worldDirty = true;
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
    anim: 'idle', seat: null, held: null, lastChat: 0, hp: 100,
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
    visitorNum: stats.joins, stats: { ...stats, marks: tags.length },
    hp: p.hp,
    tags,
    drops: [...drops.values()],
    builds: [...builds.values()],
    mapEdits,
    players: [...players.values()].filter(q => q.id !== id).map(pubState),
    c4: { a: c4.a.state(), b: c4.b.state() },
    chess: chess.state(),
    pong: { a: pong.a.state(), b: pong.b.state() },
    highscores: store.getHighscores(),
    cars,
    sleepers: [...sleepers.values()],
    props: [...props.values()],
    npcs: npcSnapshot(),
    friends: store.getFriends(user.key),
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
          if (w) { store.addWin(w.key, 'c4Wins'); stats.wins++; worldDirty = true; sys(`🎉 ${w.name} wins giant Connect 4!`); }
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
          if (w) { store.addWin(w.key, 'chessWins'); stats.wins++; worldDirty = true; sys(`♛ ${w.name} captured the king and wins at chess!`); }
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
        stats.joyrides++;
        if (id === 'lambo') stats.lambo++;
        worldDirty = true;
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
        const prop = { id: 'fp' + nextPhysId++, kind: m.kind, p: [clampX(pos[0]), Math.max(0, Math.min(30, pos[1])), clampZ(pos[2])], q: [0, 0, 0, 1], owner: p.key };
        props.set(prop.id, prop);
        stats.props++;
        worldDirty = true;
        broadcast({ t: 'prop', op: 'add', prop, owner: p.id });
      } else if (m.op === 'state') {
        const pr = props.get(String(m.id));
        if (!pr) return;
        if (pr.owner && !store.isFriend(pr.owner, p.key)) return; // prop protection
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
        if (m.op === 'grab' && pr.owner && !store.isFriend(pr.owner, p.key)) {
          if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '🔒 That prop belongs to someone else (they can add you as a friend).' }));
          broadcast({ t: 'prop', op: 'drop', id: pr.id }, null); // force-release on their client
          return;
        }
        broadcast({ t: 'prop', op: m.op, id: pr.id, by: p.id }, p.id);
      } else if (m.op === 'del') {
        const pr = props.get(String(m.id));
        if (!pr) return;
        if (pr.owner && !store.isFriend(pr.owner, p.key)) return;
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
        stats.drops++;
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
    case 'shoot': { // tracer relay so everyone sees/hears pistol fire
      const now = Date.now();
      if (now - (p.lastShot || 0) < 280) return;
      p.lastShot = now;
      const to = Array.isArray(m.to) ? m.to.map(Number) : [];
      if (to.length !== 3 || !to.every(Number.isFinite)) return;
      broadcast({ t: 'shoot', id: p.id, from: [+p.x.toFixed(1), 1.5, +p.z.toFixed(1)], to: to.map(n => +n.toFixed(1)) }, p.id);
      break;
    }
    case 'build': { // rust-lite base building
      if (m.op === 'place') {
        const now = Date.now();
        if (now - (p.lastBuild || 0) < 400) return;
        p.lastBuild = now;
        if (builds.size >= 300) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '🧱 Build limit reached (300).' })); return; }
        if (!['wall', 'floor', 'door'].includes(m.kind)) return;
        const pos = Array.isArray(m.p) ? m.p.map(Number) : [];
        if (pos.length !== 3 || !pos.every(Number.isFinite) || !Number.isFinite(+m.ry)) return;
        const b = {
          id: 'b' + nextBuildId++, kind: m.kind, tier: 'wood',
          p: [clampX(pos[0]), Math.max(0, Math.min(12, pos[1])), clampZ(pos[2])],
          ry: +(+m.ry).toFixed(3), hp: m.kind === 'door' ? 150 : BUILD_HP.wood, owner: p.key,
        };
        builds.set(b.id, b);
        worldDirty = true;
        broadcast({ t: 'build', op: 'add', b });
      } else if (m.op === 'hit') {
        const b = builds.get(String(m.id));
        if (!b) return;
        if (b.owner && !store.isFriend(b.owner, p.key)) { // base protection
          if (p.ws.readyState === 1 && Math.random() < .3) p.ws.send(JSON.stringify({ t: 'sys', text: '🔒 Protected base — only the owner and their friends can touch it.' }));
          return;
        }
        const BDMG = { axe: 10, stoneaxe: 14, pickaxe: 12, stonepick: 16, pistol: 15, wrench: 8 };
        const dmg = BDMG[String(m.item)] ?? 4;
        if (Math.hypot(p.x - b.p[0], p.z - b.p[2]) > (m.item === 'pistol' ? 50 : 4.5)) return;
        b.hp -= dmg;
        worldDirty = true;
        if (b.hp <= 0) {
          builds.delete(b.id);
          broadcast({ t: 'build', op: 'del', id: b.id });
        } else broadcast({ t: 'build', op: 'hp', id: b.id, hp: b.hp });
      } else if (m.op === 'fade') { // gmod fading door
        const b = builds.get(String(m.id));
        if (!b || b.kind !== 'door') return;
        if (b.owner && !store.isFriend(b.owner, p.key)) {
          if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sys', text: '🔒 Locked — this door only opens for its owner and their friends.' }));
          return;
        }
        broadcast({ t: 'build', op: 'fade', id: b.id });
      } else if (m.op === 'upgrade') {
        const b = builds.get(String(m.id));
        if (!b || b.tier !== 'wood' || b.kind === 'door') return;
        if (b.owner && !store.isFriend(b.owner, p.key)) return;
        b.tier = 'stone';
        b.hp = BUILD_HP.stone;
        worldDirty = true;
        broadcast({ t: 'build', op: 'upgrade', id: b.id, tier: 'stone', hp: b.hp });
      }
      break;
    }
    case 'friend': { // build/prop protection whitelist
      let list = null;
      if (m.op === 'add') list = store.addFriend(p.key, m.name);
      else if (m.op === 'del') list = store.delFriend(p.key, m.name);
      else list = store.getFriends(p.key);
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'friends', list: list || store.getFriends(p.key) }));
      break;
    }
    case 'burn': { // hall-of-records bookkeeping for the barrel
      stats.burns += Math.max(1, Math.min(99, Math.floor(Number(m.n) || 1)));
      worldDirty = true;
      break;
    }
    case 'hit': { // melee combat — fists and break-room weaponry
      const now = Date.now();
      if (now - (p.lastHitAt || 0) < 350) return;
      p.lastHitAt = now;
      const DMG = { fists: 6, paddle: 10, broom: 12, tapegun: 8, tube: 8, wrench: 15, banana: 4, axe: 14, pickaxe: 12, stoneaxe: 18, stonepick: 15, pistol: 20 };
      const weapon = m.item == null ? 'fists' : String(m.item);
      let dmg = DMG[weapon];
      if (!dmg) return;
      const hs = weapon === 'pistol' && m.hs === true;
      if (hs) dmg *= 2; // headshot
      const maxRange = weapon === 'pistol' ? 55 : 3.4;
      if (m.npc) { // hunting & zombie-slaying
        const n = npcs.get(Number(m.npc));
        if (!n) return;
        if (Math.hypot(p.x - n.x, p.z - n.z) > maxRange) return;
        n.hp -= dmg;
        if (n.hp > 0) { broadcast({ t: 'npc', op: 'hurt', id: n.id }); return; }
        npcs.delete(n.id);
        broadcast({ t: 'npc', op: 'del', id: n.id });
        const loot = n.kind === 'cow' ? [['food', 2]] : n.kind === 'chicken' ? [['food', 1]] : [['stone', 5], ['wood', 3]];
        for (const [item, cnt] of loot) {
          if (drops.size >= 200) break;
          const d = { id: 'd' + nextDropId++, item, n: cnt, x: clampX(+(n.x + (Math.random() - .5)).toFixed(2)), y: .35, z: clampZ(+(n.z + (Math.random() - .5)).toFixed(2)) };
          drops.set(d.id, d);
          broadcast({ t: 'drop', op: 'add', d });
        }
        worldDirty = true;
        if (n.kind === 'zombie') sys(`🧟 ${p.name} put down a zombie`);
        return;
      }
      const label = weapon === 'fists' ? 'their fists' : `a ${weapon}`;
      if (m.sleeper) { // sleepers are fair game — brutal, but this place remembers
        const key = String(m.sleeper);
        const s = sleepers.get(key);
        if (!s) return;
        if (Math.hypot(p.x - s.x, p.z - s.z) > maxRange) return;
        s.hp = (s.hp ?? 40) - dmg; // sleepers are fragile
        if (s.hp > 0) {
          worldDirty = true;
          broadcast({ t: 'sleephurt', key, by: p.id }); // red flash + hitmarker
          return;
        }
        sleepers.delete(key);
        spillInventory(key, s.x, s.z);
        stats.kills++;
        worldDirty = true;
        broadcast({ t: 'wake', key });
        sys(`💀 ${p.name} took out ${s.name} in their sleep with ${label}`);
        return;
      }
      const t = players.get(Number(m.target));
      if (!t || t.id === p.id) return;
      if (Math.hypot(p.x - t.x, p.z - t.z) > maxRange) return;
      t.hp = (t.hp ?? 100) - dmg;
      if (t.hp > 0) {
        broadcast({ t: 'hp', id: t.id, hp: t.hp, by: p.id, hs });
        return;
      }
      // death: everything they carried spills where they fell, then respawn
      killPlayer(t, p.name);
      sys(`💀 ${p.name} clocked ${t.name} with ${label} — their stuff hit the floor`);
      break;
    }
    case 'knock': { // decorative crash relay — no state, knockables respawn
      const kid = String(m.id || '').slice(0, 8);
      if (!/^k\d+$/.test(kid) || ![m.dx, m.dz].every(Number.isFinite)) return;
      stats.knocks++;
      worldDirty = true;
      broadcast({ t: 'knock', id: kid, dx: +m.dx.toFixed(2), dz: +m.dz.toFixed(2) }, p.id);
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
