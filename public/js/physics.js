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
import { enableShadows } from './lighting.js';

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
  wall: {
    label: 'Wood wall', icon: '🧱', mass: 40,
    shape: () => new CANNON.Box(new CANNON.Vec3(1.5, 1.5, .11)),
    build() {
      const tex = ct(128, 128, (g, w, h) => {
        g.fillStyle = '#a8896a'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(80,56,34,.55)'; g.lineWidth = 3;
        for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(i * 25.6, 0); g.lineTo(i * 25.6, h); g.stroke(); }
        g.strokeStyle = 'rgba(60,42,22,.35)';
        for (let i = 0; i < 14; i++) { const y = Math.random() * h; g.beginPath(); g.moveTo(Math.random() * w, y); g.lineTo(Math.random() * w, y + 8); g.stroke(); }
      });
      return new THREE.Mesh(new THREE.BoxGeometry(3, 3, .22), new THREE.MeshStandardMaterial({ map: tex, roughness: .85 }));
    },
  },
  floor: {
    label: 'Wood floor', icon: '🟫', mass: 40,
    shape: () => new CANNON.Box(new CANNON.Vec3(1.5, .09, 1.5)),
    build() {
      const tex = ct(128, 128, (g, w, h) => {
        g.fillStyle = '#9a7b58'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(70,50,30,.5)'; g.lineWidth = 3;
        for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * 21.3); g.lineTo(w, i * 21.3); g.stroke(); }
      });
      return new THREE.Mesh(new THREE.BoxGeometry(3, .18, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
    },
  },
  door: {
    label: 'Fading door', icon: '🚪', mass: 25,
    shape: () => new CANNON.Box(new CANNON.Vec3(.8, 1.35, .08)),
    build() {
      const g = new THREE.Group();
      const doorM = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: .8, transparent: true }); // fades
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.7, .16), doorM));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: .3, metalness: .7 }));
      knob.position.set(.6, 0, .12);
      g.add(knob);
      return g;
    },
  },
  campfire: {
    label: 'Campfire', icon: '🔥', mass: 6,
    shape: () => new CANNON.Cylinder(.5, .5, .42, 8),
    build() {
      const g = new THREE.Group();
      const logM = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: .95 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(.07, .08, .8, 7), logM);
        log.rotation.z = Math.PI / 2 - .35;
        log.rotation.y = i * Math.PI * 2 / 3;
        log.position.y = -.05;
        g.add(log);
      }
      const stoneM = new THREE.MeshStandardMaterial({ color: 0x7d7f83, roughness: 1 });
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2;
        const st = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), stoneM);
        st.position.set(Math.cos(a) * .48, -.14, Math.sin(a) * .48);
        st.scale.y = .7;
        g.add(st);
      }
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(.2, .55, 7),
        new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.y = .22;
      const core = new THREE.Mesh(
        new THREE.ConeGeometry(.1, .34, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.position.y = .16;
      g.add(flame, core);
      g.userData.flame = flame;
      g.userData.flameCore = core;
      return g;
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
  // crisper contacts: more solver iterations + tighter tolerance = stable
  // stacks and less spongy pushing (the "havok" feel is mostly solver quality)
  world.solver.iterations = 14;
  world.solver.tolerance = .01;
  const groundMat = new CANNON.Material('ground');
  const propMat = new CANNON.Material('prop');
  const bouncyMat = new CANNON.Material('bouncy');
  // ground-prop friction is EXACTLY 0, like the cars: cannon's friction solver
  // freezes heavy resting bodies and lets light ones ice-skate — believable
  // sliding friction is applied manually in step() instead
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, propMat, { friction: 0, restitution: .25 }));
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
    if (carCols.has(c) || c.kn || !Number.isFinite(c.x0)) continue; // knockables don't stop cars
    const hw = (c.x1 - c.x0) / 2, hd = (c.z1 - c.z0) / 2;
    if (hw <= 0 || hd <= 0) continue;
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat, shape: new CANNON.Box(new CANNON.Vec3(hw, 1.3, hd)) });
    b.position.set(c.x0 + hw, 1.3, c.z0 + hd);
    world.addBody(b);
  }
  // cars are full rigid bodies: they roll, flip, get shoved, and can be
  // physgunned around while nobody's driving — proper gmod energy
  const CAR_HH = .42; // chassis half-height; visual group origin sits at the wheels
  const carMat = new CANNON.Material('car');
  // EXACTLY zero chassis-ground friction: the friction solver zeroes the
  // tangential velocity of a heavy resting box under ANY nonzero μ (verified
  // empirically — .04 behaved identically to .3). Cars roll on wheels anyway:
  // grip and drag live in drive(), sliding decay in linearDamping.
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, carMat, { friction: 0, restitution: .1 }));
  world.addContactMaterial(new CANNON.ContactMaterial(propMat, carMat, { friction: .35, restitution: .3 }));
  let myId = null;
  const cars = new Map(); // id -> {id, car, body, isCar, owned, grabbedBy, remote, rp, rq, rv, remoteT}
  function addCar(car) {
    // hitbox matched to the visual car (4.1×1.8 body, 1.3 roof): chassis box
    // plus a smaller cabin box on top so the shape rolls/stacks believably
    const hl = car.hl ?? (car.hl = 2.05), hw = car.hw ?? (car.hw = .9);
    const body = new CANNON.Body({
      mass: 180, material: carMat,
      angularDamping: .6, linearDamping: .12,
    });
    // cars are long along local Z (forward): width on x, LENGTH on z — the
    // box used to be built the other way round, leaving the hitbox 90° across
    // the car
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw, CAR_HH, hl)));
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw * .86, .24, hl * .52)), new CANNON.Vec3(0, CAR_HH + .2, -.2));
    body.position.set(car.x, CAR_HH + .05, car.z);
    body.quaternion.setFromEuler(0, car.ry, 0);
    body.interpolatedPosition.copy(body.position);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.sleepSpeedLimit = .35;
    body.sleepTimeLimit = .6;
    body.sleep();
    world.addBody(body);
    car.col.hAt = (x, z) => surfaceYAt(body, x, z); // roofs/hoods are climbable terrain
    const e = { id: car.id, car, body, isCar: true, owned: false, grabbedBy: null, remote: false };
    cars.set(car.id, e);
    return e;
  }
  for (const car of W.cars || []) addCar(car);
  const V = (x, y, z) => new CANNON.Vec3(x, y, z);

  // ---- walkable surfaces: single-body downward raycast ----
  // Used for standing on props/cars and for climbing rotated pieces (ramps):
  // an AABB alone turns a tilted ramp into an invisible wall.
  const wRay = new CANNON.Ray();
  wRay.mode = CANNON.Ray.CLOSEST;
  wRay.skipBackfaces = true;
  const wRes = new CANNON.RaycastResult();
  function surfaceYAt(body, x, z, fromY = null) {
    body.updateAABB();
    const top = body.aabb.upperBound.y;
    wRay.from.set(x, fromY == null ? top + .6 : fromY, z);
    wRay.to.set(x, body.aabb.lowerBound.y - .3, z);
    wRes.reset();
    wRay.intersectBody(body, wRes);
    return wRes.hasHit ? wRes.hitPointWorld.y : null; // null: (x,z) misses the actual shape
  }
  const STEP = .5; // max walk-up height (~source 18u): stairs/ramps yes, boxes no — jump those
  // highest walkable surface under (x,z) reachable from foot height py.
  // Returns {y, e}: e is the entity you'd be standing on (null = world floor),
  // so the walker can ride moving props like source-engine platforms.
  function groundAt(x, z, py) {
    let g = 0, ge = null;
    const consider = (body, e) => {
      body.updateAABB();
      const bb = body.aabb;
      if (x < bb.lowerBound.x - .05 || x > bb.upperBound.x + .05 ||
          z < bb.lowerBound.z - .05 || z > bb.upperBound.z + .05) return;
      if (bb.lowerBound.y > py + STEP + 1.2) return; // floating way overhead
      const h = surfaceYAt(body, x, z);
      if (h != null && h <= py + STEP && h > g) { g = h; ge = e; }
    };
    for (const e of props.values()) consider(e.body, e);
    for (const e of cars.values()) consider(e.body, e);
    return { y: g, e: ge };
  }
  // landing on a physics prop presses it down — the source-engine thud
  function stomp(e, vy) {
    if (!e || e.frozen || e.isCar) return;
    if (e.grabbedBy && e.grabbedBy !== myId) return;
    claim(e);
    e.body.applyImpulse(V(0, Math.max(-40, vy * Math.min(e.body.mass, 6) * .55), 0));
  }
  // ---- source-style movement clipping against FROZEN props ----
  // The player is never displaced by static geometry — their movement is
  // simply clipped, axis-separated, exactly like Source's player controller
  // (which also hand-rolls player movement and leaves physics to the props).
  // Blocking uses an EXACT circle-vs-oriented-box test (Bug52-54: discrete ray
  // probes could all miss the .22m edge of a wall, letting players phase in).
  const bdConj = new CANNON.Quaternion();
  const bdLocal = new CANNON.Vec3();
  const bdClosest = new CANNON.Vec3();
  function blockDepth(x, z, feetY, r) {
    let depth = 0;
    for (const e of props.values()) {
      if (!e.frozen) continue;
      const b = e.body;
      if (!b.collisionResponse) continue; // fading door — walk on through
      const bb = b.aabb;
      if (x < bb.lowerBound.x - r || x > bb.upperBound.x + r ||
          z < bb.lowerBound.z - r || z > bb.upperBound.z + r) continue;
      if (bb.lowerBound.y > feetY + 1.7) continue;      // frozen shelf overhead
      if (bb.upperBound.y - feetY <= STEP) continue;    // low enough to step on
      const shape = b.shapes[0];
      if (shape?.halfExtents) {
        // closest point on the oriented box to the player axis, sampled at a
        // few torso heights — exact in the horizontal plane, so thin edges
        // block just as hard as broad faces
        const he = shape.halfExtents;
        b.quaternion.conjugate(bdConj);
        for (const hy of [feetY + STEP + .06, feetY + .95, feetY + 1.55]) {
          bdLocal.set(x - b.position.x, hy - b.position.y, z - b.position.z);
          bdConj.vmult(bdLocal, bdLocal);
          bdClosest.set(
            Math.max(-he.x, Math.min(he.x, bdLocal.x)),
            Math.max(-he.y, Math.min(he.y, bdLocal.y)),
            Math.max(-he.z, Math.min(he.z, bdLocal.z)));
          b.quaternion.vmult(bdClosest, bdClosest);
          const wy = bdClosest.y + b.position.y - feetY;
          if (wy <= STEP || wy > 1.7) continue; // touching only a climbable/overhead part
          const hd = Math.hypot(bdClosest.x + b.position.x - x, bdClosest.z + b.position.z - z);
          if (r - hd > depth) depth = r - hd;
        }
      } else {
        // cylinders/cones: conservative bounding-radius disc
        const rad = (shape?.boundingSphereRadius || .4) * .8;
        const hd = Math.hypot(b.position.x - x, b.position.z - z) - rad;
        if (r - hd > depth) depth = r - hd;
      }
    }
    return depth;
  }
  function clipMove(px, pz, nx, nz, feetY, r = .34) {
    if (nx === px && nz === pz) return [nx, nz];
    const d0 = blockDepth(px, pz, feetY, r);
    if (d0 >= r - 1e-3) return [nx, nz];   // fully embedded (broken state): free escape
    if (d0 > 0) {                          // overlapping a face: only moves that get you OUT
      const dn = blockDepth(nx, nz, feetY, r);
      return dn < d0 - 1e-4 ? [nx, nz] : [px, pz];
    }
    let x = nx;
    if (blockDepth(x, pz, feetY, r) > 0) x = px;   // clip X
    let z = nz;
    if (blockDepth(x, z, feetY, r) > 0) z = pz;    // clip Z (with the clipped X)
    return [x, z];
  }

  // players are solid: shove the walking capsule out of dynamic props so a
  // physgunned crate PUSHES people instead of clipping through them
  function resolvePlayer(px, pz, py, r, exclude = null) {
    for (const e of props.values()) {
      if (e === exclude || e.frozen) continue;
      const bb = e.body.aabb;
      if (bb.upperBound.y - py <= STEP) continue;      // low enough to step on
      if (bb.lowerBound.y > py + 1.6) continue;        // floating overhead
      const nx = Math.max(bb.lowerBound.x, Math.min(px, bb.upperBound.x));
      const nz = Math.max(bb.lowerBound.z, Math.min(pz, bb.upperBound.z));
      const dx = px - nx, dz = pz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-9) { // center inside: push out the nearest face
        const pushes = [
          [bb.lowerBound.x - r - px, 0], [bb.upperBound.x + r - px, 0],
          [0, bb.lowerBound.z - r - pz], [0, bb.upperBound.z + r - pz],
        ];
        pushes.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        px += pushes[0][0]; pz += pushes[0][1];
      } else {
        const d = Math.sqrt(d2);
        px = nx + dx / d * r;
        pz = nz + dz / d * r;
      }
    }
    return [px, pz];
  }

  // arcade forces on a real chassis: engine + brake along the body's forward
  // axis, hard-set yaw rate for snappy steering, lateral-grip kill, and a
  // gentle self-righting torque so a flipped car can be driven back onto
  // its wheels
  function drive(e, throttle, steer, handbrake, dt) {
    const b = e.body;
    b.wakeUp();
    const fwd = b.quaternion.vmult(V(0, 0, 1));
    const right = b.quaternion.vmult(V(1, 0, 0));
    const up = b.quaternion.vmult(V(0, 1, 0));
    const grounded = up.y > .5 && b.position.y < CAR_HH + 1.1;
    if (grounded) {
      // velocity-space driving: the ground-contact friction solver eats applied
      // forces on resting bodies, so we steer the velocity directly — the
      // solver still owns collisions, gravity and rollovers
      let vFwd = b.velocity.dot(fwd);
      let vLat = b.velocity.dot(right);
      const top = e.car.top || 17;
      if (throttle > 0) vFwd += (e.car.acc || 9) * throttle * dt;
      else if (throttle < 0) vFwd += (vFwd > .3 ? 14 : 5) * throttle * dt;
      vFwd -= vFwd * (handbrake ? 2.2 : .45) * dt; // drag
      vFwd = Math.max(-6, Math.min(top, vFwd));
      vLat *= Math.pow(handbrake ? .55 : .05, dt); // grip (a touch more slide)
      b.velocity.set(
        fwd.x * vFwd + right.x * vLat,
        b.velocity.y,
        fwd.z * vFwd + right.z * vLat,
      );
      // snappier steering that comes in earlier
      const sf = Math.min(Math.abs(vFwd) / 5, 1) * 2.15 * (vFwd < -.3 ? -1 : 1);
      b.angularVelocity.y = steer * (handbrake ? 1.8 : 1) * sf;
      // arcade body language: lean out of corners, nose dip on the brakes,
      // a little squat under throttle — springs on the angular velocity
      const spdK = Math.min(Math.abs(vFwd) / (e.car.top || 17), 1);
      const rollErr = steer * spdK * .17 - right.y;
      const pitchErr = (throttle < -0.05 && vFwd > 1 ? -.06 : throttle > .05 ? .035 : 0) * spdK - fwd.y;
      b.angularVelocity.x += (fwd.x * rollErr + right.x * pitchErr) * 26 * dt;
      b.angularVelocity.z += (fwd.z * rollErr + right.z * pitchErr) * 26 * dt;
    }
    if (up.y < .95) { // self-righting: torque toward world-up
      const axis = up.cross(V(0, 1, 0));
      b.angularVelocity.x += axis.x * 5 * dt;
      b.angularVelocity.z += axis.z * 5 * dt;
      if (up.y < -.9) b.angularVelocity.x += 3 * dt; // break the upside-down equilibrium
    }
  }

  // remote authority for a car (driver stream or driverless nudge)
  function applyCarState(m, snap = false) {
    const e = cars.get(m.id);
    if (!e) return;
    e.owned = false;
    e.rp = e.rp || new CANNON.Vec3();
    e.rp.set(m.p[0], m.p[1], m.p[2]);
    e.rq = e.rq || new CANNON.Quaternion();
    e.rq.set(m.q[0], m.q[1], m.q[2], m.q[3]);
    e.rv = Array.isArray(m.v) ? m.v : null;
    e.remote = true;
    e.remoteT = performance.now();
    if (snap) {
      e.body.position.copy(e.rp);
      e.body.quaternion.copy(e.rq);
      e.body.interpolatedPosition.copy(e.rp);
      e.body.interpolatedQuaternion.copy(e.rq);
      e.body.velocity.setZero();
      e.body.angularVelocity.setZero();
      e.remote = false;
    }
    e.body.wakeUp();
  }

  function sendCarState(e) {
    const b = e.body;
    net.send({
      t: 'car', id: e.id, op: 'phys',
      p: [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)],
      q: [+b.quaternion.x.toFixed(3), +b.quaternion.y.toFixed(3), +b.quaternion.z.toFixed(3), +b.quaternion.w.toFixed(3)],
      v: [+b.velocity.x.toFixed(2), +b.velocity.y.toFixed(2), +b.velocity.z.toFixed(2)],
    });
  }

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
    body.interpolatedPosition.copy(body.position);
    body.interpolatedQuaternion.copy(body.quaternion);
    if (!mine) body.sleep(); // server-restored / remote props start at rest
    world.addBody(body);
    const mesh = def.build();
    mesh.position.copy(body.position);
    enableShadows(mesh);
    scene.add(mesh);
    const e = { id: prop.id, kind: prop.kind, owner: prop.owner || null, body, mesh, owned: mine, grabbedBy: null, frozen: false };
    props.set(prop.id, e);
    if (prop.kind === 'door') {
      e.inter = { id: `pdoor-${prop.id}`, type: 'fadedoor', x: prop.p[0], z: prop.p[2], r: 2.2, label: 'Door — E opens (owner & friends)', data: { prop: prop.id } };
      W.interactables.push(e.inter);
    }
    if (prop.frozen) setFrozen(e, true);
    return e;
  }
  function remove(id) {
    const e = props.get(id);
    if (!e) return;
    world.removeBody(e.body);
    scene.remove(e.mesh);
    if (e.walkCol) { const i = W.colliders.indexOf(e.walkCol); if (i !== -1) W.colliders.splice(i, 1); }
    if (e.inter) { const i = W.interactables.indexOf(e.inter); if (i !== -1) W.interactables.splice(i, 1); }
    props.delete(id);
  }

  // darkrp freeze: a frozen prop is a STATIC body (solid to cars/props) with
  // a walking collider (solid to feet). Unfreeze to physgun it around again.
  function setFrozen(e, on) {
    const b = e.body;
    e.frozen = on;
    if (on) {
      b.type = CANNON.Body.STATIC;
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.updateAABB();
      // no AABB walk collider for frozen props: a rotated shape's AABB is far
      // bigger than the shape, and displacement-resolving against it teleport-
      // shoved players. clipMove() traces the real geometry instead
      // (source-style: player movement is clipped, never shoved).
      if (e.inter) { e.inter.x = b.position.x; e.inter.z = b.position.z; }
    } else {
      b.type = CANNON.Body.DYNAMIC;
      b.updateMassProperties();
      if (e.walkCol) e.walkCol.off = true;
      b.wakeUp();
    }
  }
  function claim(e) {
    e.owned = true;
    e.remote = false;
    if (e.body.type === CANNON.Body.KINEMATIC) e.body.type = CANNON.Body.DYNAMIC;
    e.body.wakeUp();
  }

  // remote authority: someone else is driving this prop now
  function applyState(m) {
    const e = props.get(m.id);
    if (!e || e.frozen) return;
    e.owned = false;
    e.body.position.set(m.p[0], m.p[1], m.p[2]);
    e.body.quaternion.set(m.q[0], m.q[1], m.q[2], m.q[3]);
    e.body.interpolatedPosition.copy(e.body.position);
    e.body.interpolatedQuaternion.copy(e.body.quaternion);
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

  // shove props out of the way as you walk into them (and take ownership).
  // Source-style rules: only while GROUNDED and actually moving, never a prop
  // you're landing on or standing on, force scales inversely with mass — a
  // box skids away, a heavy crate mostly stands its ground.
  function playerPush(p, dt) {
    if (!p.onGround) return; // no mid-air kicking: jumps land ON props now
    const wv = p.wishVel || p.vel || { x: 0, z: 0 };
    const spd = Math.hypot(wv.x || 0, wv.z || 0);
    if (spd < .4) return; // standing still shouldn't vibrate the furniture
    const px = p.x, py = p.y, pz = p.z;
    for (const e of props.values()) {
      if (e.frozen) continue;
      if (e.grabbedBy && e.grabbedBy !== myId) continue; // don't fight the holder's stream
      const b = e.body;
      if (py > b.aabb.upperBound.y - .45) continue; // landing zone / standing on it
      const dx = b.position.x - px, dz = b.position.z - pz;
      const d = Math.hypot(dx, dz);
      const rad = .34 + (e.kind === 'crate' ? .62 : .42);
      if (d < rad && b.position.y < py + 1.6) {
        const dot = (dx * wv.x + dz * wv.z) / ((d || .01) * spd);
        if (dot < .25) continue; // only props you're walking INTO
        claim(e);
        // velocity-space push (same trick as the cars): cannon's friction
        // solver eats forces AND small impulses on ground-resting bodies, so
        // we steer the velocity directly — boxes skid ahead of you, heavy
        // crates creep, and the solver still owns collisions and toppling
        const tv = Math.min(spd, 4.8) * Math.min(1, 4 / b.mass) * .75;
        const k = Math.min(1, dt * 14);
        b.velocity.x += ((wv.x / spd) * tv - b.velocity.x) * k;
        b.velocity.z += ((wv.z / spd) * tv - b.velocity.z) * k;
        e.pushT = performance.now(); // ground drag stands down while actively pushed
      }
    }
  }

  // melee swing / kick: launch props in front of the player
  function smack(px, py, pz, dirX, dirZ) {
    let hitAny = false;
    for (const e of props.values()) {
      if (e.frozen) continue;
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
    // remote-controlled cars follow their stream kinematically; when the
    // stream dries up (driver left / nudger settled) they go dynamic again
    for (const e of cars.values()) {
      const drivenByMe = e.car.driver != null && e.car.driver === myId;
      const remoteActive = e.remote && performance.now() - e.remoteT < 800;
      if (!drivenByMe && e.rp && (remoteActive || (e.car.driver != null && e.remote))) {
        if (e.body.type !== CANNON.Body.KINEMATIC) {
          e.body.type = CANNON.Body.KINEMATIC;
          e.body.velocity.setZero();
          e.body.angularVelocity.setZero();
        }
        const k = Math.min(1, dt * 12);
        e.body.position.lerp(e.rp, k, e.body.position);
        e.body.quaternion.slerp(e.rq, k, e.body.quaternion);
        e.body.wakeUp();
      } else if (e.body.type === CANNON.Body.KINEMATIC) {
        e.body.type = CANNON.Body.DYNAMIC;
        if (e.rv) e.body.velocity.set(e.rv[0], e.rv[1], e.rv[2]);
        e.remote = false;
        e.body.wakeUp();
      }
    }
    if (playerPos) playerPush(playerPos, dt);
    world.step(1 / 60, dt, 3);
    // cars: visual group, walking collider, and E-prompt follow the body
    for (const e of cars.values()) {
      const b = e.body, car = e.car;
      if (b.position.y < -8 || b.position.x < -80 || b.position.x > 150 || b.position.z < -60 || b.position.z > 188) {
        b.position.x = Math.max(-78, Math.min(148, b.position.x));
        b.position.z = Math.max(-58, Math.min(186, b.position.z));
        b.position.y = 1.2;
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
      // visuals from the interpolated pose (smooth); logic from it too so the
      // camera riding car.x never disagrees with the mesh
      const ip = b.interpolatedPosition, iq = b.interpolatedQuaternion;
      const off = iq.vmult(V(0, CAR_HH, 0));
      car.group.position.set(ip.x - off.x, ip.y - off.y, ip.z - off.z);
      car.group.quaternion.copy(iq);
      const f = iq.vmult(V(0, 0, 1));
      car.ry = Math.atan2(f.x, f.z);
      car.x = ip.x;
      car.z = ip.z;
      // walking collider from the body's true AABB — correct even when the
      // car ends up tilted or on its roof (physgun aftermath)
      b.updateAABB();
      car.col.x0 = b.aabb.lowerBound.x; car.col.x1 = b.aabb.upperBound.x;
      car.col.z0 = b.aabb.lowerBound.z; car.col.z1 = b.aabb.upperBound.z;
      if (car.inter) { car.inter.x = car.x; car.inter.z = car.z; }
    }
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
      // depenetration insurance: with zero ground friction, a prop expelled
      // from inside geometry can be launched — clamp runaway horizontal speed
      {
        const hv = Math.hypot(b.velocity.x, b.velocity.z);
        if (hv > 24) { b.velocity.x *= 24 / hv; b.velocity.z *= 24 / hv; }
      }
      // manual sliding friction: cannon's friction is weak on light bodies
      // (they ice-skate) and sticky on heavy ones — apply believable ground
      // drag ourselves. Balls keep rolling; held props are the holder's problem.
      if (!e.frozen && !e.grabbedBy && b.sleepState !== CANNON.Body.SLEEPING &&
          Math.abs(b.velocity.y) < .7 && b.position.y < 1.4 &&
          (!e.pushT || performance.now() - e.pushT > 130)) {
        const drag = (e.kind === 'ball' || e.kind === 'melon') ? .55 : .06;
        const f = Math.pow(drag, dt);
        b.velocity.x *= f;
        b.velocity.z *= f;
      }
      // interpolated pose: fixed-step positions quantize to 60Hz and read as
      // chop against an unaligned rAF — cannon keeps smooth in-between values
      e.mesh.position.copy(b.interpolatedPosition);
      e.mesh.quaternion.copy(b.interpolatedQuaternion);
    }
    // stream my awake props + driverless cars I've been shoving, at ~12Hz
    sendT += dt;
    if (sendT > .085) {
      sendT = 0;
      for (const e of props.values()) {
        if (e.owned && !e.frozen && e.body.sleepState !== CANNON.Body.SLEEPING) sendState(e);
      }
      for (const e of cars.values()) {
        if (e.owned && !e.car.driver && e.body.type === CANNON.Body.DYNAMIC && e.body.sleepState !== CANNON.Body.SLEEPING) sendCarState(e);
      }
    }
  }

  function raycast(raycaster, maxDist = 14) {
    const roots = [], entries = [];
    for (const e of props.values()) { roots.push(e.mesh); entries.push(e); }
    for (const e of cars.values()) if (!e.car.driver) { roots.push(e.car.group); entries.push(e); }
    const hits = raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      if (h.distance > maxDist) break;
      let o = h.object;
      while (o && !roots.includes(o)) o = o.parent;
      if (!o) continue;
      return { e: entries[roots.indexOf(o)], point: h.point, distance: h.distance };
    }
    return null;
  }

  // gmod-style physgun grip: the grab anchor is WHERE you clicked the object,
  // not its center — store it body-local, drag that point to the crosshair
  const yawQ = new CANNON.Quaternion();
  const invQ = new CANNON.Quaternion();
  function grabLocal(e, wx, wy, wz) {
    const b = e.body;
    e.body.quaternion.conjugate(invQ); // unit quat: conjugate == inverse
    const rel = new CANNON.Vec3(wx - b.position.x, wy - b.position.y, wz - b.position.z);
    return invQ.vmult(rel);
  }
  const anchorTmp = new CANNON.Vec3();
  function anchorWorld(e, local, out) {
    e.body.quaternion.vmult(local, anchorTmp);
    out.set(e.body.position.x + anchorTmp.x, e.body.position.y + anchorTmp.y, e.body.position.z + anchorTmp.z);
    return out;
  }
  function rotateBody(e, ax, ay, az, angle, local = null) { // world-axis rotation about the grab anchor
    const b = e.body;
    yawQ.setFromAxisAngle(V(ax, ay, az), angle);
    if (local) {
      const aw = new CANNON.Vec3();
      b.quaternion.vmult(local, anchorTmp);
      aw.set(b.position.x + anchorTmp.x, b.position.y + anchorTmp.y, b.position.z + anchorTmp.z);
      yawQ.mult(b.quaternion, b.quaternion);
      b.quaternion.vmult(local, anchorTmp);
      b.position.set(aw.x - anchorTmp.x, aw.y - anchorTmp.y, aw.z - anchorTmp.z);
    } else yawQ.mult(b.quaternion, b.quaternion);
  }
  // hard-set orientation while keeping the grab anchor pinned in world space —
  // the physgun's view-relative grip drives this every frame
  function setQuatAnchored(e, qx, qy, qz, qw, local = null) {
    const b = e.body;
    if (local) {
      const aw = new CANNON.Vec3();
      b.quaternion.vmult(local, anchorTmp);
      aw.set(b.position.x + anchorTmp.x, b.position.y + anchorTmp.y, b.position.z + anchorTmp.z);
      b.quaternion.set(qx, qy, qz, qw);
      b.quaternion.vmult(local, anchorTmp);
      b.position.set(aw.x - anchorTmp.x, aw.y - anchorTmp.y, aw.z - anchorTmp.z);
    } else b.quaternion.set(qx, qy, qz, qw);
  }
  function yawBody(e, dyaw, local = null) {
    const b = e.body;
    yawQ.setFromAxisAngle(V(0, 1, 0), dyaw);
    if (local) { // rotate ABOUT the grab anchor, like gmod
      const aw = new CANNON.Vec3();
      b.quaternion.vmult(local, anchorTmp);
      aw.set(b.position.x + anchorTmp.x, b.position.y + anchorTmp.y, b.position.z + anchorTmp.z);
      yawQ.mult(b.quaternion, b.quaternion);
      b.quaternion.vmult(local, anchorTmp);
      b.position.set(aw.x - anchorTmp.x, aw.y - anchorTmp.y, aw.z - anchorTmp.z);
    } else yawQ.mult(b.quaternion, b.quaternion);
  }

  // dynamically placed base pieces need real static bodies (cars must crash
  // into fresh walls, not phase through until reload)
  function addStatic(x0, x1, z0, z1, y0, y1) {
    const b = new CANNON.Body({
      type: CANNON.Body.STATIC, material: groundMat,
      shape: new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)),
    });
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    world.addBody(b);
    return b;
  }
  function removeStatic(b) { world.removeBody(b); }

  return {
    world, props, cars, add, remove, claim, applyState, applyCarState, sendState, sendCarState,
    drive, step, smack, raycast, yawBody, rotateBody, setQuatAnchored, grabLocal, anchorWorld,
    addStatic, removeStatic, setFrozen, addCar, groundAt, resolvePlayer, clipMove, stomp, PHYS_KINDS,
    setMyId(id) { myId = id; },
  };
}
