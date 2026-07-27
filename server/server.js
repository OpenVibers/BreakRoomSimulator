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
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', setHeaders: (res, p) => { if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'play.html')));

app.post('/api/register', (req, res) => res.json(store.register(req.body.name, req.body.pass)));
app.post('/api/login', (req, res) => res.json(store.login(req.body.name, req.body.pass)));
app.post('/api/guest', (req, res) => res.json(store.guest()));

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
    id, key: user.key, name: user.name, vest: user.vest, admin: user.admin, ap: user.ap, ws,
    x: 105 + Math.random() * 3, y: 0, z: -1 + Math.random() * 2, ry: -Math.PI / 2,
    anim: 'idle', seat: null, held: null, lastChat: 0,
  };
  players.set(id, p);

  ws.send(JSON.stringify({
    t: 'init', id, you: pubState(p), guest: user.guest, admin: user.admin,
    mapEdits,
    players: [...players.values()].filter(q => q.id !== id).map(pubState),
    c4: { a: c4.a.state(), b: c4.b.state() },
    chess: chess.state(),
    pong: { a: pong.a.state(), b: pong.b.state() },
    highscores: store.getHighscores(),
    cars,
    online: players.size,
  }));
  broadcast({ t: 'pj', p: pubState(p), online: players.size }, id);
  sys(`👋 ${p.name} walked into the break room (${players.size} online)`);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { handle(p, m); } catch (e) { console.error('msg error', e); }
  });

  ws.on('close', () => {
    players.delete(id);
    for (const [cid, c] of Object.entries(cars)) {
      if (c.driver === id) { c.driver = null; broadcast({ t: 'car', id: cid, op: 'exit', x: c.x, z: c.z, ry: c.ry }); }
    }
    for (const g of [c4.a, c4.b]) { g.leave(p.key); broadcast({ t: 'c4', s: g.state() }); }
    chess.leave(p.key); broadcast({ t: 'chess', s: chess.state() });
    for (const t of [pong.a, pong.b]) if (t.leave(p.key)) broadcast({ t: 'pong', s: t.state() });
    broadcast({ t: 'pl', id, online: players.size });
    sys(`🚪 ${p.name} went back to work`);
  });
});

function handle(p, m) {
  switch (m.t) {
    case 'p': { // position update [x,y,z,ry,anim]
      const [x, y, z, ry, anim] = m.d || [];
      if (![x, y, z, ry].every(Number.isFinite)) return;
      p.x = Math.max(-78, Math.min(118, x));
      p.y = Math.max(0, Math.min(8, y));
      p.z = Math.max(-58, Math.min(112, z));
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
      if (!/^car\d+$/.test(id)) return;
      const c = cars[id] || (cars[id] = { x: null, z: null, ry: 0, driver: null });
      if (m.op === 'enter') {
        if (c.driver && c.driver !== p.id) return;
        c.driver = p.id;
        broadcast({ t: 'car', id, op: 'enter', driver: p.id });
        sys(`🚗 ${p.name} got into a car`);
      } else if (m.op === 'exit') {
        if (c.driver !== p.id) return;
        c.driver = null;
        broadcast({ t: 'car', id, op: 'exit', x: c.x, z: c.z, ry: c.ry });
      } else if (m.op === 'state') {
        if (c.driver !== p.id) return;
        if (![m.x, m.z, m.ry].every(Number.isFinite)) return;
        c.x = Math.max(-78, Math.min(120, m.x));
        c.z = Math.max(-58, Math.min(112, m.z));
        c.ry = m.ry;
        broadcast({ t: 'car', id, op: 'state', x: c.x, z: c.z, ry: c.ry, driver: p.id }, p.id);
      }
      break;
    }
    case 'gate': // badge-gate animation relay so everyone sees paddles open
      broadcast({ t: 'gate', id: String(m.id || '').slice(0, 20) });
      break;
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
