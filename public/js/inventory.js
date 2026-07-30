// Inventory + hotbar: 24-slot grid, 6-slot hotbar, drag & drop (mouse + touch),
// number keys to select, consumables / melee props / clothes. Persists via server.
import { net } from './net.js';
import { beep } from './minigames.js';
import { uiFocus } from './input.js';

export const ITEMS = {
  chips:   { name: 'Chips',        icon: '🍟', type: 'food' },
  soda:    { name: 'Soda',         icon: '🥤', type: 'food' },
  candy:   { name: 'Candy',        icon: '🍬', type: 'food' },
  coffee:  { name: 'Coffee',       icon: '☕', type: 'food' },
  energy:  { name: 'Energy drink', icon: '⚡', type: 'food' },
  water:   { name: 'Ice water',    icon: '💧', type: 'food' },
  food:    { name: 'Sandwich',     icon: '🥪', type: 'food' },
  paddle:  { name: 'Ping pong paddle', icon: '🏓', type: 'melee' },
  broom:   { name: 'Broom',        icon: '🧹', type: 'melee' },
  tapegun: { name: 'Tape gun',     icon: '📼', type: 'melee' },
  tube:    { name: 'Cardboard tube', icon: '📦', type: 'melee' },
  wrench:  { name: 'Wrench',       icon: '🔧', type: 'melee' },
  banana:  { name: 'Banana',       icon: '🍌', type: 'melee' },
  physgun: { name: 'Physgun',      icon: '🧲', type: 'tool' },
  flashlight: { name: 'Flashlight', icon: '🔦', type: 'tool' },
  wood:      { name: 'Wood',        icon: '🪵', type: 'mat' },
  stone:     { name: 'Stone',       icon: '🪨', type: 'mat' },
  axe:       { name: 'Axe',         icon: '🪓', type: 'melee' },
  pickaxe:   { name: 'Pickaxe',     icon: '⛏️', type: 'melee' },
  stoneaxe:  { name: 'Stone axe',   icon: '🪓', type: 'melee' },
  stonepick: { name: 'Stone pickaxe', icon: '⛏️', type: 'melee' },
  pistol:    { name: 'Pistol',      icon: '🔫', type: 'gun' },
  wall:      { name: 'Wood wall',   icon: '🧱', type: 'build' },
  floor:     { name: 'Wood floor',  icon: '🟫', type: 'build' },
  door:      { name: 'Fading door', icon: '🚪', type: 'build' },
  box:       { name: 'Amazon box',  icon: '📦', type: 'prop' },
  crate:     { name: 'Wood crate',  icon: '🪵', type: 'prop' },
  ball:      { name: 'Kickball',    icon: '🔴', type: 'prop' },
  barrel:    { name: 'Barrel',      icon: '🛢️', type: 'prop' },
  melon:     { name: 'Watermelon',  icon: '🍉', type: 'prop' },
  cone:      { name: 'Traffic cone', icon: '🚧', type: 'prop' },
  'hat-cap':     { name: 'Cap',      icon: '🧢', type: 'clothes', ap: { hat: 1 } },
  'hat-beanie':  { name: 'Beanie',   icon: '👒', type: 'clothes', ap: { hat: 2 } },
  'hat-hardhat': { name: 'Hard hat', icon: '⛑️', type: 'clothes', ap: { hat: 3 } },
  'vest-yellow': { name: 'Hi-vis vest', icon: '🦺', type: 'clothes', vest: 'yellow' },
  'vest-orange': { name: 'Orange vest', icon: '🟧', type: 'clothes', vest: 'orange' },
  'vest-blue':   { name: 'Blue vest',   icon: '🟦', type: 'clothes', vest: 'blue' },
};

