// Persistent level-editor props: builders + live registry.
// Every client renders these from data/map-edits.json; admins place them.
import * as THREE from 'three';
import { W } from './world.js';

const mat = (c, r = .7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const chrome = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: .25, metalness: .9 });
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
};
const cy = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 12) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y, z);
  return o;
};

function chair(color) {
  const g = new THREE.Group();
  const m = mat(color, .6);
  g.add(bx(.46, .05, .45, m, 0, .46, 0));
  const back = bx(.46, .48, .05, m, 0, .74, -.21);
  back.rotation.x = -.1;
  g.add(back);
  for (const [lx, lz] of [[-.19, -.18], [.19, -.18], [-.19, .18], [.19, .18]])
    g.add(cy(.015, .015, .46, chrome(), lx, .23, lz, 6));
  return { g, cw: .55, cd: .55 };
}

export const PROP_KINDS = {
  'table': { label: '🟫 Folding table', build() {
    const g = new THREE.Group();
    g.add(bx(1.78, .05, .76, mat(0x3b3733, .55), 0, .745, 0));
    g.add(bx(1.8, .07, .8, mat(0x24262a, .5), 0, .7, 0));
    for (const [lx, lz] of [[-.72, -.2], [.72, -.2], [-.72, .2], [.72, .2]])
      g.add(cy(.02, .025, .72, mat(0x24262a, .5), lx, .36, lz, 6));
    return { g, cw: 1.9, cd: .9 };
  } },
  'chair-green': { label: '🟩 Chair (green)', build: () => chair(0x9bc11e) },
  'chair-brown': { label: '⬛ Chair (brown)', build: () => chair(0x33302c) },
  'chair-orange': { label: '🟧 Chair (orange)', build: () => chair(0xd96820) },
  'chair-yellow': { label: '🟨 Chair (yellow)', build: () => chair(0xe0b110) },
  'couch': { label: '🛋️ Couch', build() {
    const g = new THREE.Group();
    const m = mat(0x1c1e22, .45);
    g.add(bx(2.5, .5, 1.05, m, 0, .32, 0));
    g.add(bx(2.5, .62, .3, m, 0, .82, -.42));
    g.add(bx(.3, .38, 1.05, m, -1.13, .68, 0));
    g.add(bx(.3, .38, 1.05, m, 1.13, .68, 0));
    return { g, cw: 2.6, cd: 1.15 };
  } },
  'plant': { label: '🪴 Plant', build() {
    const g = new THREE.Group();
    g.add(cy(.26, .2, .4, mat(0x8a5a3a, .8), 0, .2, 0));
    const leafM = mat(0x3f7d3a, .8);
    leafM.side = THREE.DoubleSide;
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(.09, 1.15, 5), leafM);
      const a = i / 9 * Math.PI * 2;
      leaf.position.set(Math.cos(a) * .12, .95, Math.sin(a) * .12);
      leaf.rotation.z = Math.cos(a) * .8;
      leaf.rotation.x = Math.sin(a) * .8;
      g.add(leaf);
    }
    return { g, cw: .55, cd: .55 };
  } },
  'locker': { label: '🗄️ Locker bank', build() {
    const g = new THREE.Group();
    g.add(bx(2.0, 1.9, .5, mat(0xd6cfc0), 0, .95, 0));
    const crown = bx(2.0, .06, .6, mat(0xc7bfae), 0, 2.02, .04);
    crown.rotation.x = .4; // slope down over the doors, high at the back
    g.add(crown);
    for (let i = 0; i < 4; i++) g.add(bx(.02, 1.7, .02, mat(0x9a927e), -.75 + i * .5, .95, .26));
    return { g, cw: 2.05, cd: .6 };
  } },
  'vending': { label: '🥤 Vending machine', build() {
    const g = new THREE.Group();
    g.add(bx(1.0, 1.9, .85, mat(0x0e3a8c, .5), 0, .95, 0));
    g.add(bx(.7, 1.5, .04, mat(0x101821, .3), -.08, 1.05, .44));
    return { g, cw: 1.05, cd: .9 };
  } },
  'cooler': { label: '🧊 Cooler', build() {
    const g = new THREE.Group();
    g.add(bx(.8, 2.1, 1.05, mat(0x191b1e, .5), 0, 1.05, 0));
    g.add(bx(.04, 1.7, .85, mat(0x0c1218, .2), .41, 1.0, 0));
    return { g, cw: .9, cd: 1.1 };
  } },
  'trash': { label: '🗑️ Trash can', build() {
    const g = new THREE.Group();
    g.add(cy(.3, .26, .75, mat(0x6a6e73), 0, .38, 0));
    return { g, cw: .6, cd: .6 };
  } },
  'stanchion': { label: '🚧 Stanchion', build() {
    const g = new THREE.Group();
    g.add(cy(.035, .05, 1.0, mat(0x17181c, .6), 0, .5, 0, 8));
    g.add(cy(.09, .09, .03, mat(0x17181c, .6), 0, 1.0, 0, 10));
    return { g, cw: .3, cd: .3 };
  } },
  'pallet': { label: '🟫 Pallet', build() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) g.add(bx(1.2, .04, .18, mat(0xa8967e, .9), 0, .14, -.5 + i * .25));
    for (const lx of [-.55, 0, .55]) g.add(bx(.1, .1, 1.2, mat(0x8a7861, .9), lx, .06, 0));
    return { g, cw: 1.3, cd: 1.3 };
  } },
  'cone': { label: '🚸 Traffic cone', build() {
    const g = new THREE.Group();
    g.add(cy(.03, .18, .55, mat(0xe06a1e, .6), 0, .28, 0, 10));
    g.add(bx(.4, .04, .4, mat(0xd06018), 0, .02, 0));
    return { g, cw: .45, cd: .45 };
  } },
  'wall': { label: '🧱 Wall section', build() {
    const g = new THREE.Group();
    g.add(bx(3, 2.6, .25, mat(0x9a9d9f, .9), 0, 1.3, 0));
    return { g, cw: 3.05, cd: .35 };
  } },
  'blocker': { label: '🚫 Invisible blocker', build() {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: 0xe84f4f, transparent: true, opacity: .28 });
    g.add(bx(2, 1.6, 2, m, 0, .8, 0));
    g.userData.editorOnly = true; // hidden for non-admins
    return { g, cw: 2, cd: 2 };
  } },
};

