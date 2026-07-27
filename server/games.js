// Server-authoritative mini-game state machines: giant Connect 4, chess, ping pong.
import { initialChessBoard, applyChessMove } from '../public/js/chess-rules.js';

// ---------- Giant Connect 4 (7 cols x 6 rows) ----------
export class Connect4 {
  constructor(id) {
    this.id = id;
    this.reset();
    this.seats = [null, null]; // [{key,name}] — 0 = red, 1 = yellow
  }
  reset() {
    this.board = Array.from({ length: 6 }, () => Array(7).fill(-1));
    this.turn = 0;
    this.winner = null; // 0 | 1 | 'draw'
    this.winLine = null;
  }
  sit(seat, player) {
    if (seat !== 0 && seat !== 1) return false;
    if (this.seats[seat] && this.seats[seat].key !== player.key) return false;
    // fresh players at a finished (or abandoned mid-game) board start clean
    if (this.winner !== null || (!this.seats[0] && !this.seats[1])) this.reset();
    this.leave(player.key);
    this.seats[seat] = { key: player.key, name: player.name };
    return true;
  }
  leave(key) {
    for (let i = 0; i < 2; i++) if (this.seats[i]?.key === key) this.seats[i] = null;
    if (!this.seats[0] && !this.seats[1]) this.reset();
  }
  drop(key, col) {
    if (this.winner !== null) return { error: 'over' };
    const seat = this.seats.findIndex(s => s?.key === key);
    if (seat === -1) return { error: 'not seated' };
    if (seat !== this.turn) return { error: 'not your turn' };
    if (!this.seats[0] || !this.seats[1]) return { error: 'need 2 players' };
    col = Math.floor(Number(col));
    if (!(col >= 0 && col < 7)) return { error: 'bad col' };
    let row = -1;
    for (let r = 5; r >= 0; r--) if (this.board[r][col] === -1) { row = r; break; }
    if (row === -1) return { error: 'column full' };
    this.board[row][col] = seat;
    this.checkWin(row, col, seat);
    if (this.winner === null && this.board[0].every(v => v !== -1) === false) this.turn = 1 - this.turn;
    if (this.winner === null && this.board.every(r => r.every(v => v !== -1))) this.winner = 'draw';
    return { ok: true, row, col, seat };
  }
  checkWin(r, c, seat) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [[r, c]];
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < 6 && cc >= 0 && cc < 7 && this.board[rr][cc] === seat) {
          line.push([rr, cc]); rr += dr * s; cc += dc * s;
        }
      }
      if (line.length >= 4) { this.winner = seat; this.winLine = line; return; }
    }
  }
  state() {
    return { id: this.id, board: this.board, seats: this.seats.map(s => s ? s.name : null), turn: this.turn, winner: this.winner, winLine: this.winLine };
  }
}

// ---------- Chess ----------
export class Chess {
  constructor() {
    this.reset();
    this.seats = [null, null]; // 0 = white, 1 = black
  }
  reset() {
    this.board = initialChessBoard();
    this.turn = 'w';
    this.winner = null;
    this.lastMove = null;
  }
  sit(seat, player) {
    if (seat !== 0 && seat !== 1) return false;
    if (this.seats[seat] && this.seats[seat].key !== player.key) return false;
    if (this.winner !== null || (!this.seats[0] && !this.seats[1])) this.reset();
    this.leave(player.key);
    this.seats[seat] = { key: player.key, name: player.name };
    return true;
  }
  leave(key) {
    for (let i = 0; i < 2; i++) if (this.seats[i]?.key === key) this.seats[i] = null;
    if (!this.seats[0] && !this.seats[1]) this.reset();
  }
  move(key, from, to) {
    if (this.winner) return { error: 'over' };
    const seat = this.seats.findIndex(s => s?.key === key);
    if (seat === -1) return { error: 'not seated' };
    if (!this.seats[0] || !this.seats[1]) return { error: 'need 2 players' };
    const color = seat === 0 ? 'w' : 'b';
    if (color !== this.turn) return { error: 'not your turn' };
    const res = applyChessMove(this.board, this.turn, from, to);
    if (!res.ok) return { error: 'illegal move' };
    this.lastMove = { from, to };
    if (res.winner) this.winner = seat;
    else this.turn = this.turn === 'w' ? 'b' : 'w';
    return { ok: true, winnerSeat: res.winner ? seat : null };
  }
  state() {
    return { board: this.board, seats: this.seats.map(s => s ? s.name : null), turn: this.turn, winner: this.winner, lastMove: this.lastMove };
  }
}