export function initInventory({ me, onEquip, onWear, onDropItem, toast }) {
  const inv = {
    slots: new Array(24).fill(null),   // {id, n}
    hotbar: new Array(6).fill(null),
    sel: -1,                            // selected hotbar index
    open: false,
  };
  // load persisted
  if (Array.isArray(me.inv)) me.inv.forEach((s, i) => { if (i < 24 && s && ITEMS[s.id]) inv.slots[i] = { id: s.id, n: s.n || 1 }; });
  if (Array.isArray(me.hotbar)) me.hotbar.forEach((s, i) => { if (i < 6 && s && ITEMS[s.id]) inv.hotbar[i] = { id: s.id, n: s.n || 1 }; });
  if (!me.inv && !me.hotbar) { // starter kit: a light for the long nights, plus the classic
    inv.hotbar[0] = { id: 'flashlight', n: 1 };
    inv.hotbar[1] = { id: 'paddle', n: 1 };
  }

  let saveT = null;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => net.send({ t: 'inv', inv: inv.slots, hotbar: inv.hotbar }), 400);
  };
  const flush = () => { // fire the pending save NOW (tab closing)
    clearTimeout(saveT);
    net.send({ t: 'inv', inv: inv.slots, hotbar: inv.hotbar });
  };

  // ---------- DOM ----------
  const hotbarEl = document.getElementById('hotbar');
  const invEl = document.getElementById('inventory');
  const gridEl = document.getElementById('inv-grid');
  const invHotEl = document.getElementById('inv-hotbar');

  function slotHTML(s) {
    if (!s) return '';
    const d = ITEMS[s.id];
    return `<span class="it">${d.icon}</span>${s.n > 1 ? `<span class="ct">${s.n}</span>` : ''}`;
  }
  function renderHotbar() {
    hotbarEl.querySelectorAll('.slot').forEach((el, i) => {
      el.innerHTML = `<span class="key">${i + 1}</span>` + slotHTML(inv.hotbar[i]);
      el.classList.toggle('sel', i === inv.sel);
    });
  }
  function renderInv() {
    gridEl.querySelectorAll('.slot').forEach((el, i) => { el.innerHTML = slotHTML(inv.slots[i]); });
    invHotEl.querySelectorAll('.slot').forEach((el, i) => { el.innerHTML = slotHTML(inv.hotbar[i]); });
  }
  // build slot elements
  for (let i = 0; i < 6; i++) hotbarEl.insertAdjacentHTML('beforeend', `<div class="slot" data-bar="${i}"></div>`);
  for (let i = 0; i < 24; i++) gridEl.insertAdjacentHTML('beforeend', `<div class="slot" data-grid="${i}"></div>`);
  for (let i = 0; i < 6; i++) invHotEl.insertAdjacentHTML('beforeend', `<div class="slot" data-bhot="${i}"></div>`);
  renderHotbar(); renderInv();

  const getRef = (el) => {
    if (el?.dataset?.grid !== undefined) return { arr: inv.slots, i: +el.dataset.grid };
    if (el?.dataset?.bhot !== undefined) return { arr: inv.hotbar, i: +el.dataset.bhot };
    if (el?.dataset?.bar !== undefined) return { arr: inv.hotbar, i: +el.dataset.bar };
    return null;
  };

  // ---------- drag & drop (pointer events: mouse + touch) ----------
  let drag = null; // {ref, ghost}
  const onDown = (e) => {
    const slotEl = e.target.closest('.slot');
    const ref = getRef(slotEl);
    if (!ref || !ref.arr[ref.i]) return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.textContent = ITEMS[ref.arr[ref.i].id].icon;
    document.body.appendChild(ghost);
    drag = { ref, ghost };
    moveGhost(e);
  };
  const moveGhost = (e) => {
    if (!drag) return;
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
  };
  const onUp = (e) => {
    if (!drag) return;
    drag.ghost.remove();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const to = getRef(under?.closest('.slot'));
    const from = drag.ref;
    drag = null;
    if (!to) {
      // dragged out over the game world: toss the whole stack, minecraft style
      if (under?.id === 'game') {
        const s = from.arr[from.i];
        if (s) {
          from.arr[from.i] = null;
          if (from.arr === inv.hotbar && from.i === inv.sel) { onEquip(null); inv.sel = -1; }
          renderHotbar(); renderInv(); save();
          onDropItem?.(s.id, s.n);
          beep(340, .06, 'sine', .08);
        }
      }
      return;
    }
    if (to.arr === from.arr && to.i === from.i) return;
    const a = from.arr[from.i], b = to.arr[to.i];
    if (b && a && b.id === a.id && ['food', 'mat', 'build', 'prop'].includes(ITEMS[a.id].type)) { // stack
      b.n += a.n; from.arr[from.i] = null;
    } else {
      from.arr[from.i] = b || null;
      to.arr[to.i] = a;
    }
    renderHotbar(); renderInv(); save();
    beep(500, .04, 'sine', .08);
  };
  invEl.addEventListener('pointerdown', onDown);
  hotbarEl.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', moveGhost);
  addEventListener('pointerup', onUp);

  // ---------- dropping (minecraft style) ----------
  // right-click a slot to toss one on the floor; H (wired in main) drops from
  // the selected hotbar slot
  function removeOne(ref) {
    const s = ref.arr[ref.i];
    if (!s) return null;
    const id = s.id;
    s.n--;
    if (s.n <= 0) {
      ref.arr[ref.i] = null;
      if (ref.arr === inv.hotbar && ref.i === inv.sel) { onEquip(null); inv.sel = -1; }
    }
    renderHotbar(); renderInv(); save();
    return id;
  }
  function dropSelected() {
    if (inv.sel === -1) return null;
    return removeOne({ arr: inv.hotbar, i: inv.sel });
  }
  const onCtx = (e) => {
    const ref = getRef(e.target.closest('.slot'));
    if (!ref || !ref.arr[ref.i]) return;
    e.preventDefault();
    const id = removeOne(ref);
    if (id) { onDropItem?.(id); beep(340, .05, 'sine', .07); }
  };
  invEl.addEventListener('contextmenu', onCtx);
  hotbarEl.addEventListener('contextmenu', onCtx);

  // ---------- API ----------
  function findRoom(id) {
    const stack = ['food', 'mat', 'build', 'prop'].includes(ITEMS[id].type);
    if (stack) {
      const h = inv.hotbar.find(s => s?.id === id);
      if (h) return h;
      const s = inv.slots.find(s2 => s2?.id === id);
      if (s) return s;
    }
    const hi = inv.hotbar.findIndex(s => !s);
    if (hi !== -1) { inv.hotbar[hi] = { id, n: 0 }; return inv.hotbar[hi]; }
    const si = inv.slots.findIndex(s => !s);
    if (si !== -1) { inv.slots[si] = { id, n: 0 }; return inv.slots[si]; }
    return null;
  }
  function add(id, n = 1) {
    if (!ITEMS[id]) return false;
    const slot = findRoom(id);
    if (!slot) { toast('🎒 Inventory full!'); return false; }
    slot.n += n;
    renderHotbar(); renderInv(); save();
    return true;
  }
  function select(i) {
    inv.sel = inv.sel === i ? -1 : i;
    const s = inv.sel === -1 ? null : inv.hotbar[inv.sel];
    const d = s && ITEMS[s.id];
    if (d?.type === 'clothes') {
      onWear(d);
      inv.sel = -1;
      onEquip(null);
    } else {
      onEquip(s ? s.id : null);
    }
    renderHotbar();
    beep(700, .03, 'sine', .06);
  }
  function useSelected() { // F: consume food
    if (inv.sel === -1) return null;
    const s = inv.hotbar[inv.sel];
    if (!s) return null;
    const d = ITEMS[s.id];
    if (d.type === 'food') {
      s.n--;
      if (s.n <= 0) { inv.hotbar[inv.sel] = null; onEquip(null); inv.sel = -1; }
      renderHotbar(); renderInv(); save();
      return { used: s?.id || null, def: d };
    }
    return { melee: s.id, def: d };
  }
  // server-authoritative reload: the init message carries the stored inventory
  // (the localStorage user copy goes stale the moment anything is picked up)
  function restore(slots, hotbar) {
    if (!Array.isArray(slots) && !Array.isArray(hotbar)) return;
    inv.sel = -1; // stale selection after death/reload made re-equips no-op
    if (Array.isArray(slots)) inv.slots = inv.slots.map((_, i) => {
      const s = slots[i];
      return s && ITEMS[s.id] ? { id: s.id, n: s.n || 1 } : null;
    });
    if (Array.isArray(hotbar)) inv.hotbar = inv.hotbar.map((_, i) => {
      const s = hotbar[i];
      return s && ITEMS[s.id] ? { id: s.id, n: s.n || 1 } : null;
    });
    renderHotbar(); renderInv();
  }

  // crafting support: how many of an item across all slots / consume n of it
  function count(id) {
    let n = 0;
    for (const s2 of [...inv.slots, ...inv.hotbar]) if (s2?.id === id) n += s2.n;
    return n;
  }
  function consume(id, n) {
    if (count(id) < n) return false;
    for (const arr of [inv.slots, inv.hotbar]) {
      for (let i = 0; i < arr.length && n > 0; i++) {
        const s2 = arr[i];
        if (s2?.id !== id) continue;
        const take = Math.min(s2.n, n);
        s2.n -= take; n -= take;
        if (s2.n <= 0) {
          arr[i] = null;
          if (arr === inv.hotbar && i === inv.sel) { onEquip(null); inv.sel = -1; }
        }
      }
    }
    renderHotbar(); renderInv(); save();
    return true;
  }

  function toggle(open) {
    inv.open = open ?? !inv.open;
    invEl.classList.toggle('hidden', !inv.open);
    uiFocus('inv', inv.open); // free the cursor while the panel is up
    if (inv.open) renderInv();
    return inv.open;
  }
  function selectedItem() { return inv.sel === -1 ? null : inv.hotbar[inv.sel]; }

  // hotbar click to select
  hotbarEl.addEventListener('click', (e) => {
    const el = e.target.closest('.slot');
    if (el?.dataset?.bar !== undefined) select(+el.dataset.bar);
  });

  return { add, select, useSelected, dropSelected, count, consume, toggle, selectedItem, restore, flush, state: inv };
}
