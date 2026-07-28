// Client side of the mini-games: giant Connect 4, chess, ping pong timing rallies,
// and the PRIME BREAKER arcade cabinet (breakout) with server-synced highscores.
import * as THREE from 'three';
import { net } from './net.js';
import { chessMoves } from './chess-rules.js';
import { uiFocus } from './input.js';

// ---------- tiny synth ----------
let actx = null;
export function beep(freq = 660, dur = .07, type = 'square', vol = .12) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch {}
}

export function initMinigames(W, me, toast) {
  const mg = {
    c4: { a: null, b: null },
    chess: null,
    pong: { a: null, b: null },
    highscores: [],
    myPongTable: null, myPongSide: null,
    ballAnim: { a: null, b: null },
    ringState: null,   // {t0, flightMs}
    chessSel: null,
    focus: null,
    winPulse: [],
    chessPieces: [],
    chessMarks: [],
  };

  const boardUI = document.getElementById('board-ui');
  const boardStatus = document.getElementById('board-status');
  const boardButtons = document.getElementById('board-buttons');
  const pongUI = document.getElementById('pong-ui');
  const pongScore = document.getElementById('pong-score');
  const ringFill = document.getElementById('pong-ring-fill');

  // ================= CONNECT 4 =================
  function renderC4(id) {
    const s = mg.c4[id];
    const a = W.anchors[`c4-${id}`];
    if (!s || !a) return;
    let di = 0;
    mg.winPulse = mg.winPulse.filter(p => p.board !== id);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      const v = s.board[r][c];
      if (v === -1) continue;
      const d = a.discs[di++];
      d.visible = true;
      d.material = v === 0 ? a.discRed : a.discYel;
      // matches the punched-hole grid of the plate texture (256x220 → 1.9x1.45 plane)
      d.position.set(-.8016 + c * .2672, 1.02 + .6064 - r * .2043, 0);
      d.scale.setScalar(1);
      if (s.winLine?.some(([wr, wc]) => wr === r && wc === c)) mg.winPulse.push({ board: id, mesh: d, t: 0 });
    }
    for (; di < 42; di++) a.discs[di].visible = false;
  }

  net.on('c4', (m) => {
    const prev = mg.c4[m.s.id];
    const prevCount = prev ? prev.board.flat().filter(v => v !== -1).length : 0;
    const newCount = m.s.board.flat().filter(v => v !== -1).length;
    mg.c4[m.s.id] = m.s;
    if (newCount > prevCount) beep(240, .12, 'sine', .2);
    if (m.s.winner === 0 || m.s.winner === 1) beep(880, .3, 'triangle', .15);
    renderC4(m.s.id);
    refreshPanel();
  });

  // ================= CHESS =================
  const whiteM = new THREE.MeshStandardMaterial({ color: 0xe8ddc8, roughness: .5 });
  const blackM = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: .5 });
  function pieceMesh(code) {
    const color = code[0] === 'w' ? whiteM : blackM;
    const kind = code[1];
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.028, .034, .015, 10), color);
    g.add(base);
    if (kind === 'P') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(.02, 8, 6), color).translateY(.045));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.012, .024, .04, 8), color).translateY(.02));
    } else if (kind === 'R') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.024, .028, .07, 8), color).translateY(.04));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(.055, .018, .055), color).translateY(.08));
    } else if (kind === 'N') {
      const h = new THREE.Mesh(new THREE.BoxGeometry(.03, .06, .045), color);
      h.position.y = .055; h.rotation.x = -.5;
      g.add(h);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.018, .026, .05, 8), color).translateY(.025));
    } else if (kind === 'B') {
      g.add(new THREE.Mesh(new THREE.ConeGeometry(.026, .085, 10), color).translateY(.05));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(.011, 8, 6), color).translateY(.1));
    } else if (kind === 'Q') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.02, .032, .08, 10), color).translateY(.045));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(.022, 10, 8), color).translateY(.1));
    } else { // K
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.02, .032, .09, 10), color).translateY(.05));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(.012, .035, .012), color).translateY(.12));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(.03, .012, .012), color).translateY(.115));
    }
    return g;
  }
  const selM = new THREE.MeshBasicMaterial({ color: 0x37e06f, transparent: true, opacity: .55 });
  const dotM = new THREE.MeshBasicMaterial({ color: 0x37e06f, transparent: true, opacity: .8 });
  const lastM = new THREE.MeshBasicMaterial({ color: 0xf2c521, transparent: true, opacity: .4 });

  function chessWorldPos(r, c) {
    const a = W.anchors.chess;
    return [a.x + (3.5 - r) * a.cell, a.y, a.z + (c - 3.5) * a.cell];
  }
  function renderChess() {
    const s = mg.chess;
    const a = W.anchors.chess;
    if (!s || !a) return;
    for (const p of mg.chessPieces) a.group.remove(p);
    for (const p of mg.chessMarks) a.group.remove(p);
    mg.chessPieces = []; mg.chessMarks = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const code = s.board[r][c];
      if (!code) continue;
      const m = pieceMesh(code);
      const [x, y, z] = chessWorldPos(r, c);
      m.position.set(x, y, z);
      a.group.add(m);
      mg.chessPieces.push(m);
    }
    const marks = [];
    if (s.lastMove) marks.push([s.lastMove.from, lastM], [s.lastMove.to, lastM]);
    if (mg.chessSel) {
      marks.push([mg.chessSel, selM]);
      for (const mv of chessMoves(s.board, mg.chessSel[0], mg.chessSel[1])) marks.push([mv, dotM]);
    }
    for (const [[r, c], mat] of marks) {
      const mk = new THREE.Mesh(new THREE.BoxGeometry(.085, .004, .085), mat);
      const [x, y, z] = chessWorldPos(r, c);
      mk.position.set(x, y - .003, z);
      a.group.add(mk);
      mg.chessMarks.push(mk);
    }
  }
  net.on('chess', (m) => {
    const hadMove = mg.chess && JSON.stringify(mg.chess.lastMove) !== JSON.stringify(m.s.lastMove);
    mg.chess = m.s;
    if (mg.chessSel && (!m.s.board[mg.chessSel[0]][mg.chessSel[1]] || m.s.board[mg.chessSel[0]][mg.chessSel[1]][0] !== myChessColor())) mg.chessSel = null;
    if (hadMove) beep(500, .06, 'sine', .12);
    renderChess();
    refreshPanel();
  });
  function myChessSeat() { return mg.chess ? mg.chess.seats.findIndex(n => n === me.name) : -1; }
  function myChessColor() { const s = myChessSeat(); return s === 0 ? 'w' : s === 1 ? 'b' : null; }

  // ================= PONG =================
  net.on('pong', (m) => {
    mg.pong[m.s.id] = m.s;
    const mySide = m.s.seats.findIndex(n => n === me.name);
    if (mySide !== -1) { mg.myPongTable = m.s.id; mg.myPongSide = mySide; }
    else if (mg.myPongTable === m.s.id) { mg.myPongTable = null; mg.myPongSide = null; mg.ringState = null; }
    refreshPong();
  });
  net.on('pongev', (m) => {
    const a = W.anchors[`pong-${m.id}`];
    if (!a) return;
    if (m.ev === 'ball') {
      const to = a.ends[m.side], from = a.ends[1 - m.side];
      mg.ballAnim[m.id] = { from, to, t0: performance.now(), flightMs: m.flightMs };
      a.ball.visible = true;
      if (mg.myPongTable === m.id && mg.myPongSide === m.side) {
        mg.ringState = { t0: performance.now(), flightMs: m.flightMs };
        beep(760, .05, 'sine', .1);
      }
    } else if (m.ev === 'return') {
      beep(880 + Math.random() * 200, .04, 'square', .14);
    } else if (m.ev === 'point' || m.ev === 'miss-solo') {
      mg.ballAnim[m.id] = null;
      a.ball.visible = false;
      if (mg.myPongTable === m.id) {
        mg.ringState = null;
        beep(220, .25, 'sawtooth', .12);
      }
      if (m.ev === 'point') { const s = mg.pong[m.id]; if (s) { s.score = m.score; refreshPong(); } }
    } else if (m.ev === 'gameover') {
      mg.ballAnim[m.id] = null;
      a.ball.visible = false;
      if (mg.myPongTable === m.id) toast(m.winnerName === me.name ? '🏆 You win the match!' : `${m.winnerName} wins the match`);
    } else if (m.ev === 'whiff') {
      if (mg.myPongTable === m.id && mg.myPongSide === m.side) beep(160, .08, 'square', .1);
    }
  });
  function refreshPong() {
    const t = mg.myPongTable;
    if (!t) { pongUI.classList.add('hidden'); return; }
    const s = mg.pong[t];
    pongUI.classList.remove('hidden');
    const opp = s.seats[1 - mg.myPongSide];
    pongScore.textContent = opp
      ? `You ${s.score[mg.myPongSide]} — ${s.score[1 - mg.myPongSide]} ${opp} (first to 7)`
      : 'Practice rally — waiting for an opponent…';
  }
  function swing() { if (mg.myPongTable) { net.send({ t: 'pong', id: mg.myPongTable, op: 'hit' }); } }
  document.getElementById('btn-swing').addEventListener('click', swing);
  document.getElementById('btn-pong-leave').addEventListener('click', () => {
    if (mg.myPongTable) net.send({ t: 'pong', id: mg.myPongTable, op: 'leave' });
  });

  // ================= panel (c4 / chess) =================
  function btn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    boardButtons.appendChild(b);
  }
  function refreshPanel() {
    boardButtons.innerHTML = '';
    const f = mg.focus;
    if (!f) { boardUI.classList.add('hidden'); return; }
    if (f.type === 'c4') {
      const id = f.data.board, s = mg.c4[id];
      if (!s) { boardUI.classList.add('hidden'); return; }
      boardUI.classList.remove('hidden');
      const mySeat = s.seats.findIndex(n => n === me.name);
      let status;
      if (s.winner === 'draw') status = '🤝 Draw!';
      else if (s.winner !== null) status = `🎉 ${s.seats[s.winner] || (s.winner === 0 ? 'Red' : 'Yellow')} wins!`;
      else if (!s.seats[0] || !s.seats[1]) status = `Giant Connect 4 — ${s.seats[0] ? s.seats[0] + ' (red) waits' : s.seats[1] ? s.seats[1] + ' (yellow) waits' : 'open table'}`;
      else status = `${s.seats[s.turn]} (${s.turn === 0 ? '🔴 red' : '🟡 yellow'}) to drop`;
      if (mySeat !== -1 && s.winner === null && s.seats[0] && s.seats[1] && s.turn === mySeat) status += ' — your move! Click a column';
      boardStatus.textContent = status;
      if (mySeat === -1) {
        if (!s.seats[0]) btn('Play as 🔴 Red', () => net.send({ t: 'c4', id, op: 'seat', seat: 0 }));
        if (!s.seats[1]) btn('Play as 🟡 Yellow', () => net.send({ t: 'c4', id, op: 'seat', seat: 1 }));
      } else {
        if (s.winner !== null) btn('Rematch', () => net.send({ t: 'c4', id, op: 'reset' }));
        btn('Stand up', () => net.send({ t: 'c4', id, op: 'leave' }));
      }
    } else if (f.type === 'chess') {
      const s = mg.chess;
      if (!s) { boardUI.classList.add('hidden'); return; }
      boardUI.classList.remove('hidden');
      const mySeat = myChessSeat();
      let status;
      if (s.winner !== null && s.winner !== undefined) status = `♛ ${s.seats[s.winner]} captured the king!`;
      else if (!s.seats[0] || !s.seats[1]) status = `Chess — ${s.seats[0] ? s.seats[0] + ' (white) waits' : s.seats[1] ? s.seats[1] + ' (black) waits' : 'board open'}`;
      else status = `${s.turn === 'w' ? '⚪ ' + s.seats[0] : '⚫ ' + s.seats[1]} to move`;
      if (mySeat !== -1 && ((mySeat === 0 && s.turn === 'w') || (mySeat === 1 && s.turn === 'b')) && s.seats[0] && s.seats[1] && s.winner == null) status += ' — your move! Tap a piece';
      boardStatus.textContent = status;
      if (mySeat === -1) {
        if (!s.seats[0]) btn('Play ⚪ White', () => net.send({ t: 'chess', op: 'seat', seat: 0 }));
        if (!s.seats[1]) btn('Play ⚫ Black', () => net.send({ t: 'chess', op: 'seat', seat: 1 }));
      } else {
        if (s.winner != null) btn('Rematch', () => net.send({ t: 'chess', op: 'reset' }));
        btn('Stand up', () => { net.send({ t: 'chess', op: 'leave' }); mg.chessSel = null; renderChess(); });
      }
    } else {
      boardUI.classList.add('hidden');
    }
  }

  // ================= ARCADE (breakout) =================
  const arcadeUI = document.getElementById('arcade-ui');
  const ac = document.getElementById('arcade-canvas');
  const actxt = ac.getContext('2d');
  let arcade = null;
  function openArcade() {
    arcadeUI.classList.remove('hidden');
    uiFocus('arcade', true); // free the mouse — the paddle tracks the cursor
    arcade = {
      px: 150, pw: 64, bx: 180, by: 380, vx: 2.6, vy: -3.6,
      bricks: [], score: 0, lives: 3, over: false, started: false, t: 0,
    };
    const cols = ['#f2c521', '#e2262d', '#2a9134', '#1c9ee8', '#8c4fd1', '#f26f21'];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++)
      arcade.bricks.push({ x: 14 + c * 42, y: 50 + r * 22, alive: true, col: cols[r] });
    loopArcade();
  }
  function closeArcade(submit = true) {
    if (arcade && submit && arcade.score > 0) net.send({ t: 'arcade', score: arcade.score });
    arcade = null;
    arcadeUI.classList.add('hidden');
    uiFocus('arcade', false);
  }
  document.getElementById('btn-arcade-quit').addEventListener('click', () => closeArcade(true));
  addEventListener('keydown', (e) => { if (arcade && e.code === 'Escape') closeArcade(true); });
  // paddle input
  addEventListener('mousemove', (e) => {
    if (!arcade) return;
    const r = ac.getBoundingClientRect();
    arcade.px = ((e.clientX - r.left) / r.width) * 360 - arcade.pw / 2;
  });
  ac.addEventListener('touchmove', (e) => {
    if (!arcade) return;
    const r = ac.getBoundingClientRect();
    arcade.px = ((e.touches[0].clientX - r.left) / r.width) * 360 - arcade.pw / 2;
    e.preventDefault();
  }, { passive: false });
  function loopArcade() {
    if (!arcade) return;
    const a = arcade;
    a.t++;
    if (a.keys) {} // reserved
    if (!a.over) {
      // keyboard
      if (window.__mgKeys?.ArrowLeft) a.px -= 6;
      if (window.__mgKeys?.ArrowRight) a.px += 6;
      a.px = Math.max(0, Math.min(360 - a.pw, a.px));
      a.bx += a.vx; a.by += a.vy;
      if (a.bx < 8 || a.bx > 352) { a.vx *= -1; beep(300, .03, 'square', .06); }
      if (a.by < 8) { a.vy *= -1; beep(300, .03, 'square', .06); }
      if (a.by > 384 && a.by < 396 && a.bx > a.px && a.bx < a.px + a.pw && a.vy > 0) {
        a.vy = -Math.abs(a.vy) - .05;
        a.vx += ((a.bx - (a.px + a.pw / 2)) / a.pw) * 3.2;
        a.vx = Math.max(-4.5, Math.min(4.5, a.vx));
        beep(520, .04, 'square', .08);
      }
      if (a.by > 480) {
        a.lives--;
        beep(140, .3, 'sawtooth', .12);
        if (a.lives <= 0) { a.over = true; net.send({ t: 'arcade', score: a.score }); }
        else { a.bx = 180; a.by = 380; a.vx = 2.6; a.vy = -3.6; }
      }
      for (const b of a.bricks) {
        if (!b.alive) continue;
        if (a.bx > b.x - 4 && a.bx < b.x + 40 && a.by > b.y - 4 && a.by < b.y + 18) {
          b.alive = false; a.vy *= -1; a.score += 10;
          beep(700 + Math.random() * 300, .05, 'triangle', .1);
          break;
        }
      }
      if (a.bricks.every(b => !b.alive)) {
        a.score += 200;
        a.bricks.forEach(b => b.alive = true);
        a.vx *= 1.15; a.vy *= 1.15;
        beep(1000, .3, 'triangle', .12);
      }
    }
    // draw
    const g = actxt;
    g.fillStyle = '#000'; g.fillRect(0, 0, 360, 480);
    g.fillStyle = '#222'; g.fillRect(0, 0, 360, 4);
    for (const b of a.bricks) {
      if (!b.alive) continue;
      g.fillStyle = b.col; g.fillRect(b.x, b.y, 36, 14);
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(b.x, b.y, 36, 3);
    }
    g.fillStyle = '#eee'; g.fillRect(a.px, 388, a.pw, 8);
    g.beginPath(); g.arc(a.bx, a.by, 6, 0, 7); g.fillStyle = '#ffde3b'; g.fill();
    g.fillStyle = '#ffde3b'; g.font = '16px "Courier New", monospace';
    g.fillText(`SCORE ${a.score}`, 10, 24);
    g.fillText(`LIVES ${a.lives}`, 270, 24);
    if (a.over) {
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, 180, 360, 120);
      g.fillStyle = '#e2262d'; g.font = '900 34px "Courier New", monospace'; g.textAlign = 'center';
      g.fillText('GAME OVER', 180, 230);
      g.fillStyle = '#ffde3b'; g.font = '18px "Courier New", monospace';
      g.fillText(`FINAL SCORE: ${a.score}`, 180, 262);
      g.textAlign = 'left';
    }
    requestAnimationFrame(loopArcade);
  }
  window.__mgKeys = {};
  addEventListener('keydown', (e) => { window.__mgKeys[e.code] = true; });
  addEventListener('keyup', (e) => { window.__mgKeys[e.code] = false; });

  // in-world arcade screen shows highscores
  function drawArcadeScreen() {
    const tex = W.anchors.arcadeScreen;
    if (!tex) return;
    const g = tex.ctx;
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffde3b'; g.font = '900 24px "Courier New", monospace'; g.textAlign = 'center';
    g.fillText('PRIME', 128, 36); g.fillText('BREAKER', 128, 62);
    g.fillStyle = '#e2262d'; g.font = '14px "Courier New", monospace';
    g.fillText('— HIGH SCORES —', 128, 92);
    g.fillStyle = '#3ae';
    mg.highscores.slice(0, 5).forEach((h, i) => {
      g.fillText(`${i + 1}. ${h.name.slice(0, 10).padEnd(10)} ${h.score}`, 128, 118 + i * 22);
    });
    if (!mg.highscores.length) g.fillText('NO SCORES YET', 128, 130);
    if (Math.floor(performance.now() / 700) % 2) {
      g.fillStyle = '#fff'; g.fillText('PRESS E TO PLAY', 128, 240);
    }
    tex.needsUpdate = true;
  }
  net.on('hs', (m) => { mg.highscores = m.highscores; });

  // ================= wiring =================
  mg.applyInit = (d) => {
    mg.c4.a = d.c4.a; mg.c4.b = d.c4.b;
    mg.chess = d.chess;
    mg.pong.a = d.pong.a; mg.pong.b = d.pong.b;
    mg.highscores = d.highscores || [];
    const mySideA = d.pong.a.seats.findIndex(n => n === me.name);
    const mySideB = d.pong.b.seats.findIndex(n => n === me.name);
    if (mySideA !== -1) { mg.myPongTable = 'a'; mg.myPongSide = mySideA; }
    if (mySideB !== -1) { mg.myPongTable = 'b'; mg.myPongSide = mySideB; }
    renderC4('a'); renderC4('b'); renderChess(); refreshPong();
  };

  mg.setFocus = (interactable) => {
    const changed = interactable?.id !== mg.focus?.id;
    mg.focus = interactable;
    if (changed) refreshPanel();
  };

  // world click/tap with raycaster — returns true if consumed
  mg.worldClick = (raycaster) => {
    // connect 4 columns
    for (const id of ['a', 'b']) {
      const s = mg.c4[id];
      if (!s) continue;
      const mySeat = s.seats.findIndex(n => n === me.name);
      if (mySeat === -1) continue;
      const hits = raycaster.intersectObjects(W.pick.c4[id], false);
      if (hits.length) {
        net.send({ t: 'c4', id, op: 'drop', col: hits[0].object.userData.col });
        return true;
      }
    }
    // chess squares
    if (mg.chess && myChessSeat() !== -1) {
      const hits = raycaster.intersectObjects(W.pick.chess, false);
      if (hits.length) {
        const { r, c } = hits[0].object.userData;
        const color = myChessColor();
        const piece = mg.chess.board[r][c];
        if (mg.chessSel) {
          if (piece && piece[0] === color) mg.chessSel = [r, c];
          else {
            net.send({ t: 'chess', op: 'move', from: mg.chessSel, to: [r, c] });
            mg.chessSel = null;
          }
        } else if (piece && piece[0] === color) {
          mg.chessSel = [r, c];
        }
        renderChess();
        return true;
      }
    }
    return false;
  };

  mg.interact = (f) => {
    if (!f) return;
    if (f.type === 'pong') {
      if (mg.myPongTable) { swing(); return; }
      const s = mg.pong[f.data.table];
      if (s && s.seats[f.data.side]) { toast(`${s.seats[f.data.side]} is using this side`); return; }
      net.send({ t: 'pong', id: f.data.table, op: 'seat', side: f.data.side });
    } else if (f.type === 'arcade') {
      openArcade();
    } else if (f.type === 'c4') {
      const s = mg.c4[f.data.board];
      if (s && s.seats.findIndex(n => n === me.name) === -1) {
        const seat = !s.seats[0] ? 0 : !s.seats[1] ? 1 : -1;
        if (seat !== -1) net.send({ t: 'c4', id: f.data.board, op: 'seat', seat });
      }
    } else if (f.type === 'chess') {
      const s = mg.chess;
      if (s && myChessSeat() === -1) {
        const seat = !s.seats[0] ? 0 : !s.seats[1] ? 1 : -1;
        if (seat !== -1) net.send({ t: 'chess', op: 'seat', seat });
      }
    }
  };
  mg.swing = swing;
  mg.inArcade = () => !!arcade;
  mg.closeArcade = closeArcade;

  // per-frame updates: ball flight, ring, win pulse, arcade screen
  let screenTimer = 0;
  mg.update = (dt) => {
    for (const id of ['a', 'b']) {
      const anim = mg.ballAnim[id];
      const a = W.anchors[`pong-${id}`];
      if (anim && a) {
        const t = Math.min(1, (performance.now() - anim.t0) / anim.flightMs);
        a.ball.position.x = anim.from.x + (anim.to.x - anim.from.x) * t;
        a.ball.position.z = anim.from.z + (anim.to.z - anim.from.z) * t + Math.sin(t * Math.PI * 2) * .12;
        // two-bounce arc: up, bounce near net, up, down to paddle
        const arc = Math.abs(Math.sin(t * Math.PI * 1.85));
        a.ball.position.y = .82 + arc * .42;
      }
    }
    if (mg.ringState) {
      const el = performance.now() - mg.ringState.t0;
      const f = mg.ringState.flightMs;
      ringFill.className = el > f - 380 ? (el > f + 420 ? '' : 'now') : 'incoming';
      const pct = Math.min(1, el / f);
      ringFill.style.transform = `scale(${1.6 - pct * .6})`;
      ringFill.style.opacity = .4 + pct * .6;
    } else {
      ringFill.className = '';
      ringFill.style.transform = 'scale(1)';
      ringFill.style.opacity = .35;
    }
    for (const p of mg.winPulse) {
      p.t += dt * 5;
      p.mesh.scale.setScalar(1 + Math.sin(p.t) * .18);
    }
    screenTimer += dt;
    if (screenTimer > .7) { screenTimer = 0; drawArcadeScreen(); }
  };

  return mg;
}
