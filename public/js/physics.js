// Sandbox physics: cannon-es world mirroring the map's static colliders, with
// spawnable dynamic props (boxes, crates, balls…) that everyone can shove,
// smack, physgun around — and that persist on the server between restarts.
// Netcode is owner-simulated: whoever last touched a prop streams its motion;
// idle props go to sleep and stop costing bandwidth.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { W } from './world.js';
import { net } from './net.js';
import { ct } from './textures.js';

const boxTex = () => ct(128, 128, (g, w, h) => {
  g.fillStyle = '#b98d5f'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 2;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#8f6a42'; g.fillRect(0, h / 2 - 7, w, 14); // packing tape band
  g.strokeStyle = '#232f3e'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(34, 88); g.quadraticCurveTo(64, 104, 92, 86); g.stroke(); // the smile
  g.beginPath(); g.moveTo(88, 82); g.lineTo(97, 87); g.lineTo(88, 93); g.fill();
});
const crateTex = () => ct(128, 128, (g, w, h) => {
  g.fillStyle = '#9a815f'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,42,20,.5)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); }
  g.lineWidth = 7; g.strokeStyle = '#7a6448';
  g.strokeRect(4, 4, w - 8, h - 8);
  g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.moveTo(w - 4, 4); g.lineTo(4, h - 4); g.stroke();
});
const melonTex = () => ct(128, 64, (g, w, h) => {
  g.fillStyle = '#2f7a33'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#245c27';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 16 + 4, 0);
    g.quadraticCurveTo(i * 16 + 12, h / 2, i * 16 + 4, h);
    g.quadraticCurveTo(i * 16 - 4, h / 2, i * 16 + 4, 0);
    g.fill();
  }
});

// kind -> { mass, restitution, build() -> {mesh}, shape() -> CANNON.Shape, label, icon }
export const PHYS_KINDS = {
  box: {
    label: 'Amazon box', icon: '📦', mass: 2,
    shape: () => new CANNON.Box(new CANNON.Vec3(.31, .31, .31)),
    build() { return new THREE.Mesh(new THREE.BoxGeometry(.62, .62, .62), new THREE.MeshStandardMaterial({ map: boxTex(), roughness: .85 })); },
  },
  crate: {
    label: 'Wood crate', icon: '🪵', mass: 9,
    shape: () => new CANNON.Box(new CANNON.Vec3(.5, .5, .5)),
    build() { return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: crateTex(), roughness: .9 })); },
  },
  ball: {
    label: 'Kickball', icon: '🔴', mass: 1.2, restitution: .72,
    shape: () => new CANNON.Sphere(.32),
    build() {
      const m = new THREE.Mesh(new THREE.SphereGeometry(.32, 18, 14), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: .5 }));
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(.32, .015, 6, 24), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: .5 }));
      stripe.rotation.x = Math.PI / 2;
      const g = new THREE.Group(); g.add(m, stripe);
      return g;
    },
  },
  barrel: {
    label: 'Barrel', icon: '🛢️', mass: 7,
    shape: () => new CANNON.Cylinder(.36, .36, .95, 10),
    build() {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .95, 14), new THREE.MeshStandardMaterial({ color: 0x2e5d8a, roughness: .55 })));
      for (const y of [-.3, .3]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.365, .018, 6, 16), new THREE.MeshStandardMaterial({ color: 0x1e4463, roughness: .5 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = y;
        g.add(ring);
      }
      return g;
    },
  },
  melon: {
    label: 'Watermelon', icon: '🍉', mass: 3,
    shape: () => new CANNON.Sphere(.28),
    build() {
      const m = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 12), new THREE.MeshStandardMaterial({ map: melonTex(), roughness: .6 }));
      m.scale.set(1, .85, 1.15);
      return m;
    },
  },
  cone: {
    label: 'Traffic cone', icon: '🚧', mass: 1.4,
    shape: () => new CANNON.Cylinder(.05, .2, .55, 8),
    build() {
      const g = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.04, .18, .5, 12), new THREE.MeshStandardMaterial({ color: 0xe06a1e, roughness: .6 }));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.125, .148, .09, 12), new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: .5 }));
      band.position.y = .05;
      const base = new THREE.Mesh(new THREE.BoxGeometry(.34, .04, .34), new THREE.MeshStandardMaterial({ color: 0xd06018, roughness: .7 }));
      base.position.y = -.25;
      g.add(c, band, base);
      return g;
    },
  },
};

