// Admin level editor: place / move / rotate / scale / delete persistent props.
// All changes go through the server (admin-validated) and broadcast live.
import * as THREE from 'three';
import { net } from './net.js';
import { PROP_KINDS } from './props.js';

export function initEditor({ scene, camera, props, toast }) {
  const ed = { active: false, placing: null, ghost: null, ghostRy: 0, ghostS: 1, selected: null, moveMode: false };
  const ray = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  // ---------- UI ----------
  const btn = document.createElement('button');
  btn.id = 'btn-editor';
  btn.textContent = '🛠️';
  btn.title = 'Level editor (admin)';
  document.getElementById('topbar').prepend(btn);

  const panel = document.createElement('div');
  panel.id = 'editor-ui';
  panel.className = 'hidden';
  panel.innerHTML = `
    <div id="editor-head">🛠️ LEVEL EDITOR <span id="editor-hint">pick a prop, tap the floor to place</span></div>
    <div id="editor-palette"></div>
    <div id="editor-actions" class="hidden">
      <span id="editor-sel-name"></span>
      <button data-act="rot">↻ 45°</button>
      <button data-act="grow">＋ size</button>
      <button data-act="shrink">－ size</button>
      <button data-act="move">✥ move</button>
      <button data-act="del">🗑 delete</button>
      <button data-act="done">✓ done</button>
    </div>`;
  document.body.appendChild(panel);

  const palette = panel.querySelector('#editor-palette');
  for (const [kind, def] of Object.entries(PROP_KINDS)) {
    const b = document.createElement('button');
    b.textContent = def.label;
    b.dataset.kind = kind;
    b.addEventListener('click', () => startPlacing(kind, b));
    palette.appendChild(b);
  }
  const actions = panel.querySelector('#editor-actions');
  const hint = panel.querySelector('#editor-hint');

  btn.addEventListener('click', () => setActive(!ed.active));
  addEventListener('keydown', (e) => {
    if (!ed.active) return;
    if (e.code === 'Escape') { stopPlacing(); select(null); }
    if (e.code === 'KeyR' && ed.ghost) { ed.ghostRy += Math.PI / 4; ed.ghost.rotation.y = ed.ghostRy; }
  });

  function setActive(on) {
    ed.active = on;
    panel.classList.toggle('hidden', !on);
    btn.style.background = on ? '#ff9900' : '';
    document.exitPointerLock?.();
    if (!on) { stopPlacing(); select(null); }
    toast(on ? '🛠️ Editor on — changes save to the server for everyone' : 'Editor off', 1800);
  }

  function startPlacing(kind, b) {
    stopPlacing(); select(null);
    palette.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    const { g } = PROP_KINDS[kind].build();
    g.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .55; } });
    scene.add(g);
    ed.placing = kind;
    ed.ghost = g;
    ed.ghostRy = 0; ed.ghostS = 1;
    hint.textContent = 'tap floor to place · R/↻ rotate · Esc stop';
  }
  function stopPlacing() {
    if (ed.ghost) scene.remove(ed.ghost);
    ed.ghost = null; ed.placing = null;
    palette.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    hint.textContent = 'pick a prop, tap the floor to place';
  }
  function select(id) {
    ed.selected = id;
    ed.moveMode = false;
    actions.classList.toggle('hidden', !id);
    if (id) {
      const e = props.placed.get(id);
      panel.querySelector('#editor-sel-name').textContent = PROP_KINDS[e.prop.kind]?.label || e.prop.kind;
    }
  }

  actions.addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    if (!act || !ed.selected) return;
    const entry = props.placed.get(ed.selected);
    if (!entry) { select(null); return; }
    const p = entry.prop;
    if (act === 'rot') net.send({ t: 'edit', op: 'update', prop: { id: p.id, ry: (p.ry || 0) + Math.PI / 4 } });
    else if (act === 'grow') net.send({ t: 'edit', op: 'update', prop: { id: p.id, s: (p.s || 1) * 1.2 } });
    else if (act === 'shrink') net.send({ t: 'edit', op: 'update', prop: { id: p.id, s: (p.s || 1) / 1.2 } });
    else if (act === 'move') { ed.moveMode = true; hint.textContent = 'tap the floor to drop it'; }
    else if (act === 'del') { net.send({ t: 'edit', op: 'del', id: p.id }); select(null); }
    else if (act === 'done') select(null);
  });

  function groundPoint(sx, sy) {
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
    return ray.ray.intersectPlane(floorPlane, hit) ? hit : null;
  }

  // pointer hover: move ghost
  addEventListener('pointermove', (e) => {
    if (!ed.active || !ed.ghost) return;
    const p = groundPoint(e.clientX, e.clientY);
    if (p) ed.ghost.position.set(Math.round(p.x * 4) / 4, 0, Math.round(p.z * 4) / 4);
  });

  // tap routing from main
  ed.tap = (sx, sy) => {
    if (!ed.active) return false;
    const p = groundPoint(sx, sy);
    if (ed.placing && p) {
      net.send({ t: 'edit', op: 'add', prop: { kind: ed.placing, x: Math.round(p.x * 4) / 4, z: Math.round(p.z * 4) / 4, ry: ed.ghostRy, s: ed.ghostS } });
      return true;
    }
    if (ed.moveMode && ed.selected && p) {
      net.send({ t: 'edit', op: 'update', prop: { id: ed.selected, x: Math.round(p.x * 4) / 4, z: Math.round(p.z * 4) / 4 } });
      ed.moveMode = false;
      hint.textContent = 'pick a prop, tap the floor to place';
      return true;
    }
    // select an existing prop
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
    const hits = ray.intersectObjects(props.pickGroups(), true);
    let obj = hits[0]?.object;
    while (obj && !obj.userData.propId) obj = obj.parent;
    if (obj?.userData.propId) { select(obj.userData.propId); return true; }
    select(null);
    return true; // consume all taps while editor is open
  };

  return ed;
}
