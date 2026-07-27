// Shared chess rules (server + client). Casual break-room chess:
// pseudo-legal moves, no check/checkmate detection — capture the king to win.
// No castling / en passant (auto-queen promotion). House rules, like on a lunch break.

export function initialChessBoard() {
  const e = null;
  return [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [e,e,e,e,e,e,e,e],
    [e,e,e,e,e,e,e,e],
    [e,e,e,e,e,e,e,e],
    [e,e,e,e,e,e,e,e],
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR'],
  ];
}

const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

// Returns list of [r,c] destination squares for the piece at (r,c).
export function chessMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const color = p[0], kind = p[1];
  const moves = [];
  const push = (rr, cc) => {
    if (!inB(rr, cc)) return false;
    const t = board[rr][cc];
    if (!t) { moves.push([rr, cc]); return true; }
    if (t[0] !== color) moves.push([rr, cc]);
    return false; // blocked
  };
  const ray = (dr, dc) => {
    let rr = r + dr, cc = c + dc;
    while (push(rr, cc)) { rr += dr; cc += dc; }
  };
  if (kind === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const start = color === 'w' ? 6 : 1;
    if (inB(r + dir, c) && !board[r + dir][c]) {
      moves.push([r + dir, c]);
      if (r === start && !board[r + 2 * dir][c]) moves.push([r + 2 * dir, c]);
    }
    for (const dc of [-1, 1]) {
      const rr = r + dir, cc = c + dc;
      if (inB(rr, cc) && board[rr][cc] && board[rr][cc][0] !== color) moves.push([rr, cc]);
    }
  } else if (kind === 'N') {
    for (const [dr, dc] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) push(r + dr, c + dc);
  } else if (kind === 'B') { ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); }
  else if (kind === 'R') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
  else if (kind === 'Q') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); }
  else if (kind === 'K') {
    for (const dr of [-1,0,1]) for (const dc of [-1,0,1]) if (dr || dc) push(r + dr, c + dc);
  }
  return moves;
}

// Validates and applies a move in place. Returns {ok, captured, winner} — winner set when a king is captured.
export function applyChessMove(board, turn, from, to) {
  const [fr, fc] = from, [tr, tc] = to;
  if (!inB(fr, fc) || !inB(tr, tc)) return { ok: false };
  const p = board[fr][fc];
  if (!p || p[0] !== turn) return { ok: false };
  if (!chessMoves(board, fr, fc).some(([r, c]) => r === tr && c === tc)) return { ok: false };
  const captured = board[tr][tc];
  board[tr][tc] = p;
  board[fr][fc] = null;
  if (p[1] === 'P' && (tr === 0 || tr === 7)) board[tr][tc] = p[0] + 'Q';
  let winner = null;
  if (captured && captured[1] === 'K') winner = turn;
  return { ok: true, captured, winner };
}