export function initPhysics(scene) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const groundMat = new CANNON.Material('ground');
  const propMat = new CANNON.Material('prop');
  const bouncyMat = new CANNON.Material('bouncy');
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, propMat, { friction: .45, restitution: .25 }));
  world.addContactMaterial(new CANNON.ContactMaterial(propMat, propMat, { friction: .4, restitution: .3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, bouncyMat, { friction: .3, restitution: .72 }));
  world.addContactMaterial(new CANNON.ContactMaterial(propMat, bouncyMat, { friction: .3, restitution: .6 }));

  const ground = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  // mirror the map's 2D wall/furniture colliders as static boxes (2.6m tall);
  // car colliders are skipped here and tracked as kinematic bodies instead
  const carCols = new Set((W.cars || []).map(c => c.col));
  for (const c of W.colliders) {
    if (carCols.has(c) || !Number.isFinite(c.x0)) continue;
    const hw = (c.x1 - c.x0) / 2, hd = (c.z1 - c.z0) / 2;
    if (hw <= 0 || hd <= 0) continue;
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat, shape: new CANNON.Box(new CANNON.Vec3(hw, 1.3, hd)) });
    b.position.set(c.x0 + hw, 1.3, c.z0 + hd);
    world.addBody(b);
  }
  const carBodies = (W.cars || []).map(car => {
    const b = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: groundMat, shape: new CANNON.Box(new CANNON.Vec3(car.hl || 2.15, .6, car.hw || 1.0)) });
    b.position.set(car.x, .6, car.z);
    world.addBody(b);
    return { car, b };
  });

  const props = new Map(); // id -> {id, kind, body, mesh, owned, netT, grabbedBy}
  let sendT = 0;

  function add(prop, { mine = false } = {}) {
    if (props.has(prop.id)) remove(prop.id);
    const def = PHYS_KINDS[prop.kind];
    if (!def) return null;
    const body = new CANNON.Body({ mass: def.mass, material: def.restitution ? bouncyMat : propMat, shape: def.shape(), angularDamping: .35, linearDamping: .08 });
    body.position.set(prop.p[0], prop.p[1], prop.p[2]);
    body.quaternion.set(prop.q[0], prop.q[1], prop.q[2], prop.q[3]);
    body.sleepSpeedLimit = .4;
    body.sleepTimeLimit = .5;
    if (!mine) body.sleep(); // server-restored / remote props start at rest
    world.addBody(body);
    const mesh = def.build();
    mesh.position.copy(body.position);
    scene.add(mesh);
    const e = { id: prop.id, kind: prop.kind, body, mesh, owned: mine, grabbedBy: null };
    props.set(prop.id, e);
    return e;
  }
  function remove(id) {
    const e = props.get(id);
    if (!e) return;
    world.removeBody(e.body);
    scene.remove(e.mesh);
    props.delete(id);
  }
  function claim(e) { e.owned = true; e.body.wakeUp(); }

  // remote authority: someone else is driving this prop now
  function applyState(m) {
    const e = props.get(m.id);
    if (!e) return;
    e.owned = false;
    e.body.position.set(m.p[0], m.p[1], m.p[2]);
    e.body.quaternion.set(m.q[0], m.q[1], m.q[2], m.q[3]);
    if (m.v) e.body.velocity.set(m.v[0], m.v[1], m.v[2]);
    e.body.wakeUp();
  }

  function sendState(e) {
    const b = e.body;
    net.send({
      t: 'prop', op: 'state', id: e.id,
      p: [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)],
      q: [+b.quaternion.x.toFixed(3), +b.quaternion.y.toFixed(3), +b.quaternion.z.toFixed(3), +b.quaternion.w.toFixed(3)],
      v: [+b.velocity.x.toFixed(2), +b.velocity.y.toFixed(2), +b.velocity.z.toFixed(2)],
    });
  }

  // shove props out of the way as you walk through them (and take ownership)
  function playerPush(px, py, pz, dt) {
    for (const e of props.values()) {
      const b = e.body;
      const dx = b.position.x - px, dz = b.position.z - pz;
      const d = Math.hypot(dx, dz);
      const rad = .34 + (e.kind === 'crate' ? .62 : .42);
      if (d < rad && b.position.y < py + 1.6) {
        const nx = d > .01 ? dx / d : 1, nz = d > .01 ? dz / d : 0;
        claim(e);
        // impulse at the center of mass (a relative point would add torque)
        b.applyImpulse(new CANNON.Vec3(nx * 3.2 * dt * 60 * .12, .3, nz * 3.2 * dt * 60 * .12));
      }
    }
  }

  // melee swing / kick: launch props in front of the player
  function smack(px, py, pz, dirX, dirZ) {
    let hitAny = false;
    for (const e of props.values()) {
      const b = e.body;
      const dx = b.position.x - px, dz = b.position.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > 2.1 || b.position.y > py + 2.2) continue;
      const dot = (dx * dirX + dz * dirZ) / (d || 1);
      if (dot < .55) continue; // must be roughly in front
      claim(e);
      const pow = 5.5 * Math.min(1, 4 / b.mass) + 1.5;
      b.applyImpulse(new CANNON.Vec3(dirX * pow * b.mass, 2.2 * Math.min(b.mass, 2.5), dirZ * pow * b.mass));
      hitAny = true;
    }
    return hitAny;
  }

  function step(dt, playerPos) {
    for (const { car, b } of carBodies) { b.position.set(car.x, .6, car.z); b.quaternion.setFromEuler(0, car.ry, 0); }
    if (playerPos) playerPush(playerPos.x, playerPos.y, playerPos.z, dt);
    world.step(1 / 60, dt, 3);
    for (const e of props.values()) {
      const b = e.body;
      // safety net: anything that tunnels the floor or escapes the map snaps back
      if (b.position.y < -8 || b.position.x < -80 || b.position.x > 150 || b.position.z < -60 || b.position.z > 188) {
        b.position.x = Math.max(-78, Math.min(148, b.position.x));
        b.position.z = Math.max(-58, Math.min(186, b.position.z));
        b.position.y = 2;
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
      e.mesh.position.copy(b.position);
      e.mesh.quaternion.copy(b.quaternion);
    }
    // stream my awake props at ~12Hz
    sendT += dt;
    if (sendT > .085) {
      sendT = 0;
      for (const e of props.values()) {
        if (e.owned && e.body.sleepState !== CANNON.Body.SLEEPING) sendState(e);
      }
    }
  }

  function raycast(raycaster, maxDist = 14) {
    const meshes = [...props.values()].map(e => e.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    for (const h of hits) {
      if (h.distance > maxDist) break;
      let o = h.object;
      while (o && !meshes.includes(o)) o = o.parent;
      if (!o) continue;
      const e = [...props.values()].find(x => x.mesh === o);
      if (e) return { e, point: h.point, distance: h.distance };
    }
    return null;
  }

  return { world, props, add, remove, claim, applyState, sendState, step, smack, raycast, PHYS_KINDS };
}
