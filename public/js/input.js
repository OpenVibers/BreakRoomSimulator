// Unified input: WASD + pointer lock on desktop, virtual joystick + drag-look on touch.
export const input = {
  keys: {},
  move: { x: 0, y: 0 },          // joystick vector (touch)
  lookDX: 0, lookDY: 0,          // accumulated look delta this frame
  jumpQueued: false,
  actionQueued: false,
  isTouch: false,
  locked: false,
  chatOpen: false,
  onAction: null,                // set by main
  onTap: null,                   // world tap (for board clicks on mobile)
};

export function initInput(canvas) {
  input.isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window
    || matchMedia('(any-pointer: coarse)').matches;
  if (input.isTouch) document.body.classList.add('touch');
  // safety net: any real touch enables the touch UI (covers missed detection),
  // and hybrid devices keep mouse look — clicks right after a touch are ignored
  addEventListener('touchstart', () => {
    input.lastTouch = Date.now();
    if (!input.isTouch) { input.isTouch = true; document.body.classList.add('touch'); }
  }, { passive: true, capture: true });

  // ---------- keyboard ----------
  addEventListener('keydown', (e) => {
    if (input.chatOpen) return;
    input.keys[e.code] = true;
    if (e.code === 'Space') { input.jumpQueued = true; e.preventDefault(); }
    if (e.code === 'KeyE') input.actionQueued = true;
  });
  addEventListener('keyup', (e) => { input.keys[e.code] = false; });

  // ---------- mouse (also active on hybrid touch devices) ----------
  canvas.addEventListener('click', (e) => {
    if (Date.now() - (input.lastTouch || 0) < 600 || input.chatOpen) return;
    if (!input.locked) canvas.requestPointerLock?.();
    else if (input.onTap) input.onTap(innerWidth / 2, innerHeight / 2); // crosshair click
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    document.getElementById('crosshair').classList.toggle('hidden', !input.locked);
  });
  addEventListener('mousemove', (e) => {
    if (input.locked) { input.lookDX += e.movementX; input.lookDY += e.movementY; }
  });

  // ---------- touch: joystick (left) + look (right) ----------
  const zone = document.getElementById('joystick-zone');
  const base = document.getElementById('joystick-base');
  const nub = document.getElementById('joystick-nub');
  let joyId = null, joyCX = 0, joyCY = 0;
  let lookId = null, lastLX = 0, lastLY = 0, lookMoved = 0;

  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    joyId = t.identifier; joyCX = t.clientX; joyCY = t.clientY;
    base.style.display = 'block';
    base.style.left = (joyCX - 55) + 'px';
    base.style.top = (joyCY - 55) + 'px';
    e.preventDefault();
  }, { passive: false });

  const joyMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
        const len = Math.hypot(dx, dy), max = 48;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        input.move.x = dx / max;
        input.move.y = dy / max;
        e.preventDefault();
      }
    }
  };
  zone.addEventListener('touchmove', joyMove, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        input.move.x = 0; input.move.y = 0;
        base.style.display = 'none';
        nub.style.transform = 'translate(-50%,-50%)';
      }
    }
  };
  zone.addEventListener('touchend', joyEnd);
  zone.addEventListener('touchcancel', joyEnd);

  // look: touches on canvas (right side)
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (lookId === null) {
        lookId = t.identifier; lastLX = t.clientX; lastLY = t.clientY; lookMoved = 0;
      }
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) {
        input.lookDX += (t.clientX - lastLX) * 2.2;
        input.lookDY += (t.clientY - lastLY) * 2.2;
        lookMoved += Math.abs(t.clientX - lastLX) + Math.abs(t.clientY - lastLY);
        lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) {
        if (lookMoved < 12 && input.onTap) input.onTap(t.clientX, t.clientY); // tap = click
        lookId = null;
      }
    }
  });

  // mobile buttons
  const bAction = document.getElementById('btn-action');
  const bJump = document.getElementById('btn-jump');
  const bCrouch = document.getElementById('btn-crouch');
  bAction.addEventListener('touchstart', (e) => { input.actionQueued = true; e.preventDefault(); }, { passive: false });
  bJump.addEventListener('touchstart', (e) => { input.jumpQueued = true; e.preventDefault(); }, { passive: false });
  bCrouch.addEventListener('touchstart', (e) => {
    input.crouchTouch = !input.crouchTouch;
    bCrouch.style.background = input.crouchTouch ? 'rgba(255,153,0,.85)' : '';
    e.preventDefault();
  }, { passive: false });
}

// desktop WASD vector
export function keyMove() {
  let x = 0, y = 0;
  if (input.keys.KeyW || input.keys.ArrowUp) y -= 1;
  if (input.keys.KeyS || input.keys.ArrowDown) y += 1;
  if (input.keys.KeyA || input.keys.ArrowLeft) x -= 1;
  if (input.keys.KeyD || input.keys.ArrowRight) x += 1;
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}