// ---------- Ping pong (timing-based rally) ----------
// Server fires a "ball" toward a side with a flight time; that side must send
// 'hit' within the return window or the other side scores. Solo = practice rally.
export class PongTable {
  constructor(id, events) {
    this.id = id;
    this.events = events;       // (type, data) => broadcast
    this.seats = [null, null];
    this.score = [0, 0];
    this.rally = 0;
    this.ballSide = null;       // side the ball is flying TO
    this.ballAt = 0;            // Date.now() when ball was hit
    this.flightMs = 0;
    this.timer = null;
    this.playing = false;
  }
  sit(side, player) {
    if (side !== 0 && side !== 1) return false;
    if (this.seats[side] && this.seats[side].key !== player.key) return false;
    this.leave(player.key, true);
    this.seats[side] = { key: player.key, name: player.name };
    this.score = [0, 0];
    this.startRally();
    return true;
  }
  leave(key, quiet) {
    let left = false;
    for (let i = 0; i < 2; i++) if (this.seats[i]?.key === key) { this.seats[i] = null; left = true; }
    if (left) {
      this.stopBall();
      this.score = [0, 0];
      this.playing = false;
      if (!quiet && (this.seats[0] || this.seats[1])) this.startRally();
    }
    return left;
  }
  occupied() { return this.seats[0] || this.seats[1]; }
  startRally() {
    this.stopBall();
    if (!this.occupied()) return;
    this.playing = true;
    this.rally = 0;
    const server = this.seats[0] ? 0 : 1;
    setTimeout(() => this.launch(1 - (this.seats[0] && this.seats[1] ? server : -10)), 100);
    // launch toward the opponent; solo mode handled in launch()
  }
  launch(toSide) {
    if (!this.occupied()) return;
    // Solo practice: ball always comes back to the occupied side.
    if (!this.seats[0] || !this.seats[1]) toSide = this.seats[0] ? 0 : 1;
    if (toSide !== 0 && toSide !== 1) toSide = this.seats[0] ? 0 : 1;
    this.ballSide = toSide;
    this.ballAt = Date.now();
    this.flightMs = Math.max(650, 1250 - this.rally * 45) + Math.floor(Math.random() * 250);
    this.events('ball', { id: this.id, side: toSide, flightMs: this.flightMs, rally: this.rally });
    this.timer = setTimeout(() => this.missed(toSide), this.flightMs + 420);
  }
  hit(key) {
    const side = this.seats.findIndex(s => s?.key === key);
    if (side === -1 || this.ballSide !== side) return;
    const dt = Date.now() - this.ballAt;
    // generous timing window around ball arrival
    if (dt < this.flightMs - 380) {
      this.events('whiff', { id: this.id, side });
      return;
    }
    this.rally++;
    this.stopBall();
    this.events('return', { id: this.id, side, rally: this.rally });
    this.launch(1 - side);
  }
  missed(side) {
    this.stopBall();
    const both = this.seats[0] && this.seats[1];
    if (both) {
      const scorer = 1 - side;
      this.score[scorer]++;
      this.events('point', { id: this.id, scorer, score: this.score, rally: this.rally });
      if (this.score[scorer] >= 7) {
        this.events('gameover', { id: this.id, winner: scorer, winnerName: this.seats[scorer]?.name, score: this.score });
        this.score = [0, 0];
        setTimeout(() => this.startRally(), 2500);
      } else {
        setTimeout(() => { this.rally = 0; this.launch(side); }, 1400);
      }
    } else {
      this.events('miss-solo', { id: this.id, side, rally: this.rally });
      setTimeout(() => { this.rally = 0; this.launch(side); }, 1200);
    }
  }
  stopBall() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ballSide = null;
  }
  state() {
    return { id: this.id, seats: this.seats.map(s => s ? s.name : null), score: this.score, playing: this.playing };
  }
}