export function initProps(scene, isAdmin) {
  const placed = new Map(); // id -> {prop, group, collider}

  function add(prop) {
    if (placed.has(prop.id)) update(prop);
    const def = PROP_KINDS[prop.kind];
    if (!def) return;
    const { g, cw, cd } = def.build();
    g.position.set(prop.x, 0, prop.z);
    g.rotation.y = prop.ry || 0;
    g.scale.setScalar(prop.s || 1);
    if (g.userData.editorOnly && !isAdmin()) g.visible = false;
    g.userData.propId = prop.id;
    scene.add(g);
    // rotated AABB approximation: use the bigger footprint when rotated
    const flip = Math.abs(Math.sin(prop.ry || 0)) > .5;
    const w = (flip ? cd : cw) * (prop.s || 1), d = (flip ? cw : cd) * (prop.s || 1);
    const collider = { x0: prop.x - w / 2, x1: prop.x + w / 2, z0: prop.z - d / 2, z1: prop.z + d / 2 };
    W.colliders.push(collider);
    placed.set(prop.id, { prop: { ...prop }, group: g, collider });
  }
  function del(id) {
    const e = placed.get(id);
    if (!e) return;
    scene.remove(e.group);
    const i = W.colliders.indexOf(e.collider);
    if (i !== -1) W.colliders.splice(i, 1);
    placed.delete(id);
  }
  function update(prop) {
    del(prop.id);
    add(prop);
  }
  return {
    placed,
    add, del, update,
    applyServer(m) {
      if (m.op === 'add') add(m.prop);
      else if (m.op === 'update') update(m.prop);
      else if (m.op === 'del') del(m.id);
    },
    pickGroups() { return [...placed.values()].map(e => e.group); },
  };
}
