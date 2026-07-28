// Builds the break room from many trips to the real break room:
//  west (x=-38): glass entrance, lounge (couches w/ tape outlines, rug, giant Connect 4, bookshelves)
//  games corner: 2 JOOLA-style ping pong tables, arcade cabinet, chess table
//  center/east: long rows of folding tables, chairs color-zoned green→brown→orange→yellow
//  east wall (x=38): "avenue C" micro-market — coolers, snack walls, kiosks; Pepsi machines + lockers north
import * as THREE from 'three';
import * as TX from './textures.js';

export const W = { // world registry
  colliders: [],       // {x0,x1,z0,z1}
  seats: [],           // {id, x, z, y, ry, type}
  interactables: [],   // {id, type, x, z, r, label, data}
  pick: { c4: {}, chess: [], ground: null },
  anchors: {},         // named positions/groups for minigames
  dynamic: {},         // tv/clock updaters
  camBlockers: [],     // meshes the 3rd-person camera must not clip through
};
const blocker = (m) => { W.camBlockers.push(m); return m; };

const M = {}; // shared materials
function mats() {
  M.wall = new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: .9 });
  M.wallDark = new THREE.MeshStandardMaterial({ color: 0x83868a, roughness: .9 });
  M.white = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: .85 });
  M.blueSoffit = new THREE.MeshStandardMaterial({ color: 0xa7c4d4, roughness: .85 });
  M.yellowTrim = new THREE.MeshStandardMaterial({ color: 0xd9b93c, roughness: .7 });
  M.blackMetal = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: .5, metalness: .4 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: .25, metalness: .9 });
  M.tableTop = new THREE.MeshStandardMaterial({ color: 0x3b3733, roughness: .55 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0xa8c8dc, roughness: .05, metalness: .1, transparent: true, opacity: .16, side: THREE.DoubleSide });
  M.mullion = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: .6, metalness: .3 });
  M.chairGreen = new THREE.MeshStandardMaterial({ color: 0x9bc11e, roughness: .6 });
  M.chairBrown = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: .6 });
  M.chairOrange = new THREE.MeshStandardMaterial({ color: 0xd96820, roughness: .6 });
  M.chairYellow = new THREE.MeshStandardMaterial({ color: 0xe0b110, roughness: .6 });
  M.leather = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: .45 });
  M.wood = new THREE.MeshStandardMaterial({ map: TX.woodTexture(), roughness: .8 });
  M.woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: .8 });
  M.pongTop = new THREE.MeshStandardMaterial({ color: 0x1d3a6e, roughness: .6 });
  M.ceiling = new THREE.MeshStandardMaterial({ color: 0xdfe1e3, roughness: .95 });
}

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 14) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
};
const collide = (x, z, w, d, pad = 0) => W.colliders.push({ x0: x - w / 2 - pad, x1: x + w / 2 + pad, z0: z - d / 2 - pad, z1: z + d / 2 + pad });
const inter = (o) => W.interactables.push(o);

// ============================================================ ROOM SHELL
function shell(scene) {
  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(76, 34), new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: .32, metalness: .12 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  W.pick.ground = floor;

  // high structural slab over everything
  scene.add(blocker(box(76, .2, 34, M.ceiling, 0, 6.3, 0)));

  // ---- dining ceiling (x -12..38): white acoustic tile field at 4.9 with
  // recessed higher sections framed in yellow fascia (from trips) ----
  const tile = TX.ct(512, 512, (g, w, h) => {
    g.fillStyle = '#eceeef'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9ccd0'; g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
    }
  });
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
  tile.repeat.set(.204, .204); // one 8-cell texture ≈ 4.9 m → 0.61 m tiles
  const RECESSES = [[-4, 0, 14, 10], [13, 0, 12, 9], [27.5, 0, 9.5, 8]]; // cx, cz, w, d
  const field = new THREE.Shape();
  field.moveTo(-12, -17); field.lineTo(38, -17); field.lineTo(38, 17); field.lineTo(-12, 17); field.closePath();
  for (const [cx, cz, cw, cd] of RECESSES) {
    const hole = new THREE.Path();
    hole.moveTo(cx - cw / 2, cz - cd / 2); hole.lineTo(cx + cw / 2, cz - cd / 2);
    hole.lineTo(cx + cw / 2, cz + cd / 2); hole.lineTo(cx - cw / 2, cz + cd / 2); hole.closePath();
    field.holes.push(hole);
  }
  const fieldMesh = new THREE.Mesh(new THREE.ShapeGeometry(field), new THREE.MeshStandardMaterial({ map: tile, roughness: .95, side: THREE.DoubleSide }));
  fieldMesh.rotation.x = Math.PI / 2;
  fieldMesh.position.y = 4.9;
  scene.add(blocker(fieldMesh));
  for (const [cx, cz, cw, cd] of RECESSES) {
    // recessed white upper ceiling; light-blue fascia band with a yellow
    // accent stripe at its base (walk-through shows blue-edged clouds)
    scene.add(blocker(box(cw, .1, cd, M.white, cx, 5.75, cz)));
    scene.add(box(cw + .16, .8, .1, M.blueSoffit, cx, 5.35, cz - cd / 2));
    scene.add(box(cw + .16, .8, .1, M.blueSoffit, cx, 5.35, cz + cd / 2));
    scene.add(box(.1, .8, cd + .16, M.blueSoffit, cx - cw / 2, 5.35, cz));
    scene.add(box(.1, .8, cd + .16, M.blueSoffit, cx + cw / 2, 5.35, cz));
    scene.add(box(cw + .2, .12, .12, M.yellowTrim, cx, 4.96, cz - cd / 2));
    scene.add(box(cw + .2, .12, .12, M.yellowTrim, cx, 4.96, cz + cd / 2));
    scene.add(box(.12, .12, cd + .2, M.yellowTrim, cx - cw / 2, 4.96, cz));
    scene.add(box(.12, .12, cd + .2, M.yellowTrim, cx + cw / 2, 4.96, cz));
    // suspended linear fixtures inside each recess
    const lin0 = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .85 });
    for (const oz of [-cd / 4, cd / 4]) scene.add(box(cw * .7, .08, .15, lin0, cx, 5.15, cz + oz));
  }

  // ---- big sloped blue-gray soffit at the tall-section transition (from trips) ----
  const slope = box(.16, 3.0, 34, M.blueSoffit, 0, 0, 0);
  slope.rotation.z = -.55;
  slope.position.set(-12.7, 5.45, 0);
  scene.add(blocker(slope));
  scene.add(box(.14, .14, 34, M.yellowTrim, -13.5, 4.88, 0)); // yellow trim at its base
  scene.add(box(24, .5, 1.0, M.blueSoffit, -26, 5.55, -8.6));
  scene.add(box(24, .5, 1.0, M.blueSoffit, -26, 5.55, 8.6));

  // walls — north (z=-17): glass only at the lounge corner; the games/dining
  // stretch is solid gray with the emergency-exit door + arcade (from trips)
  wallWithWindows(scene, { axis: 'z', at: -17, from: -38, to: -30 });
  scene.add(blocker(box(16.7, 6.2, .3, M.wallDark, -21.65, 3.1, -17)));
  // solid through to the corridor opening — the hallway (restrooms, microwaves,
  // smoke cage) is reached through the wide walkway, not an emergency door
  scene.add(blocker(box(3.4, 6.2, .3, M.wallDark, -11.65, 3.1, -17)));
  // wide corridor opening at x 12..17 into the service hallway (from trips)
  scene.add(blocker(box(22, 6.2, .3, M.wall, 1, 3.1, -17)));
  scene.add(blocker(box(21, 6.2, .3, M.wall, 27.5, 3.1, -17)));
  scene.add(blocker(box(5.4, 3.6, .3, M.wall, 14.5, 4.4, -17)));
  // metal corner guards on the opening (from trips)
  scene.add(box(.12, 2.6, .35, M.chrome, 12.05, 1.3, -17));
  scene.add(box(.12, 2.6, .35, M.chrome, 16.95, 1.3, -17));
  collide(-21.65, -17.1, 16.7, .6); collide(-11.65, -17.1, 3.4, .6);
  collide(1, -17.1, 22, .6); collide(27.5, -17.1, 21, .6);
  serviceHallway(scene);
  // south (z=17): long glass run with parking outside (from trips) and a second
  // set of entry doors near the market end (from trips), wall far east
  wallWithWindows(scene, { axis: 'z', at: 17, from: -38, to: 10, doorAt: 6, doorW: 2.0 });
  // these south doors are emergency-exit-only: closed leaves + signage + sealed
  const sSignM = new THREE.MeshBasicMaterial({ map: emergencySignTexture() });
  for (const s of [-1, 1]) {
    scene.add(box(.95, 2.5, .07, M.glass, 6 + s * .5, 1.3, 16.95));
    scene.add(box(1.4, .08, .1, M.blackMetal, 6 + s * .5, 1.0, 16.85));
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(.6, .3), sSignM);
    sg.rotation.y = Math.PI; sg.position.set(6 + s * .5, 1.9, 16.88);
    scene.add(sg);
  }
  collide(6, 16.95, 2.3, .5);
  scene.add(blocker(box(28, 6.2, .3, M.wall, 24, 3.1, 17)));
  collide(24, 17.1, 28, .6);
  // east wall (x=38): wide open passage into the locker/wellness annex (from trips)
  scene.add(blocker(box(.3, 6.2, 14.5, M.wall, 38, 3.1, -9.75)));
  scene.add(blocker(box(.3, 6.2, 12.8, M.wall, 38, 3.1, 10.6)));
  scene.add(blocker(box(.3, 2.3, 6.7, M.wall, 38, 5.05, .85)));   // header over the opening
  scene.add(box(.24, .55, 6.7, M.blueSoffit, 38, 3.65, .85));     // blue accent band (from trips)
  collide(38.1, -9.75, .6, 14.5); collide(38.1, 10.6, .6, 12.8);
  // close the height step between cafeteria (6.2) and the taller hall (7.2)
  scene.add(blocker(box(.3, 1.1, 34, M.white, 38, 6.75, 0)));
  // double doors propped open at the passage (from trips) + flags + clock above
  for (const [dz, ry] of [[-2.7, .95], [4.4, -.95]]) {
    const leaf = box(.08, 2.3, 1.5, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: .7 }), 0, 1.15, 0);
    leaf.add(box(.09, .5, .5, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .3, metalness: .5 }), 0, -.7, 0)); // kick plate
    const lg = new THREE.Group();
    lg.add(leaf);
    leaf.position.set(0, 1.15, .75); // stand on the floor (0 sank it halfway in)
    lg.position.set(38.2, 0, dz); lg.rotation.y = ry;
    scene.add(lg);
  }
  for (const [i, f] of ['fiji', 'puertorico', 'kyrgyzstan', 'spain'].entries()) {
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .85), new THREE.MeshStandardMaterial({ map: TX.flagTexture(f), side: THREE.DoubleSide, roughness: .9 }));
    fl.rotation.y = -Math.PI / 2;
    fl.position.set(37.7, 4.9, -1.6 + i * 1.55);
    scene.add(fl);
  }
  // west glass curtain wall with entrance gap z -2..2
  wallWithWindows(scene, { axis: 'x', at: -38, from: -17, to: -2, tall: true });
  wallWithWindows(scene, { axis: 'x', at: -38, from: 2, to: 17, tall: true });
  entrance(scene);

  // interior gray column pair (from trips)
  for (const z of [-6, 6]) { scene.add(blocker(box(1, 6.2, 1, M.white, -10, 3.1, z))); collide(-10, z, 1, 1); }

  // pendant dome lights + linear fixtures (emissive, no real lights for perf)
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0xfff6d8, emissiveIntensity: .55, roughness: .4 });
  const dome = new THREE.CylinderGeometry(.02, .26, .3, 12, 1, true);
  const bulb = new THREE.SphereGeometry(.09, 8, 6);
  const cable = new THREE.CylinderGeometry(.012, .012, 1, 4);
  const dGroup = new THREE.Group();
  const hang = (x, z, hangY, fromY) => {
    const c = new THREE.Mesh(cable, M.blackMetal); c.scale.y = fromY - hangY; c.position.set(x, (fromY + hangY) / 2, z); dGroup.add(c);
    const d = new THREE.Mesh(dome, domeMat); d.position.set(x, hangY, z); dGroup.add(d);
    const b = new THREE.Mesh(bulb, domeMat); b.position.set(x, hangY - .04, z); dGroup.add(b);
  };
  // tall games/lounge section: dense rows of long-drop pendants (from trips)
  for (let gx = -36; gx <= -15; gx += 4.2) for (let gz = -14.5; gz <= 15; gz += 5.8) hang(gx, gz, 3.35, 6.2);
  // dining: pendants drop below the tile ceiling along the rows (from trips)
  for (let gx = -9; gx <= 36; gx += 6.4) for (let gz = -13.5; gz <= 13.5; gz += 6.6) hang(gx, gz, 3.95, 4.9);
  scene.add(dGroup);
  // long continuous linear fluorescent runs (suspended twin tubes)
  const lin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .8 });
  for (const gz of [-9.8, -3.3, 3.3, 9.8]) for (let gx = -9; gx <= 33; gx += 7.4)
    scene.add(box(5.6, .09, .16, lin, gx, 4.62, gz));
  for (const gz of [-11, 0, 11]) for (let gx = -35; gx <= -16; gx += 6.5)
    scene.add(box(4.4, .09, .16, lin, gx, 5.0, gz));
}

function wallWithWindows(scene, { axis, at, from, to, doorAt = null, doorW = 0, tall = false }) {
  const H = tall ? 6.2 : 6.2, sillH = .55, headH = tall ? 5.6 : 4.4;
  const len = to - from, mid = (from + to) / 2;
  const mk = (w, h, d, px, py) => {
    const m = axis === 'z' ? box(w, h, .3, M.wall, px, py, at) : box(.3, h, w, M.wall, at, py, px);
    scene.add(blocker(m));
  };
  // sill + header (sill split around a door opening)
  if (doorAt !== null) {
    const s0 = [from, doorAt - doorW / 2], s1 = [doorAt + doorW / 2, to];
    for (const [a, b] of [s0, s1]) mk(b - a, sillH, .3, (a + b) / 2, sillH / 2);
  } else {
    mk(len, sillH, .3, mid, sillH / 2);
  }
  mk(len, H - headH, .3, mid, (H + headH) / 2);
  // glass + mullions (glass split around a door opening; transom above it stays)
  const glassSegs = doorAt !== null
    ? [[from, doorAt - doorW / 2, sillH, headH], [doorAt + doorW / 2, to, sillH, headH], [doorAt - doorW / 2, doorAt + doorW / 2, 2.55, headH]]
    : [[from, to, sillH, headH]];
  for (const [a, b, lo, hi] of glassSegs) {
    const gm = (b + a) / 2, gl = b - a;
    const glass = axis === 'z'
      ? box(gl, hi - lo, .06, M.glass, gm, (hi + lo) / 2, at)
      : box(.06, hi - lo, gl, M.glass, at, (hi + lo) / 2, gm);
    scene.add(glass);
  }
  if (doorAt !== null) {
    for (const s of [-1, 1]) {
      const post = axis === 'z'
        ? box(.14, 2.6, .22, M.mullion, doorAt + s * doorW / 2, 1.3, at)
        : box(.22, 2.6, .14, M.mullion, at, 1.3, doorAt + s * doorW / 2);
      scene.add(post);
    }
  }
  for (let p = from; p <= to; p += 2.2) {
    const m = axis === 'z' ? box(.12, headH - sillH, .18, M.mullion, p, (headH + sillH) / 2, at) : box(.18, headH - sillH, .12, M.mullion, at, (headH + sillH) / 2, p);
    scene.add(m);
  }
  const hbar = axis === 'z' ? box(len, .12, .18, M.mullion, mid, 2.6, at) : box(.18, .12, len, M.mullion, at, 2.6, mid);
  scene.add(hbar);
  // collider (with optional door gap)
  if (axis === 'z') {
    if (doorAt !== null) {
      W.colliders.push({ x0: from, x1: doorAt - doorW / 2, z0: at - .3, z1: at + .3 });
      W.colliders.push({ x0: doorAt + doorW / 2, x1: to, z0: at - .3, z1: at + .3 });
    } else W.colliders.push({ x0: from, x1: to, z0: at - .3, z1: at + .3 });
  } else {
    if (doorAt !== null) {
      W.colliders.push({ x0: at - .3, x1: at + .3, z0: from, z1: doorAt - doorW / 2 });
      W.colliders.push({ x0: at - .3, x1: at + .3, z0: doorAt + doorW / 2, z1: to });
    } else W.colliders.push({ x0: at - .3, x1: at + .3, z0: from, z1: to });
  }
}

// ============================================================ LOCKER HALLWAY (z 17..31, x 58..92)
// site plan: the lockers strip sits between the security block (north) and
// the cafeteria (south). You come south through the PAE2 detector lanes, walk a
// straight aisle flanked by tan locker banks (from trips) and reach the
// cafeteria double doors at z=31.
function lockerHall(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 14), new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: .38, metalness: .08 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(75, .0012, 24);
  scene.add(floor);
  // west wall + small north stub (x 58..62 at z=17) + east face at x=92
  scene.add(blocker(box(.3, 5.2, 14, M.white, 58, 2.6, 24)));
  collide(58, 24, .6, 14);
  scene.add(blocker(box(4.3, 5.2, .3, M.white, 60.05, 2.6, 17)));
  collide(60.05, 17, 4.3, .6);
  scene.add(blocker(box(.3, 5.2, 14, M.white, 92, 2.6, 24)));
  collide(92, 24, .6, 14);
  // high window band on the east face (building front)
  for (const wz of [19.5, 24, 28.5]) scene.add(box(.12, 1.1, 3.4, M.glass, 91.8, 3.9, wz));
  // ceiling: white deck + joists + fabric ducts + linear lights
  scene.add(blocker(box(34.4, .2, 14.4, M.white, 75, 5.2, 24)));
  for (let jz = 18; jz <= 30; jz += 4) scene.add(box(34, .45, .18, new THREE.MeshStandardMaterial({ color: 0xdcdee0, roughness: .9 }), 75, 4.9, jz));
  const ductM = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: .85 });
  for (const dx of [66, 84]) {
    const duct = cyl(.44, .44, 13, ductM, dx, 4.55, 24, 14);
    duct.rotation.x = Math.PI / 2;
    scene.add(duct);
  }
  const lin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .85 });
  for (const lx of [62, 68, 74, 80, 86, 90]) for (const lz of [20, 27.5]) scene.add(box(1.3, .1, .35, lin, lx, 4.5, lz));
  // hanging blue disc speaker
  scene.add(cyl(.4, .34, .18, new THREE.MeshStandardMaterial({ color: 0x3aa0dd, roughness: .6 }), 81, 4.1, 22, 12));
  scene.add(cyl(.012, .012, 1.0, M.blackMetal, 81, 4.7, 22, 4));

  // ---- locker banks ----
  // west zone: back-to-back island columns (aisles run north-south)
  for (const cx of [60.3, 63.3]) {
    for (const zz of [20.2, 22.25, 24.3, 26.35, 28.4]) {
      lockers(scene, cx - .27, zz, -Math.PI / 2);
      lockers(scene, cx + .27, zz, Math.PI / 2);
    }
    scene.add(box(1.3, 1.9, .12, new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: .8 }), cx, .95, 19.12));
  }
  // east zone: two columns below the entry lobby
  for (const cx of [84.5, 87.5]) {
    for (const zz of [21.3, 23.35, 25.4, 27.45]) {
      lockers(scene, cx - .27, zz, -Math.PI / 2);
      lockers(scene, cx + .27, zz, Math.PI / 2);
    }
    scene.add(box(1.3, 1.9, .12, new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: .8 }), cx, .95, 20.22));
  }
  // wall bank along the south wall west of the cafeteria doors
  for (let i = 0; i < 5; i++) lockers(scene, 60.2 + i * 2.1, 30.35, Math.PI);

  // "Lockers & Locks" column sign mid-hall
  scene.add(blocker(box(.7, 5.2, .7, M.white, 66.2, 2.6, 24)));
  collide(66.2, 24, .8, .8);
  const llTex = TX.ct(160, 200, (g, w, h) => {
    g.fillStyle = '#232f3e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Lockers &', w / 2, 88); g.fillText('Locks 🔒', w / 2, 116);
  });
  const ll = new THREE.Mesh(new THREE.PlaneGeometry(.55, .7), new THREE.MeshBasicMaterial({ map: llTex }));
  ll.rotation.y = Math.PI; ll.position.set(66.2, 2.1, 24.38);
  scene.add(ll);
  // Lockers pennant + EXIT sign facing the walkway
  const lkTex = TX.ct(160, 160, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w / 2, h); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = '600 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Lockers', w / 2, 50);
  });
  for (const s of [1, -1]) {
    const lkSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: lkTex, transparent: true }));
    if (s === -1) lkSign.rotation.y = Math.PI;
    lkSign.position.set(68.5, 4.3, 19.4 + s * .01);
    scene.add(lkSign);
  }
  const exTex2 = TX.ct(128, 48, (g, w, h) => { g.fillStyle = '#200'; g.fillRect(0, 0, w, h); g.fillStyle = '#f33'; g.font = '900 30px Arial'; g.textAlign = 'center'; g.fillText('EXIT', w / 2, 36); });
  const ex2 = new THREE.Mesh(new THREE.PlaneGeometry(.6, .24), new THREE.MeshBasicMaterial({ map: exTex2 }));
  ex2.position.set(68.5, 2.95, 17.25);
  scene.add(ex2);

  // gray prep table + cart just past the screening lanes (from trips)
  scene.add(box(1.5, .05, .65, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .5, metalness: .3 }), 77.6, .74, 18.5));
  for (const [lx3, lz3] of [[-.55, -.22], [.55, -.22], [-.55, .22], [.55, .22]]) scene.add(cyl(.02, .02, .72, M.blackMetal, 77.6 + lx3, .37, 18.5 + lz3, 6));
  collide(77.6, 18.5, 1.6, .75);
  scene.add(box(1.0, .95, .55, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .5, metalness: .4 }), 90.8, .48, 18.3));
  collide(90.8, 18.3, 1.1, .65);
  // hi-vis coat rack + mop bucket + trash
  const rack = new THREE.Group();
  rack.add(cyl(.03, .04, 1.7, M.blackMetal, 0, .85, 0, 8));
  rack.add(box(.8, .04, .04, M.blackMetal, 0, 1.68, 0));
  rack.add(box(.5, .62, .12, new THREE.MeshStandardMaterial({ color: 0xd3e50b, roughness: .6 }), .2, 1.3, 0));
  rack.position.set(90.9, 0, 29.2);
  scene.add(rack);
  collide(90.9, 29.2, .9, .5);
  scene.add(cyl(.22, .18, .5, new THREE.MeshStandardMaterial({ color: 0xf2c521, roughness: .6 }), 58.85, .25, 21.4, 10)); // mop bucket by the west wall, not mid-walkway
  trash(scene, 58.9, 18.2, 0x6a6e73);
  // yellow/green hazard square by the assessment spot
  const hz2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: TX.hazardSquareTexture(), transparent: true }));
  hz2.rotation.x = -Math.PI / 2; hz2.position.set(82.5, .013, 25.5);
  scene.add(hz2);
}

// ============================================================ SECURITY ROOM (x 62..80)
// From break-room trips: the white PAE2 soffit structure is a
// FREESTANDING ISLAND in the middle of the room — curved mural desk wrapping its
// SE corner facing the gates, metal-detector lanes through its west side. Behind it
// (north wall) sit the Safe to Go arch into the FC, the elevator, the US flag and
// One Soul banner. The blue mountain mural (west wall) holds the locker-hall
// doorway; secondary screening is a single detector + table in the southwest.
function securityLobby(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 34), new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: .38, metalness: .08 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(77, .001, 0);
  scene.add(floor);
  const blueWall = new THREE.MeshStandardMaterial({ color: 0x3a86c8, roughness: .85 });
  const structM = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: .9 });
  const detM = new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: .5, metalness: .3 });

  // ---- ceiling: high white deck + joists + linear lights ----
  scene.add(blocker(box(30.2, .2, 34.2, M.white, 77, 8.4, 0)));
  for (let jx = 64; jx <= 90; jx += 5) scene.add(box(.18, .55, 34, new THREE.MeshStandardMaterial({ color: 0xdcdee0, roughness: .9 }), jx, 8.0, 0));
  const lin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .85 });
  for (const lx of [64, 70, 76, 82, 88]) for (const lz of [-11, -4, 4, 11]) scene.add(box(1.4, .1, .38, lin, lx, 7.2, lz));
  scene.add(blocker(box(.3, 1.4, 34, M.white, 62, 7.7, 0)));

  // ---- NORTH WALL (z=-17): solid white by the elevator, blue at Day One / Career ----
  scene.add(blocker(box(11.5, 5.9, .3, structM, 67.75, 5.45, -17)));  // white header 62..73.5
  scene.add(blocker(box(18.5, 5.9, .3, blueWall, 82.75, 5.45, -17))); // blue header 73.5..92
  scene.add(blocker(box(12.2, 2.5, .3, structM, 68.1, 1.25, -17)));   // 62..74.2 (solid, elevator wall)
  scene.add(blocker(box(1.2, 2.5, .3, blueWall, 76.2, 1.25, -17)));   // 75.6..76.8 pier
  scene.add(blocker(box(13.8, 2.5, .3, blueWall, 85.1, 1.25, -17)));  // 78.2..92
  collide(68.1, -17.1, 12.2, .6);
  collide(76.2, -17.1, 1.2, .6); collide(85.1, -17.1, 13.8, .6);

  // elevator doors on the north wall (right of the arch corner)
  scene.add(box(2.0, 2.35, .12, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .35, metalness: .6 }), 68.5, 1.18, -16.86));
  scene.add(box(.05, 2.2, .1, new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: .5 }), 68.5, 1.15, -16.8));
  scene.add(box(.14, .2, .06, new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: .4 }), 69.7, 1.1, -16.8));
  const elTex = TX.ct(192, 48, (g, w, h) => {
    g.fillStyle = '#232f3e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 24px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('ELEVATOR', w / 2, 33);
  });
  const elS = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .3), new THREE.MeshBasicMaterial({ map: elTex }));
  elS.position.set(68.5, 2.72, -16.8);
  scene.add(elS);
  // red fire strobe beside the Day One door (from trips)
  scene.add(box(.18, .26, .12, new THREE.MeshStandardMaterial({ color: 0xc22127, roughness: .5 }), 78.6, 2.2, -16.86));

  // ---- WEST WALL (x=62): solid mountain/airplane mural with the FC arch opening
  // (z -12..-6). The FC mass lies west of here (site plan). ----
  scene.add(blocker(box(.3, 7.2, 5, M.white, 62, 3.6, -14.5)));    // z -17..-12
  scene.add(blocker(box(.3, 7.2, 23, M.white, 62, 3.6, 5.5)));     // z -6..17
  scene.add(blocker(box(.3, 2.8, 6, M.white, 62, 5.8, -9)));       // header over the FC opening
  collide(62.1, -14.5, .6, 5); collide(62.1, 5.5, .6, 23);
  const muralW = TX.ct(1024, 512, (g, w, h) => {
    g.fillStyle = '#2a6db8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8eef4';
    g.beginPath(); g.moveTo(0, h); g.lineTo(w * .18, h * .35); g.lineTo(w * .33, h * .8); g.lineTo(w * .48, h * .25); g.lineTo(w * .66, h); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(w * .3, h * .18, 70, 22, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * .55, h * .12, 90, 26, 0, 0, 7); g.fill();
    g.fillStyle = '#f2f5f8';
    for (const [px, py, rot] of [[w * .68, h * .3, -.3], [w * .8, h * .5, .2], [w * .88, h * .22, -.15]]) {
      g.save(); g.translate(px, py); g.rotate(rot);
      g.fillRect(-30, -3, 60, 7); g.fillRect(-7, -16, 14, 32);
      g.restore();
    }
    g.fillStyle = '#d95436';
    g.beginPath(); g.arc(w * .12, h * .3, 26, 0, 7); g.fill();
    g.fillRect(w * .12 - 8, h * .3 + 26, 16, 12);
  });
  const muralMat = new THREE.MeshStandardMaterial({ map: muralW });
  for (const [mz, mw] of [[-14.5, 4.9], [5.5, 22.9]]) {
    const mp = new THREE.Mesh(new THREE.PlaneGeometry(mw, 4.6), muralMat);
    mp.rotation.y = Math.PI / 2; mp.position.set(62.32, 4.9, mz);
    scene.add(mp);
  }
  const mpH = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 2.7), muralMat);
  mpH.rotation.y = Math.PI / 2; mpH.position.set(62.34, 5.85, -9);
  scene.add(mpH);
  for (const [lz, lw] of [[-14.5, 4.7], [5.5, 22.7]]) {
    const low = new THREE.Mesh(new THREE.PlaneGeometry(lw, 2.7), new THREE.MeshStandardMaterial({ color: 0x2a6db8 }));
    low.rotation.y = Math.PI / 2; low.position.set(62.32, 1.32, lz);
    scene.add(low);
  }
  // hanging US flag + Pack One Goal banner flanking the arch (from trips)
  const usFlag = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.7), new THREE.MeshStandardMaterial({ map: TX.flagTexture('usa'), side: THREE.DoubleSide }));
  usFlag.rotation.y = Math.PI / 2;
  usFlag.position.set(62.5, 5.8, -13.9);
  scene.add(usFlag);
  const soulTex = TX.ct(384, 224, (g, w, h) => {
    g.fillStyle = '#7ec3e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b4a7a'; g.font = '700 26px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Pack        One Goal', w / 2, 44);
    g.beginPath(); g.arc(w / 2, 100, 44, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '600 17px "Segoe UI", sans-serif';
    g.fillText('PAE2', w / 2, 96); g.fillText('SEAWOLVES', w / 2, 116);
    g.fillStyle = '#1b4a7a'; g.font = '600 20px "Segoe UI", sans-serif';
    g.fillText('One Year Anniversary', w / 2, 190);
  });
  const soul = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.35), new THREE.MeshStandardMaterial({ map: soulTex, side: THREE.DoubleSide }));
  soul.rotation.y = Math.PI / 2;
  soul.position.set(62.5, 5.7, -3.9);
  scene.add(soul);

  // ---- FC ENTRANCE (west wall z -12..-6): navy Safe to Go arch facing the gates,
  // dark FC vestibule beyond with the SEAWOLVES hedge + orca + TV wall ----
  const darkFC = new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: .95 });
  scene.add(box(5.5, .1, 6.4, darkFC, 59.2, .005, -9));
  scene.add(blocker(box(5.5, 4.2, .25, M.wallDark, 59.2, 2.1, -12.4)));
  scene.add(blocker(box(5.5, 4.2, .25, M.wallDark, 59.2, 2.1, -5.6)));
  scene.add(blocker(box(.25, 4.2, 7, M.wallDark, 56.5, 2.1, -9)));
  scene.add(box(5.8, .2, 7, M.wallDark, 59.2, 4.2, -9));
  collide(59.2, -12.4, 5.6, .5); collide(59.2, -5.6, 5.6, .5); collide(56.5, -9, .5, 7.2);
  const swTex = TX.ct(512, 160, (g, w, h) => {
    g.fillStyle = '#2e6b34'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#255728';
    for (let i = 0; i < 140; i++) { g.beginPath(); g.arc(Math.sin(i * 91.7) * .5 * w + w / 2, (i * 37) % h, 7, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = '900 56px "Segoe UI", Arial'; g.textAlign = 'center';
    g.fillText('SEAWOLVES', w / 2, 106);
  });
  scene.add(box(.5, 2.1, 5.8, new THREE.MeshStandardMaterial({ map: swTex, roughness: .9 }), 57.1, 1.05, -9));
  const orca = new THREE.Group();
  const obody = new THREE.Mesh(new THREE.SphereGeometry(.55, 14, 10), new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .5 }));
  obody.scale.set(1.7, .8, .8);
  orca.add(obody);
  const obelly = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: .5 }));
  obelly.scale.set(1.5, .62, .7); obelly.position.y = -.16;
  orca.add(obelly);
  const ofin = new THREE.Mesh(new THREE.ConeGeometry(.2, .55, 8), new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .5 }));
  ofin.position.set(-.1, .55, 0);
  orca.add(ofin);
  orca.position.set(57.6, 2.5, -10.4);
  orca.rotation.y = Math.PI / 2; orca.rotation.z = .25;
  scene.add(orca);
  for (const tz of [-10.6, -9, -7.4]) scene.add(box(.08, .8, 1.35, new THREE.MeshStandardMaterial({ color: 0x0c1218, emissive: 0x1a3a5c, emissiveIntensity: .6 }), 56.75, 3.2, tz));
  scene.add(box(.9, 1.5, 1.2, new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: .8 }), 58, .75, -11.7));
  scene.add(box(.9, 1.5, 1.2, new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: .8 }), 58, .75, -6.3));
  // belt barrier — associates only beyond this point
  const beltFC = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .6 });
  for (const pz of [-11.5, -6.5]) {
    scene.add(cyl(.035, .05, 1.0, beltFC, 60.3, .5, pz, 8));
    scene.add(cyl(.09, .09, .03, beltFC, 60.3, 1.0, pz, 10));
  }
  scene.add(box(.06, .07, 4.8, beltFC, 60.3, .92, -9));
  collide(60.3, -9, .3, 5.4);
  // navy inflatable Safe to Go arch in front of the opening, facing the gates
  const archM = new THREE.MeshStandardMaterial({ color: 0x1b2a3d, roughness: .55 });
  const archTube = new THREE.Mesh(new THREE.TorusGeometry(2.6, .4, 10, 22, Math.PI), archM);
  archTube.rotation.y = Math.PI / 2;
  archTube.position.set(62.5, .5, -9);
  scene.add(archTube);
  const stgTex = TX.ct(320, 80, (g, w, h) => {
    g.fillStyle = '#1b2a3d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#63b830'; g.font = '700 34px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('✓ Safe to Go', w / 2, 52);
  });
  const stg = new THREE.Mesh(new THREE.PlaneGeometry(2.8, .7), new THREE.MeshBasicMaterial({ map: stgTex }));
  stg.rotation.y = Math.PI / 2;
  stg.position.set(62.66, 3.5, -9);
  scene.add(stg);
  collide(62.5, -11.6, .95, .95); collide(62.5, -6.4, .95, .95);
  // hazard strip + STOP decal at the threshold
  const hzEdge = new THREE.Mesh(new THREE.PlaneGeometry(.4, 5.0), new THREE.MeshBasicMaterial({ map: TX.ct(64, 512, (g, w, h) => {
    g.fillStyle = '#e8c520'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    for (let i = 0; i < 16; i++) { g.save(); g.translate(0, i * 32); g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 16); g.lineTo(w, 32); g.lineTo(0, 16); g.fill(); g.restore(); }
  }) }));
  hzEdge.rotation.x = -Math.PI / 2; hzEdge.position.set(63.05, .012, -9); hzEdge.renderOrder = 1;
  scene.add(hzEdge);
  const stopFC = new THREE.Mesh(new THREE.PlaneGeometry(.85, .85), new THREE.MeshBasicMaterial({ map: TX.ct(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#c22127'; g.beginPath(); g.arc(w / 2, h / 2, w * .46, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '900 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', w / 2, h / 2);
  }), transparent: true, depthWrite: false }));
  // read by associates walking east out of the FC arch toward the lanes
  stopFC.rotation.x = -Math.PI / 2; stopFC.rotation.z = Math.atan2(-1, 0);
  stopFC.position.set(63.9, .013, -9); stopFC.renderOrder = 1;
  scene.add(stopFC);

  // ---- SOUTH WALL (z=17): mural-faced wall with a plain OPENING into the locker
  // area ("the locker area has an opening on the middle wall" —
  // no detectors here). Entry-lobby stretch (x 80..92) stays solid blue. ----
  scene.add(blocker(box(18, 5.9, .3, structM, 71, 5.45, 17)));     // white header 62..80
  scene.add(blocker(box(12, 5.9, .3, blueWall, 86, 5.45, 17)));    // blue header 80..92
  scene.add(blocker(box(6, 2.5, .3, blueWall, 65, 1.25, 17)));     // 62..68
  scene.add(blocker(box(7, 2.5, .3, blueWall, 76.5, 1.25, 17)));   // 73..80 (opening 68..73)
  scene.add(blocker(box(12, 2.5, .3, blueWall, 86, 1.25, 17)));    // 80..92
  collide(65, 17, 6, .6); collide(76.5, 17, 7, .6); collide(86, 17, 12, .6);
  // dress the locker opening: chrome corner guards on the jambs + a blue
  // accent lintel band, so the doorway reads finished from both sides
  scene.add(box(.14, 2.5, .36, M.chrome, 68.05, 1.25, 17));
  scene.add(box(.14, 2.5, .36, M.chrome, 72.95, 1.25, 17));
  scene.add(box(5.3, .3, .36, M.blueSoffit, 70.5, 2.62, 17));
  // mountain mural faces on the security side of the wall, either side of the opening
  for (const [mx, mw] of [[65, 5.8], [76.5, 6.8]]) {
    const mp2 = new THREE.Mesh(new THREE.PlaneGeometry(mw, 2.45), muralMat);
    mp2.rotation.y = Math.PI; mp2.position.set(mx, 1.25, 16.83);
    scene.add(mp2);
  }
  // Lockers pennant + EXIT sign over the opening, facing the security floor
  const lkTexS = TX.ct(160, 160, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w / 2, h); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = '600 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Lockers', w / 2, 50);
  });
  const lkS2 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: lkTexS, transparent: true }));
  lkS2.rotation.y = Math.PI; lkS2.position.set(70.5, 4.4, 15.6);
  scene.add(lkS2);
  const exTexS = TX.ct(128, 48, (g, w, h) => { g.fillStyle = '#200'; g.fillRect(0, 0, w, h); g.fillStyle = '#f33'; g.font = '900 30px Arial'; g.textAlign = 'center'; g.fillText('EXIT', w / 2, 36); });
  const exS = new THREE.Mesh(new THREE.PlaneGeometry(.6, .24), new THREE.MeshBasicMaterial({ map: exTexS }));
  exS.rotation.y = Math.PI; exS.position.set(70.5, 2.9, 16.82);
  scene.add(exS);

  // ---- METAL DETECTORS (from trips): three lanes rotated 90°,
  // in line with the Safe to Go arch — everyone leaving the warehouse walks the
  // arch, then a detector lane, under a white soffit joined to the desk island ----
  scene.add(blocker(box(4.6, 2.6, 7.4, structM, 63.9, 4.9, -9.1))); // soffit bridge wall→island
  for (const pz of [-12.15, -6.05]) {
    scene.add(blocker(box(.85, 3.6, .85, structM, 64.3, 1.8, pz)));
    collide(64.3, pz, .95, .95);
  }
  scene.add(box(.18, 1.1, 6.4, new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: .9 }), 64.9, 3.05, -9.1));
  for (const dz of [-11.1, -9.15, -7.2]) {
    scene.add(box(.6, 2.15, .18, detM, 64.3, 1.08, dz - .55));
    scene.add(box(.6, 2.15, .18, detM, 64.3, 1.08, dz + .55));
    scene.add(box(.6, .16, 1.28, detM, 64.3, 2.2, dz));
    scene.add(box(.06, .06, 1.0, new THREE.MeshStandardMaterial({ color: 0x2de07c, emissive: 0x2de07c, emissiveIntensity: .5 }), 64.56, 2.05, dz));
    collide(64.3, dz - .55, .65, .25); collide(64.3, dz + .55, .65, .25);
  }
  // x-ray belt beside the lanes + roller prep table on the arch side
  const xrayM = new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: .45, metalness: .35 });
  const xrayDark = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: .8 });
  scene.add(box(1.8, .16, .8, xrayM, 66.5, .78, -11.6));
  for (const [lx2, lz2] of [[-.75, -.3], [.75, -.3], [-.75, .3], [.75, .3]]) scene.add(box(.08, .7, .08, M.blackMetal, 66.5 + lx2, .35, -11.6 + lz2));
  scene.add(box(.95, .62, .84, xrayDark, 66.35, 1.17, -11.6));
  collide(66.5, -11.6, 1.9, .9);
  scene.add(box(1.4, .05, .6, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .5, metalness: .3 }), 63.2, .74, -13.3));
  for (const [lx3, lz3] of [[-.5, -.2], [.5, -.2], [-.5, .2], [.5, .2]]) scene.add(cyl(.02, .02, .72, M.blackMetal, 63.2 + lx3, .37, -13.3 + lz3, 6));
  collide(63.2, -13.3, 1.5, .7);

  // ---- secondary screening (southwest corner, from trips): ONE detector +
  // one table, tucked against the mural clear of the locker-room doorway ----
  scene.add(box(.6, 2.15, .18, detM, 63.4, 1.08, 12.85));
  scene.add(box(.6, 2.15, .18, detM, 63.4, 1.08, 13.95));
  scene.add(box(.6, .16, 1.28, detM, 63.4, 2.2, 13.4));
  scene.add(box(.5, .06, 1.0, new THREE.MeshStandardMaterial({ color: 0x2de07c, emissive: 0x2de07c, emissiveIntensity: .4 }), 63.15, 2.02, 13.4));
  collide(63.4, 12.85, .65, .25); collide(63.4, 13.95, .65, .25);
  scene.add(box(.7, .05, 1.6, new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: .6 }), 63.5, .74, 15.6));
  for (const [lx, lz] of [[-.2, -.6], [.2, -.6], [-.2, .6], [.2, .6]]) scene.add(cyl(.02, .02, .72, M.blackMetal, 63.5 + lx, .37, 15.6 + lz, 6));
  collide(63.5, 15.6, .8, 1.7);
  // gray post-screening cart against the mural
  scene.add(box(1.0, .95, .55, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .5, metalness: .4 }), 63.1, .48, 10.9));
  collide(63.1, 10.9, 1.1, .65);
  const ssTex = TX.ct(256, 200, (g, w, h) => {
    g.fillStyle = '#5a2a82'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '700 24px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Secondary', w / 2, 70); g.fillText('Screening Area', w / 2, 102);
    g.font = '13px "Segoe UI", sans-serif';
    g.fillText('Please wait for a Security', w / 2, 140); g.fillText('Officer or Loss Prevention', w / 2, 160);
  });
  const ssW = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.15), new THREE.MeshBasicMaterial({ map: ssTex }));
  ssW.rotation.y = Math.PI / 2; ssW.position.set(62.4, 2.15, 13.4);
  scene.add(ssW);

  // ---- THE PAE2 ISLAND (from trips): one long freestanding white soffit
  // structure facing the gates — desk on the RIGHT (north) end, exit-screening
  // metal-detector bays on the LEFT (south) end feeding the exit turnstiles.
  // The FC arch sits further right (north wall). ----
  const paeTex = TX.ct(1024, 256, (g, w, h) => {
    g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a7de1'; g.font = '900 190px "Segoe UI", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PAE2', w / 2, h / 2 + 8);
  });
  scene.add(blocker(box(6.4, 2.6, 8.2, structM, 68.6, 4.9, -5.2)));  // soffit y 3.6..6.2
  for (const [px, pz] of [[71.2, -8.8], [66.0, -1.7], [71.2, -1.7]]) {
    scene.add(blocker(box(.85, 3.6, .85, structM, px, 1.8, pz)));
    collide(px, pz, .95, .95);
  }
  const paeE = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.0), new THREE.MeshStandardMaterial({ map: paeTex }));
  paeE.rotation.y = Math.PI / 2; paeE.position.set(71.95, 4.9, -5.6);
  scene.add(paeE);
  const paeS = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.0), new THREE.MeshStandardMaterial({ map: paeTex }));
  paeS.position.set(68.6, 4.9, -1.14);
  scene.add(paeS);
  // ---- curved mural desk on the north end of the front (from trips:
  // chevron at the right end, curved cap toward the detectors) ----
  const muralTex = TX.ct(1024, 128, (g, w, h) => {
    g.fillStyle = '#f5f4f0'; g.fillRect(0, 0, w, h);
    const cols = ['#e8443a', '#f2a521', '#38a34c', '#2a7de1', '#8c4fd1', '#f2699c', '#2ab5b0', '#d96820'];
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[i]; g.globalAlpha = .85;
      g.beginPath(); g.arc(70 + i * 125, 64 + (i % 2 ? -16 : 16), 34, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#232f3e';
    for (let i = 0; i < 8; i++) { // family silhouettes: adult + child pairs
      const x = 55 + i * 122;
      g.beginPath(); g.arc(x, 40, 13, 0, 7); g.fill();
      g.fillRect(x - 12, 55, 24, 50);
      if (i % 2) {
        g.beginPath(); g.arc(x + 24, 58, 9, 0, 7); g.fill();
        g.fillRect(x + 16, 69, 16, 36);
      }
    }
  });
  const muralM = new THREE.MeshStandardMaterial({ map: muralTex, roughness: .8 });
  const deskTopM = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: .4 });
  scene.add(box(.55, 1.02, 5.6, muralM, 71.75, .51, -5.7));           // desk front (faces the gates)
  scene.add(box(.95, .06, 6.0, deskTopM, 71.75, 1.05, -5.7));
  const chevTex = TX.ct(256, 64, (g, w, h) => {
    const cs = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
    cs.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.moveTo(i * 40, 0); g.lineTo(i * 40 + 26, h / 2); g.lineTo(i * 40, h); g.lineTo(i * 40 + 40, h); g.lineTo(i * 40 + 66, h / 2); g.lineTo(i * 40 + 40, 0); g.fill(); });
  });
  scene.add(box(.56, 1.02, 1.4, new THREE.MeshStandardMaterial({ map: chevTex, roughness: .7 }), 71.755, .51, -7.7));
  const badgeTex = TX.ct(160, 200, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a2a82'; g.font = '700 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Proper Badge Wear', w / 2, 26);
    g.fillStyle = '#333'; g.beginPath(); g.arc(w / 2, 90, 28, 0, 7); g.fill();
    g.fillStyle = '#d8d8d8'; g.fillRect(30, 130, 100, 50);
  });
  const badgeP = new THREE.Mesh(new THREE.PlaneGeometry(.85, .9), new THREE.MeshBasicMaterial({ map: badgeTex }));
  badgeP.rotation.y = Math.PI / 2; badgeP.position.set(72.04, .52, -4.4);
  scene.add(badgeP);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, 1.02, 16, 1, false, 0, Math.PI), muralM);
  cap.position.set(71.75, .51, -2.85);
  scene.add(cap);
  scene.add(cyl(.6, .6, .06, deskTopM, 71.75, 1.05, -2.85, 16));
  for (const mz of [-7.6, -5.7, -3.9]) {                              // monitors on the staff side
    scene.add(box(.04, .28, .42, new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .4 }), 71.35, 1.35, mz));
    scene.add(box(.06, .18, .06, M.blackMetal, 71.35, 1.14, mz));
  }
  scene.add(box(.5, .5, .6, new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: .7 }), 71.5, 1.32, -8.25)); // radio charger block
  collide(71.75, -5.7, 1.2, 6.0); collide(71.75, -2.85, 1.2, .7);
  inter({ id: 'frontdesk', type: 'desk', x: 72.9, z: -5.7, r: 2.2, label: 'Ask security a question' });
  const hzSq = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: TX.hazardSquareTexture(), transparent: true }));
  hzSq.rotation.x = -Math.PI / 2; hzSq.position.set(73.6, .013, -8.4); hzSq.renderOrder = 1;
  scene.add(hzSq);
  // Security pennant hanging above the island + AED kite
  const secTex = TX.ct(160, 160, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w / 2, h); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = '600 24px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Security', w / 2, 52);
  });
  const pennant = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: secTex, transparent: true, side: THREE.DoubleSide }));
  pennant.position.set(68.4, 7.0, -1.0);
  scene.add(pennant);
  const kite = new THREE.Mesh(new THREE.PlaneGeometry(.75, .95), new THREE.MeshBasicMaterial({ color: 0xd93025, side: THREE.DoubleSide }));
  kite.position.set(77, 6.2, 4);
  scene.add(kite);

  // ---- display cluster between the arch and Career Choice (from trips): light-up PAE2
  // letters, the big Peccy statue, black tours table with TV ----
  const letterTex = (ch) => TX.ct(128, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#eef3f8'; g.font = '900 132px "Arial Black", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, w / 2, h / 2);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#3d7de1';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
      g.beginPath(); g.arc(14 + c * 25, 16 + r * 26, 6.5, 0, 7); g.fill();
    }
  });
  ['P', 'A', 'E', '2'].forEach((ch, i) => {
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.35), new THREE.MeshBasicMaterial({ map: letterTex(ch), transparent: true, alphaTest: .35, side: THREE.DoubleSide }));
    lm.position.set(69.3 + i * 1.06, .72, -13.3);
    lm.rotation.y = (i % 2 ? -1 : 1) * .1;
    scene.add(lm);
    scene.add(box(.5, .06, .3, new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: .6 }), 69.3 + i * 1.06, .03, -13.35));
  });
  collide(70.9, -13.3, 4.4, .55);
  // Peccy statue — in front-right of the letters, gazing toward the gates
  const peccy = new THREE.Group();
  const peccyM = new THREE.MeshStandardMaterial({ color: 0xf28b1e, roughness: .5 });
  const pbody = new THREE.Mesh(new THREE.SphereGeometry(.62, 20, 16), peccyM);
  pbody.scale.set(1, 1.22, .92);
  pbody.position.y = .8;
  peccy.add(pbody);
  for (const s of [-1, 1]) { // two friendly eyes
    const white = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .25 }));
    white.position.set(s * .18, 1.02, .5);
    peccy.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .3 }));
    pupil.position.set(s * .17, 1.02, .61);
    peccy.add(pupil);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(.16, .028, 8, 14, Math.PI * .8), new THREE.MeshStandardMaterial({ color: 0x8a4a0e, roughness: .5 }));
  smile.position.set(0, .74, .55);
  smile.rotation.z = Math.PI + .3;
  smile.rotation.x = -.25;
  peccy.add(smile);
  for (const s of [-1, 1]) { // stubby arms reaching forward
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .3, 4, 10), peccyM);
    arm.position.set(s * .58, .72, .18);
    arm.rotation.z = s * 1.15;
    arm.rotation.x = -.5;
    peccy.add(arm);
  }
  for (const s of [-1, 1]) { // little feet
    const foot = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), peccyM);
    foot.scale.set(1, .55, 1.3);
    foot.position.set(s * .24, .07, .12);
    peccy.add(foot);
  }
  const plinth = cyl(.75, .85, .16, new THREE.MeshStandardMaterial({ color: 0x232f3e, roughness: .6 }), 0, .08, 0, 20); // dark so Peccy reads grounded from afar
  peccy.add(plinth);
  peccy.children.forEach(c => { if (c !== plinth) c.position.y += .16; });
  peccy.scale.setScalar(1.45);
  peccy.position.set(74.6, 0, -11.8);
  peccy.rotation.y = -Math.PI / 2 + .35;
  scene.add(peccy);
  collide(74.6, -11.8, 1.9, 1.9);
  // black tours table with TV near the NE corner
  scene.add(box(2.2, .8, 1.1, new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .6 }), 79.0, .4, -14.3));
  const tvT = new THREE.Mesh(new THREE.BoxGeometry(1.6, .95, .08), new THREE.MeshStandardMaterial({ color: 0x0c1218, emissive: 0x1a3a5c, emissiveIntensity: .6 }));
  tvT.position.set(78.9, 1.5, -14.1); tvT.rotation.y = -.7;
  scene.add(tvT);
  collide(79.0, -14.3, 2.3, 1.2);
  const toursTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.beginPath(); g.arc(w / 2, h / 2, w * .47, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '600 24px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('tours', w / 2, 72);
  });
  const toursD = new THREE.Mesh(new THREE.PlaneGeometry(.7, .7), new THREE.MeshBasicMaterial({ map: toursTex, transparent: true, depthWrite: false }));
  toursD.rotation.x = -Math.PI / 2; toursD.position.set(77.4, .012, -12.7); toursD.renderOrder = 1;
  scene.add(toursD);
  const moTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.beginPath(); g.arc(w / 2, h / 2, w * .47, 0, 7); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(34, 62) ; g.lineTo(64, 38); g.lineTo(94, 62); g.fill();
    g.fillRect(44, 62, 40, 26);
    g.font = '600 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Main Office', w / 2, 108);
  });
  const moD = new THREE.Mesh(new THREE.PlaneGeometry(.7, .7), new THREE.MeshBasicMaterial({ map: moTex, transparent: true, depthWrite: false }));
  moD.rotation.x = -Math.PI / 2; moD.position.set(73.0, .012, -10.4); moD.renderOrder = 1;
  scene.add(moD);

  // ---- Career Choice alcove dressing (from trips): Grow banner, wire rack,
  // black cubby lockers, LOCKERS tape, New Hires decals, safety board ----
  const growTex = TX.ct(192, 384, (g, w, h) => {
    g.fillStyle = '#f2f5f8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a7de1'; g.font = '700 26px "Segoe UI", sans-serif';
    g.fillText('Grow', 20, 60); g.fillText('your', 20, 92); g.fillText('career.', 20, 124);
    g.fillStyle = '#f2a521'; g.fillRect(20, 200, 150, 120);
  });
  const grow = new THREE.Mesh(new THREE.PlaneGeometry(.95, 1.9), new THREE.MeshStandardMaterial({ map: growTex, side: THREE.DoubleSide }));
  grow.position.set(73.75, 1.05, -16.4);
  scene.add(grow);
  collide(73.75, -16.4, .8, .4);
  const rack2 = new THREE.Group();
  for (let s2 = 0; s2 < 4; s2++) rack2.add(box(1.1, .03, .5, M.chrome, 0, .3 + s2 * .42, 0));
  for (const [px, pz] of [[-.53, -.23], [.53, -.23], [-.53, .23], [.53, .23]]) rack2.add(cyl(.016, .016, 1.85, M.chrome, px, .92, pz, 6));
  rack2.position.set(71.9, 0, -16.35);
  scene.add(rack2);
  collide(71.9, -16.35, 1.2, .6);
  const cubbyTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3d4045'; g.lineWidth = 3;
    for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) g.strokeRect(c2 * 42 + 4, r2 * 42 + 4, 38, 38);
  });
  scene.add(box(1.1, 1.25, .5, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .7 }), 72.9, .63, -16.35));
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.2), new THREE.MeshStandardMaterial({ map: cubbyTex, roughness: .7 })).translateX(72.9).translateY(.63).translateZ(-16.09));
  collide(72.9, -16.35, 1.2, .6);
  tapeZone(scene, 72.4, -15.6, 2.4, .9, 'LOCKERS');
  const nhTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#1b3a6e'; g.beginPath(); g.arc(w / 2, h / 2, w * .47, 0, 7); g.fill();
    g.fillStyle = '#fff';
    for (let i2 = 0; i2 < 3; i2++) { g.beginPath(); g.arc(40 + i2 * 24, 48, 9, 0, 7); g.fill(); g.fillRect(32 + i2 * 24, 60, 16, 22); }
    g.font = '600 13px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('New Hires This Way', w / 2, 108);
  });
  const nhM = new THREE.MeshBasicMaterial({ map: nhTex, transparent: true, depthWrite: false });
  for (const [dx2, dz2] of [[74.9, -12.3], [74.9, -15.0], [77.5, -13.6]]) {
    const d2 = new THREE.Mesh(new THREE.PlaneGeometry(.75, .75), nhM);
    d2.rotation.x = -Math.PI / 2; d2.position.set(dx2, .012, dz2); d2.renderOrder = 1;
    scene.add(d2);
  }
  const sbTex = TX.ct(256, 160, (g, w, h) => {
    g.fillStyle = '#c22127'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '700 20px Arial'; g.textAlign = 'center';
    g.fillText('SAFETY BOARD', w / 2, 30);
    g.fillStyle = '#f2f2ee'; g.fillRect(14, 44, 68, 50); g.fillRect(94, 44, 68, 50); g.fillRect(174, 44, 68, 50);
    g.fillStyle = '#2a7de1'; g.fillRect(14, 104, 228, 40);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.05), new THREE.MeshBasicMaterial({ map: sbTex })).translateX(79.4).translateY(1.8).translateZ(-16.82));
  tapeZone(scene, 79.4, -15.9, 1.8, .9, null);

  dayOneRooms(scene);

  // thank-you / Exit band with shark doodles ABOVE the hedge wall, security side
  const bandTex = TX.ct(2048, 128, (g, w, h) => {
    g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a7de1'; g.font = '600 76px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('thank you', w * .3, 88);
    g.font = '600 64px "Segoe UI", sans-serif'; g.fillText('Exit', w * .72, 84);
    g.strokeStyle = '#8fa2b5'; g.lineWidth = 3;
    for (const fx of [w * .06, w * .48, w * .6, w * .88]) {
      g.beginPath(); g.moveTo(fx, 60); g.quadraticCurveTo(fx + 40, 30, fx + 80, 60); g.quadraticCurveTo(fx + 40, 80, fx, 60); g.stroke();
      g.beginPath(); g.moveTo(fx + 40, 44); g.lineTo(fx + 30, 24); g.lineTo(fx + 50, 40); g.stroke();
    }
  });
  const band = new THREE.Mesh(new THREE.PlaneGeometry(22, 1.5), new THREE.MeshStandardMaterial({ map: bandTex }));
  band.rotation.y = -Math.PI / 2; band.position.set(79.7, 5.6, 0);
  scene.add(band);

  // open floor — walking-person walk decals along the exit route
  const walkTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#2c8c4a'; g.beginPath(); g.arc(w / 2, h / 2, w * .47, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(w / 2, h / 2, w * .42, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.beginPath(); g.arc(66, 32, 9, 0, 7); g.fill();          // head
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(64, 42); g.lineTo(58, 68); g.stroke();   // torso
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(62, 50); g.lineTo(76, 62); g.stroke();   // front arm
    g.beginPath(); g.moveTo(62, 50); g.lineTo(46, 58); g.stroke();   // back arm
    g.beginPath(); g.moveTo(58, 68); g.lineTo(72, 84); g.lineTo(72, 98); g.stroke(); // front leg
    g.beginPath(); g.moveTo(58, 68); g.lineTo(46, 84); g.lineTo(38, 94); g.stroke(); // back leg
  });
  W.anchors.walkDecalM = new THREE.MeshBasicMaterial({ map: walkTex, transparent: true, depthWrite: false });
  // floor sticker aligned to a walking direction (hx,hz). alongU: the artwork
  // points along texture-right (e.g. arrows) instead of texture-top.
  W.anchors.floorDecal = (sc, mat, x, z, hx, hz, w = .6, hgt, alongU = false) => {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt || w), mat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = alongU ? Math.atan2(-hz, hx) : Math.atan2(-hx, -hz);
    d.position.set(x, .012, z); d.renderOrder = 1;
    sc.add(d);
    return d;
  };
  // exit route: an evenly spaced row from the desk toward the badge-out gates
  for (const [dx, dz] of [[73.4, 2.4], [75.9, 4.0], [78.4, 5.6]])
    W.anchors.floorDecal(scene, W.anchors.walkDecalM, dx, dz, 2.5, 1.6);
  trash(scene, 66.3, 15.7, 0x6a6e73); // against the mural wall, out of the walkway

  hedgeGateWall(scene);
  entryLobby(scene);
}

// ============================================================ DAY ONE / CAREER CHOICE + FC PORTAL
// User-described: right of the security desk leads into the FC; beyond that are
// the "Day One" and "Career Choice" meeting rooms.
function dayOneRooms(scene) {
  // Career Choice alcove on the LEFT (west), Day 1 Training
  // room on the RIGHT (east), safety board east of Day One, jamb corner guards
  const roomFloor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: .9 }));
  roomFloor.rotation.x = -Math.PI / 2; roomFloor.position.set(76.6, .005, -20.5);
  scene.add(roomFloor);
  scene.add(blocker(box(7.6, 3.4, .25, M.white, 76.6, 1.7, -24)));
  scene.add(blocker(box(.25, 3.4, 7, M.white, 72.9, 1.7, -20.5)));
  scene.add(blocker(box(.25, 3.4, 7, M.white, 80.3, 1.7, -20.5)));
  scene.add(blocker(box(.25, 3.4, 7, M.white, 76.4, 1.7, -20.5)));  // divider
  scene.add(box(7.8, .15, 7.4, M.white, 76.6, 3.42, -20.5));
  collide(76.6, -24.1, 7.6, .5); collide(72.9, -20.5, .5, 7); collide(80.3, -20.5, .5, 7); collide(76.4, -20.5, .5, 7);
  const linR = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .8 });
  scene.add(box(2.2, .08, .3, linR, 74.6, 3.3, -20.5));
  scene.add(box(2.2, .08, .3, linR, 78.4, 3.3, -20.5));
  // door visuals: Career = dark glass w/ palm decals; Day One = white door w/ window
  const ccDoorTex = TX.ct(128, 256, (g, w, h) => {
    g.fillStyle = '#101820'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8720c'; g.lineWidth = 4;                     // palm tree doodle
    g.beginPath(); g.moveTo(64, 190); g.lineTo(64, 120); g.stroke();
    for (const a of [-.9, -.4, .4, .9]) { g.beginPath(); g.moveTo(64, 120); g.quadraticCurveTo(64 + 40 * Math.sin(a), 96, 64 + 56 * Math.sin(a), 108 + 14 * Math.cos(a)); g.stroke(); }
    g.strokeStyle = '#f2699c';
    g.beginPath(); g.moveTo(24, 60); g.lineTo(40, 40); g.moveTo(32, 62); g.lineTo(48, 46); g.stroke(); // fireworks
  });
  const dayDoorTex = TX.ct(128, 256, (g, w, h) => {
    g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8fa2b5'; g.fillRect(34, 40, 60, 80);
    g.fillStyle = '#9aa4ae'; g.fillRect(96, 130, 18, 6);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.3), new THREE.MeshBasicMaterial({ map: ccDoorTex })).translateX(74.9).translateY(1.15).translateZ(-16.86));
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.3), new THREE.MeshBasicMaterial({ map: dayDoorTex })).translateX(77.5).translateY(1.15).translateZ(-16.86));
  // stainless corner guards on the jambs (from trips)
  for (const gx of [74.2, 75.6, 76.8, 78.2]) scene.add(box(.1, 2.5, .18, M.chrome, gx, 1.25, -16.9));
  // signs: Career Choice wall flag (west) + Day 1 Training room hanging sign (east)
  const ccSignTex = TX.ct(192, 96, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Career', w / 2, 40); g.fillText('Choice', w / 2, 68);
  });
  const ccSign = new THREE.Mesh(new THREE.PlaneGeometry(.9, .45), new THREE.MeshBasicMaterial({ map: ccSignTex, side: THREE.DoubleSide }));
  ccSign.position.set(74.15, 2.85, -16.55);
  ccSign.rotation.y = Math.PI / 4;
  scene.add(ccSign);
  const d1SignTex = TX.ct(192, 128, (g, w, h) => {
    g.fillStyle = '#2a7de1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 20px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Day 1', w / 2, 44); g.fillText('Training', w / 2, 70); g.fillText('room', w / 2, 96);
  });
  const d1Sign = new THREE.Mesh(new THREE.PlaneGeometry(.7, .5), new THREE.MeshBasicMaterial({ map: d1SignTex, side: THREE.DoubleSide }));
  d1Sign.position.set(78.6, 2.75, -16.3);
  d1Sign.rotation.y = Math.PI / 2;
  scene.add(d1Sign);
  // room interiors: meeting tables + chairs + screens
  for (const cx of [74.6, 78.4]) {
    for (const tz of [-19.6, -22]) {
      scene.add(box(2.4, .05, .8, new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: .6 }), cx, .74, tz));
      for (const [lx, lz] of [[-1, -.28], [1, -.28], [-1, .28], [1, .28]]) scene.add(cyl(.02, .02, .72, M.blackMetal, cx + lx, .37, tz + lz, 6));
      collide(cx, tz, 2.5, .9);
      for (let ci = 0; ci < 3; ci++) {
        const ch = simpleChair(M.chairBrown);
        ch.position.set(cx - .8 + ci * .8, 0, tz + .75);
        scene.add(ch);
        W.seats.push({ id: `room-${cx}-${tz}-${ci}`, x: cx - .8 + ci * .8, z: tz + .75, y: .5, ry: Math.PI, type: 'chair', exitX: cx - .8 + ci * .8, exitZ: tz + 1.4 });
      }
    }
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: .3 }));
    scr.position.set(cx, 1.9, -23.85);
    scene.add(scr);
  }
}

// ============================================================ HEDGE GATE WALL (x=80)
// From break-room trips: green hedge feature wall with neon "Welcome to PAE2" script,
// red garland, Enter + Do-Not-Enter turnstile openings, and a window into PAE2.
function hedgeGateWall(scene) {
  const hedgeTex = TX.ct(256, 256, (g, w, h) => {
    g.fillStyle = '#2f5e2a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const shade = 60 + Math.random() * 110;
      g.fillStyle = `rgb(${shade * .45},${shade},${shade * .38})`;
      const x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.arc(x, y, 1 + Math.random() * 2.6, 0, 7); g.fill();
    }
  }, { repeat: [2, 2] });
  const hedgeM = new THREE.MeshStandardMaterial({ map: hedgeTex, roughness: .95 });
  const H = 5.0;
  // solid hedge segments (z spans): |17..7.2| enter |4..2| window strip |−2..−4| exit |−7.2..−17|
  const segs = [[-17, -9], [-3.5, -2], [2, 3.5], [9, 17]];
  for (const [z0, z1] of segs) {
    scene.add(blocker(box(.65, H, z1 - z0, hedgeM, 80, H / 2, (z0 + z1) / 2)));
    collide(80, (z0 + z1) / 2, .7, z1 - z0);
  }
  // header hedges above openings + window
  for (const [z0, z1, yBot] of [[-9, -3.5, 2.7], [3.5, 9, 2.7], [-2, 2, 3.1]]) {
    scene.add(blocker(box(.65, H - yBot, z1 - z0, hedgeM, 80, (H + yBot) / 2, (z0 + z1) / 2)));
  }
  // window into security (glass, sill hedge below)
  scene.add(blocker(box(.65, 1.0, 4, hedgeM, 80, .5, 0)));
  collide(80, 0, .7, 4);
  scene.add(box(.1, 2.1, 4, M.glass, 80, 2.05, 0));
  scene.add(box(.16, .1, 4, M.mullion, 80, 3.08, 0));
  scene.add(box(.16, .1, 4, M.mullion, 80, 1.02, 0));
  // dark header bands + labels (lobby side)
  const label = (text, z) => {
    const t = TX.ct(512, 96, (g, w, h) => {
      g.fillStyle = '#1d2126'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '600 44px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.fillText(text, w / 2, 62);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, .55), new THREE.MeshBasicMaterial({ map: t }));
    m.rotation.y = Math.PI / 2; m.position.set(80.4, 2.95, z);
    scene.add(m);
  };
  label('Enter', -5.6);
  label('Do Not Enter', 5.6);
  // neon script "Welcome to PAE2" (lobby side, glowing)
  const neonTex = TX.ct(1024, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.shadowColor = '#bfe8ff'; g.shadowBlur = 22;
    g.font = 'italic 700 88px "Segoe Script", "Comic Sans MS", cursive';
    g.textAlign = 'center'; g.strokeText('Welcome to PAE2', w / 2, 120);
    g.fillStyle = '#f4fbff'; g.fillText('Welcome to PAE2', w / 2, 120);
  });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.4), new THREE.MeshBasicMaterial({ map: neonTex, transparent: true }));
  neon.rotation.y = Math.PI / 2; neon.position.set(80.45, 4.1, 0);
  scene.add(neon);
  // red garland along the hedge top
  const garland = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 33, 6), new THREE.MeshStandardMaterial({ color: 0xd93025, emissive: 0x811610, emissiveIntensity: .5, roughness: .6 }));
  garland.rotation.x = Math.PI / 2;
  garland.position.set(80.4, H + .02, 0);
  scene.add(garland);

  // ---- badge gate lanes inside the two openings ----
  W.gates = [];
  const pedM = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, roughness: .35, metalness: .6 });
  const paddleM = new THREE.MeshStandardMaterial({ color: 0xcfe8f5, roughness: .15, transparent: true, opacity: .55 });
  const mkGates = (zs, kind) => {
    // pedestals between/basing lanes
    for (let i = 0; i <= zs.length; i++) {
      const pz = (i === 0 ? zs[0] - .55 : i === zs.length ? zs[i - 1] + .55 : (zs[i - 1] + zs[i]) / 2);
      const ped = box(1.25, 1.0, .32, pedM, 80, .5, pz);
      scene.add(blocker(ped));
      collide(80, pz, 1.3, .36);
      scene.add(box(1.2, .05, .26, new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .5 }), 80, 1.03, pz));
      scene.add(box(.1, .04, .12, new THREE.MeshStandardMaterial({ color: kind === 'enter' ? 0x2de07c : 0xe84f4f, emissive: kind === 'enter' ? 0x2de07c : 0xe84f4f, emissiveIntensity: .8 }), 80.55, 1.06, pz));
    }
    for (const lz of zs) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(.05, .55, .5), paddleM);
      pl.position.set(80, .78, lz - .3);
      const pr = new THREE.Mesh(new THREE.BoxGeometry(.05, .55, .5), paddleM);
      pr.position.set(80, .78, lz + .3);
      scene.add(pl, pr);
      const col = { x0: 79.7, x1: 80.3, z0: lz - .62, z1: lz + .62, off: false };
      W.colliders.push(col);
      const gate = { id: 'g' + lz.toFixed(1), pl, pr, col, lz, open: 0 };
      W.gates.push(gate);
      inter({ id: gate.id, type: 'gate', x: 80, z: lz, r: 1.5, label: kind === 'enter' ? 'Badge through the gate' : 'Badge out (Do Not Enter side)', data: { gate: gate.id } });
    }
  };
  mkGates([-8.3, -7.05, -5.8, -4.55], 'enter'); // 4 entry lanes (from trips)
  mkGates([4.55, 5.8, 7.05, 8.3], 'exit');      // 4 exit lanes
}

// ============================================================ ENTRY LOBBY (x 80..92)
function entryLobby(scene) {
  // Amazon Family World Map mural on the north wall (from trips)
  const mapTex = TX.ct(1024, 512, (g, w, h) => {
    g.fillStyle = '#2a72b8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 44px "Segoe UI", sans-serif'; g.textAlign = 'left';
    g.fillText('Amazon Family World Map', 40, 70);
    g.fillStyle = '#e8f2fa';
    for (const [mx, my, mw, mh] of [[120, 140, 260, 160], [450, 120, 200, 200], [700, 160, 240, 150]]) {
      g.beginPath(); g.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh / 2, 0, 0, 7); g.fill();
    }
    // colorful landmark strip along the bottom
    const cols = ['#e8443a', '#f2a521', '#38a34c', '#8c4fd1', '#f2699c', '#2ab5b0'];
    for (let i = 0; i < 24; i++) {
      g.fillStyle = cols[i % 6];
      const bh = 30 + (i * 37 % 60);
      g.fillRect(20 + i * 41, h - bh - 14, 26, bh);
    }
  });
  const mapB = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshStandardMaterial({ map: mapTex }));
  mapB.position.set(86.5, 2.6, -16.8);
  scene.add(mapB);
  // AED triangle
  const aedTex = TX.ct(96, 96, (g, w, h) => {
    g.fillStyle = '#d93025'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w / 2, h); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = '700 26px Arial'; g.textAlign = 'center'; g.fillText('AED', w / 2, 40);
  });
  const aed = new THREE.Mesh(new THREE.PlaneGeometry(.7, .7), new THREE.MeshBasicMaterial({ map: aedTex, transparent: true, side: THREE.DoubleSide }));
  aed.position.set(82, 5.6, -16.7);
  scene.add(aed);
  // cocktail table + literature stand (south side, from trips)
  scene.add(cyl(.45, .45, .04, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .7 }), 84, 1.08, 13.5, 14));
  scene.add(cyl(.09, .34, 1.08, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .7 }), 84, .54, 13.5, 10));
  collide(84, 13.5, 1.0, 1.0);
  scene.add(box(.7, 1.5, .35, M.woodDark, 88, .75, 15.8));
  collide(88, 15.8, .8, .5);
  // blue welcome banner pillars flanking the Enter gates
  for (const bz of [-3.4, -8.2]) {
    const bTex = TX.ct(96, 384, (g, w, h) => {
      g.fillStyle = '#2a7de1'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '600 30px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.save(); g.translate(48, 200); g.rotate(-Math.PI / 2); g.fillText('welcome!', 0, 10); g.restore();
    });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(.55, 2.2), new THREE.MeshStandardMaterial({ map: bTex, side: THREE.DoubleSide }));
    b.rotation.y = Math.PI / 2;
    b.position.set(80.9, 1.1, bz);
    scene.add(b);
  }
  // traffic cone by the enter gates (from trips)
  scene.add(cyl(.03, .18, .55, new THREE.MeshStandardMaterial({ color: 0xe06a1e, roughness: .6 }), 81.6, .28, -8.9, 10));
  // floor guidance (Bug29): one coherent enter path from the front doors to the
  // Enter lanes — alternating smile arrows and walk decals, evenly spaced and
  // rotated to the direction of travel — plus a no-entry pair squarely at the
  // mouth of the exit lanes.
  const eDir = [-2.5, -1.4]; // door (≈90.5,-1) → enter lanes (≈81,-6.3)
  const smileTex = TX.ct(128, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#f2a521'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(16, 26); g.quadraticCurveTo(w / 2, 52, w - 22, 30); g.stroke();
    g.beginPath(); g.moveTo(w - 30, 22); g.lineTo(w - 14, 30); g.lineTo(w - 30, 40); g.stroke();
  });
  const smileM = new THREE.MeshBasicMaterial({ map: smileTex, transparent: true, depthWrite: false });
  const enterPath = [[90.2, -1.5], [88.0, -2.7], [85.8, -3.9], [83.6, -5.1]];
  enterPath.forEach(([dx, dz], i) => {
    if (i % 2 === 0) W.anchors.floorDecal(scene, smileM, dx, dz, eDir[0], eDir[1], .85, .42, true);
    else W.anchors.floorDecal(scene, W.anchors.walkDecalM, dx, dz, eDir[0], eDir[1]);
  });
  const noTex = TX.ct(96, 96, (g, w, h) => {
    g.fillStyle = '#c22127'; g.beginPath(); g.arc(w / 2, h / 2, w * .46, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillRect(14, h / 2 - 7, w - 28, 14);
  });
  const noM = new THREE.MeshBasicMaterial({ map: noTex, transparent: true, depthWrite: false });
  for (const dz of [5.5, 7.3]) W.anchors.floorDecal(scene, noM, 82.4, dz, -1, 0, .55);

  // ---- glass storefront (x=92) with door bays + decals ----
  wallWithWindows(scene, { axis: 'x', at: 92, from: -17, to: 17, doorAt: 0, doorW: 5.2, tall: true });
  for (const dz of [-1.9, 0, 1.9]) scene.add(box(.18, 2.7, .14, M.mullion, 92, 1.35, dz));
  for (const s of [-1, 1]) { // open door leaves
    const leaf = box(.06, 2.5, 1.6, M.glass, 92.5, 1.3, s * 3.4);
    leaf.rotation.y = s * .6;
    scene.add(leaf);
  }
  scene.add(blocker(box(.3, 2.3, 34, M.white, 92, 7.3, 0))); // filler above storefront header
  // FrontEnterance.jpg: six door bays N001..N006 in three pairs with gray
  // pilasters between; center pair is the functional entrance
  const pilM = new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: .85 });
  for (const pz of [-14.2, -6.6, -3.9, 3.9, 6.6, 14.2]) {
    scene.add(blocker(box(.55, 5.6, .9, pilM, 92.05, 2.8, pz)));
    collide(92.05, pz, .6, 1.0);
  }
  const frameM = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: .5, metalness: .4 });
  const bayLabel = (txt) => TX.ct(96, 40, (g, w, h) => {
    g.fillStyle = '#2b2d30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#cfd4d9'; g.font = '600 20px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText(txt, w / 2, 28);
  });
  const bays = [[-11.5, 'N001'], [-9.2, 'N002'], [-1.3, 'N003'], [1.3, 'N004'], [8.2, 'N005'], [10.5, 'N006']];
  for (const [bz, label] of bays) {
    if (Math.abs(bz) > 2) { // decorative closed door pairs (the center pair is the live one)
      scene.add(box(.08, 2.5, 2.1, frameM, 91.95, 1.3, bz));
      scene.add(box(.06, 2.3, 1.9, M.glass, 91.9, 1.25, bz));
      scene.add(box(.05, .08, 1.6, frameM, 91.86, 1.02, bz)); // push bar
    }
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.6, .25), new THREE.MeshBasicMaterial({ map: bayLabel(label) })).translateX(91.85).translateY(2.72).translateZ(bz).rotateY(-Math.PI / 2));
  }
  // black trash barrels between the bays (from trips)
  for (const bz of [-5.2, 5.2, 12.5]) {
    scene.add(cyl(.34, .3, .85, new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: .8 }), 92.9, .43, bz, 12));
    collide(92.9, bz, .7, .7);
  }
  // "no guns" + smile decals on the glass
  const gunTex = TX.ct(96, 96, (g, w, h) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w * .45, 0, 7); g.fill();
    g.strokeStyle = '#c22127'; g.lineWidth = 7;
    g.beginPath(); g.arc(w / 2, h / 2, w * .4, 0, 7); g.stroke();
    g.fillStyle = '#222'; g.fillRect(26, 40, 34, 10); g.fillRect(30, 50, 10, 16);
    g.beginPath(); g.moveTo(20, 76); g.lineTo(76, 20); g.stroke();
  });
  for (const dz of [-2.4, 2.4]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), new THREE.MeshBasicMaterial({ map: gunTex, transparent: true }));
    d.rotation.y = -Math.PI / 2; d.position.set(91.9, 1.6, dz);
    scene.add(d);
  }
}

function emergencySignTexture() {
  return TX.ct(128, 64, (g, w, h) => {
    g.fillStyle = '#c22127'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '700 15px Arial'; g.textAlign = 'center';
    g.fillText('EMERGENCY', w / 2, 26); g.fillText('EXIT ONLY', w / 2, 46);
  });
}
function entrance(scene) {
  // west vestibule — EMERGENCY EXIT ONLY now (real entry is via the front lobby)
  scene.add(box(.3, 6.2, 1.2, M.wall, -38, 3.1, -2.6));
  scene.add(box(.3, 6.2, 1.2, M.wall, -38, 3.1, 2.6));
  scene.add(box(.3, 1.6, 6, M.wall, -38, 5.4, 0));
  scene.add(box(.07, 1.9, 4.1, M.glass, -37.9, 3.72, 0)); // transom over the leaves
  const signM = new THREE.MeshBasicMaterial({ map: emergencySignTexture() });
  for (const s of [-1, 1]) {
    const leaf = box(.07, 2.6, 1.9, M.glass, -37.9, 1.5, s * 1.0);
    scene.add(leaf);
    scene.add(box(.1, .08, 1.4, M.blackMetal, -37.8, 1.0, s * 1.0)); // push bar
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(.62, .3), signM);
    sign.rotation.y = Math.PI / 2; sign.position.set(-37.8, 1.9, s * 1.0);
    scene.add(sign);
  }
  collide(-37.9, 0, .6, 4.4); // sealed — no walking out this way
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 1 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(-36.5, .012, 0);
  scene.add(mat);
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(.9, 2.1), new THREE.MeshStandardMaterial({ map: TX.togetherBannerTexture(), side: THREE.DoubleSide }));
  ban.position.set(-36.2, 1.15, 2.9); ban.rotation.y = Math.PI / 4;
  scene.add(ban);
  scene.add(box(.9, .06, .3, M.blackMetal, -36.2, .03, 2.9));
  collide(-36.2, 2.9, .8, .4);
}

// ============================================================ EXTERIOR
function exterior(scene) {
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: .95 }));
  lot.rotation.x = -Math.PI / 2; lot.position.set(-60, -.03, 0);
  scene.add(lot);
  // sidewalk apron
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: .9 }));
  walk.rotation.x = -Math.PI / 2; walk.position.set(-41, -.01, 0);
  scene.add(walk);
  // parking stripes
  const stripeM = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .8 });
  const stripe = new THREE.PlaneGeometry(.18, 5);
  const stripes = new THREE.InstancedMesh(stripe, stripeM, 40);
  const d = new THREE.Object3D();
  for (let i = 0; i < 40; i++) {
    d.position.set(-50 - (i % 2) * 6.2, .002, -28 + Math.floor(i / 2) * 3);
    d.rotation.x = -Math.PI / 2;
    d.updateMatrix(); stripes.setMatrixAt(i, d.matrix);
  }
  scene.add(stripes);
  // cars
  const carCols = [0x8a8f96, 0x2e3f55, 0x7a2c2c, 0xd8d8d8, 0x1a1c1e, 0x4a6b52, 0xb0b8c2];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const cM = new THREE.MeshStandardMaterial({ color: carCols[i % carCols.length], roughness: .35, metalness: .5 });
    g.add(box(1.8, .55, 4.1, cM, 0, .55, 0));
    g.add(box(1.6, .5, 2.2, new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: .2, metalness: .3 }), 0, 1.05, -.2));
    for (const [wx, wz] of [[-.85, 1.3], [.85, 1.3], [-.85, -1.3], [.85, -1.3]]) {
      const wh = cyl(.32, .32, .22, M.blackMetal, wx, .32, wz); wh.rotation.z = Math.PI / 2; g.add(wh);
    }
    g.position.set(-49.7 - (i % 2) * 6.4, 0, -26.5 + Math.floor(i / 2) * 6);
    g.rotation.y = Math.PI / 2 + (i % 2 ? Math.PI : 0);
    scene.add(g);
  }
  // trees + planters near building
  for (const [x, z] of [[-43, -8], [-43, 9], [-45, 20], [-44, -20]]) {
    const t = new THREE.Group();
    t.add(cyl(.09, .12, 1.6, M.woodDark, 0, .8, 0, 8));
    const fol = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: .9 }));
    fol.position.y = 2.2; fol.scale.y = 1.25;
    t.add(fol);
    t.position.set(x, 0, z);
    scene.add(t);
  }
  // stop sign (from trips)
  const sign = new THREE.Group();
  sign.add(cyl(.04, .04, 2.6, M.chrome, 0, 1.3, 0, 8));
  const oct = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .04, 8), new THREE.MeshStandardMaterial({ color: 0xc22127, roughness: .5 }));
  oct.rotation.x = Math.PI / 2; oct.position.y = 2.5;
  sign.add(oct);
  const stopTex = TX.ct(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '900 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', w / 2, h / 2);
  });
  const stopF = new THREE.Mesh(new THREE.PlaneGeometry(.8, .8), new THREE.MeshBasicMaterial({ map: stopTex, transparent: true }));
  stopF.position.set(0, 2.5, .03);
  sign.add(stopF);
  sign.position.set(-44.5, 0, -5.5); sign.rotation.y = Math.PI / 2;
  scene.add(sign);
  // traffic cones (from trips)
  for (const [x, z] of [[-42.5, -9.5], [-42.5, -11], [-43.5, -12.5]]) {
    const cone = cyl(.03, .18, .55, new THREE.MeshStandardMaterial({ color: 0xe06a1e, roughness: .6 }), x, .28, z, 10);
    scene.add(cone);
    scene.add(box(.4, .04, .4, new THREE.MeshStandardMaterial({ color: 0xd06018 }), x, .02, z));
  }
  // distant warehouse
  scene.add(box(60, 9, 16, new THREE.MeshStandardMaterial({ color: 0xb7bdc4, roughness: .9 }), -95, 4.5, -30));
  scene.add(box(60, 2.5, 16.2, new THREE.MeshStandardMaterial({ color: 0x2b4a6b, roughness: .8 }), -95, 1.25, -30));
  // outer bounds (annex extends the footprint east to x≈53)
  // world bounds expanded for the street grid + neighborhood (Overhead layout)
  W.colliders.push({ x0: -78, x1: -76, z0: -60, z1: 188 }, { x0: 148, x1: 150, z0: -60, z1: 188 },
    { x0: -78, x1: 150, z0: -60, z1: -58 }, { x0: -78, x1: 150, z0: 186, z1: 188 });
}

// ============================================================ LOUNGE
// From many break-room trips: the couch corner sits in the NW glass corner (two window walls
// meeting), right next to the ping pong tables. Exactly 2 couches + 1 armchair.
function lounge(scene) {
  // rug centered in the corner group
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.1), new THREE.MeshStandardMaterial({ map: TX.rugTexture(), roughness: .95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-33.9, .015, 12.2);
  scene.add(rug);

  // Bug8: the couch corner lives in the SOUTH window corner
  couch(scene, -33.4, 15.6, Math.PI, 'couchA');   // backs onto south glass, faces in
  couch(scene, -36.6, 10.6, Math.PI / 2, 'couchB'); // backs onto west glass, faces east
  armchair(scene, -36.3, 14.6, Math.PI * .75, 'arm1'); // angled in the corner
  coffeeTable(scene, -34.6, 11.6);

  tapeZone(scene, -33.4, 15.6, 2.6, 1.6, 'COUCH');
  tapeZone(scene, -36.6, 10.6, 1.6, 2.6, 'COUCH');
  tapeZone(scene, -36.3, 14.6, 1.5, 1.5, 'COUCH');
  plant(scene, -37.1, 16.2);
  plant(scene, -31.2, 16.3);

  // bookshelves w/ board games + banner flanking the entrance vestibule
  bookshelf(scene, -37.2, -3.6, Math.PI / 2);
  bookshelf(scene, -37.2, 3.6, Math.PI / 2);
  for (const [x, z] of [[-36.8, 6.4], [-25.6, 15.8], [-35.8, 8.6]]) plant(scene, x, z);

  // hazard tape square just inside the entrance (from trips)
  const hz = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: TX.hazardSquareTexture(), transparent: true }));
  hz.rotation.x = -Math.PI / 2; hz.position.set(-30.5, .014, 1.6);
  scene.add(hz);
  // stacked chairs swap to the north side where the couches were + tape
  stackedChairs(scene, -33.5, -15.7);
  stackedChairs(scene, -31.9, -15.7);
  stackedChairs(scene, -30.3, -15.7, true);
  tapeZone(scene, -31.9, -15.4, 4.6, 1.5, 'STACK');
  // water cooler + trash near the games corner
  waterCooler(scene, -34.7, -12.9);
  trash(scene, -33.6, -12.9, 0x6a6e73);
  trash(scene, -14.5, -15.6, 0x2a63c9); // recycle by exit door
}

function couch(scene, x, z, ry, id) {
  const g = new THREE.Group();
  g.add(box(2.5, .5, 1.05, M.leather, 0, .32, 0));
  g.add(box(2.5, .62, .3, M.leather, 0, .82, -.42));
  g.add(box(.3, .38, 1.05, M.leather, -1.13, .68, 0));
  g.add(box(.3, .38, 1.05, M.leather, 1.13, .68, 0));
  // cushion seams
  g.add(box(2.4, .1, .95, new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: .5 }), 0, .58, .03));
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  collide(x, z, ry % Math.PI === 0 ? 2.6 : 1.15, ry % Math.PI === 0 ? 1.15 : 2.6);
  const fwd = [Math.sin(ry), Math.cos(ry)];
  for (const off of [-.75, 0, .75]) {
    const sx = x + Math.cos(ry) * off, sz = z - Math.sin(ry) * off;
    W.seats.push({ id: `${id}-${off}`, x: sx, z: sz, y: .62, ry, type: 'couch', exitX: sx + fwd[0] * 1.1, exitZ: sz + fwd[1] * 1.1 });
  }
}
function armchair(scene, x, z, ry, id) {
  const g = new THREE.Group();
  g.add(box(1.15, .5, 1.0, M.leather, 0, .32, 0));
  g.add(box(1.15, .6, .3, M.leather, 0, .8, -.4));
  g.add(box(.28, .36, 1.0, M.leather, -.55, .66, 0));
  g.add(box(.28, .36, 1.0, M.leather, .55, .66, 0));
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  collide(x, z, 1.2, 1.2);
  W.seats.push({ id, x, z, y: .62, ry, type: 'couch', exitX: x + Math.sin(ry) * 1.1, exitZ: z + Math.cos(ry) * 1.1 });
}
function coffeeTable(scene, x, z) {
  const g = new THREE.Group();
  const top = cyl(.55, .55, .05, M.woodDark, 0, .42, 0, 20);
  g.add(top);
  g.add(cyl(.4, .4, .04, M.woodDark, 0, .18, 0, 20));
  g.add(cyl(.05, .07, .42, M.blackMetal, 0, .21, 0, 10));
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, 1.1, 1.1);
}
function bookshelf(scene, x, z, ry) {
  const g = new THREE.Group();
  g.add(box(1.1, 1.5, .35, M.woodDark, 0, .75, 0));
  const inner = new THREE.MeshStandardMaterial({ color: 0x2c2119, roughness: .9 });
  for (const y of [.35, .8, 1.25]) g.add(box(1.0, .3, .3, inner, 0, y, .04));
  // board game boxes
  for (let i = 0; i < 8; i++) {
    const bg = box(.22, .08 + Math.random() * .05, .26,
      new THREE.MeshStandardMaterial({ color: [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xd35400][i % 6], roughness: .7 }),
      -.38 + (i % 4) * .25, .43 + Math.floor(i / 4) * .45 + Math.random() * .05, .06);
    bg.rotation.y = (Math.random() - .5) * .2;
    g.add(bg);
  }
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  collide(x, z, .6, 1.2);
}
function plant(scene, x, z) {
  const g = new THREE.Group();
  g.add(cyl(.26, .2, .4, new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: .8 }), 0, .2, 0, 12));
  const leafM = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: .8, side: THREE.DoubleSide });
  const leafGeo = new THREE.ConeGeometry(.09, 1.15, 5);
  leafGeo.translate(0, .575, 0); // pivot at the base so tilting fans the tip, not the root
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafM);
    const a = i / 9 * Math.PI * 2;
    leaf.position.set(Math.cos(a) * .07, .34, Math.sin(a) * .07);
    leaf.setRotationFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), i % 2 ? .55 : .28);
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, .55, .55);
}
function tapeZone(scene, x, z, w, d, label) {
  const t = new THREE.Mesh(new THREE.PlaneGeometry(w + .8, d + .8), new THREE.MeshBasicMaterial({ map: TX.tapeZoneTexture(label), transparent: true, depthWrite: false }));
  t.rotation.x = -Math.PI / 2; t.position.set(x, .013, z);
  scene.add(t);
}
function stackedChairs(scene, x, z, orange = false) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const m = i === 5 && orange ? M.chairOrange : (i % 2 ? M.chairBrown : new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: .6 }));
    g.add(box(.52, .06, .5, m, 0, .45 + i * .13, 0));
    if (i === 5) g.add(box(.52, .4, .07, m, 0, .45 + i * .13 + .2, -.24));
  }
  g.add(box(.5, .4, .5, M.chrome, 0, .2, 0));
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, .7, .7);
}
function waterCooler(scene, x, z) {
  const g = new THREE.Group();
  g.add(box(.42, 1.1, .42, new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: .5 }), 0, .55, 0));
  g.add(box(.36, .18, .3, new THREE.MeshStandardMaterial({ color: 0x3c81c9, roughness: .3 }), 0, .95, .04));
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, .5, .5);
  inter({ id: `water-${x.toFixed(0)}`, type: 'water', x, z, r: 1.1, label: 'Get water' });
}
function trash(scene, x, z, color) {
  const t = cyl(.3, .26, .75, new THREE.MeshStandardMaterial({ color, roughness: .7 }), x, .38, z, 12);
  scene.add(t);
  collide(x, z, .55, .55);
}

// ============================================================ GAMES CORNER
// From trips: both ping pong tables sit side by side along the solid north wall,
// immediately east of the couch corner; arcade + exit door further along.
function gamesCorner(scene) {
  pingPongTable(scene, 'a', -28.7, -12.4);
  pingPongTable(scene, 'b', -21.3, -12.4);
  arcade(scene, -15.6, -16.2);
  chessTable(scene, -33.2, 4.2);
  connect4(scene, 'a', -36.9, -6.6, Math.PI / 2);   // against west glass by the lounge (from trips)
  connect4(scene, 'b', -27.3, 12.4, -.4);           // mid-floor near the south windows (from trips)
  // loose lime chairs by the pong tables (from trips)
  for (const [x, z, ry] of [[-31.9, -10.6, 2.4], [-25.2, -10.4, -2.8], [-18.2, -13.6, 1.2]]) {
    const c = simpleChair(M.chairGreen);
    c.position.set(x, 0, z); c.rotation.y = ry;
    scene.add(c);
    W.seats.push({ id: `loose-${x.toFixed(0)}`, x, z, y: .5, ry: ry + Math.PI, type: 'chair', exitX: x + Math.sin(ry), exitZ: z + Math.cos(ry) });
  }
  // cornhole board leaning on wall (from trips)
  const ch = box(.62, .04, 1.2, M.wood, 0, 0, 0);
  ch.position.set(-17.8, .6, -16.55); ch.rotation.x = -1.15;
  const hole = cyl(.09, .09, .05, M.blackMetal, -17.8, 1.0, -16.42); hole.rotation.x = -1.15;
  scene.add(ch, hole);
}

function pingPongTable(scene, id, x, z) {
  const g = new THREE.Group();
  g.add(box(2.74, .05, 1.525, M.pongTop, 0, .76, 0));
  // white lines
  const lineM = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: .5 });
  g.add(box(2.74, .052, .03, lineM, 0, .762, 0));
  g.add(box(2.74, .052, .03, lineM, 0, .762, -.75));
  g.add(box(2.74, .052, .03, lineM, 0, .762, .75));
  g.add(box(.03, .052, 1.525, lineM, -1.355, .762, 0));
  g.add(box(.03, .052, 1.525, lineM, 1.355, .762, 0));
  // net
  const net = box(.02, .16, 1.7, new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: .8, transparent: true, opacity: .85 }), 0, .84, 0);
  g.add(net);
  // JOOLA-ish logo plate
  const logoTex = TX.ct(128, 32, (gg, w, h) => {
    gg.fillStyle = '#101418'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#fff'; gg.font = '700 20px Arial'; gg.textAlign = 'center'; gg.fillText('JOOLA', w / 2, 23);
  });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(.7, .17), new THREE.MeshBasicMaterial({ map: logoTex }));
  logo.position.set(0, .68, .79);
  g.add(logo);
  // undercarriage + wheels
  g.add(box(.08, .72, 1.1, M.blackMetal, -.9, .38, 0));
  g.add(box(.08, .72, 1.1, M.blackMetal, .9, .38, 0));
  g.add(box(1.9, .06, .08, M.blackMetal, 0, .12, -.45));
  g.add(box(1.9, .06, .08, M.blackMetal, 0, .12, .45));
  for (const [wx, wz] of [[-.9, -.5], [-.9, .5], [.9, -.5], [.9, .5]]) g.add(cyl(.06, .06, .04, M.chrome, wx, .06, wz, 10));
  // paddles resting on table
  for (const s of [-1, 1]) {
    const pad = cyl(.09, .09, .02, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: .6 }), s * 1.1, .79, s * .3, 12);
    g.add(pad);
    g.add(box(.03, .02, .12, M.woodDark, s * 1.1, .79, s * .3 + .13));
  }
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, 2.9, 1.7);
  tapeZone(scene, x, z, 4.6, 3.4, null);
  // ball
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff8e0, emissiveIntensity: .25 }));
  ball.position.set(x, .95, z); ball.visible = false;
  scene.add(ball);
  W.anchors[`pong-${id}`] = { x, z, ball, ends: [{ x: x - 1.37, z }, { x: x + 1.37, z }] };
  inter({ id: `pong-${id}-0`, type: 'pong', x: x - 2.1, z, r: 1.3, label: `Play ping pong (table ${id.toUpperCase()})`, data: { table: id, side: 0 } });
  inter({ id: `pong-${id}-1`, type: 'pong', x: x + 2.1, z, r: 1.3, label: `Play ping pong (table ${id.toUpperCase()})`, data: { table: id, side: 1 } });
}

function arcade(scene, x, z) {
  const g = new THREE.Group();
  const sideM = new THREE.MeshStandardMaterial({ map: TX.arcadeSideTexture(), roughness: .6 });
  g.add(box(.75, 1.8, .8, new THREE.MeshStandardMaterial({ color: 0xf2c521, roughness: .6 }), 0, .9, 0));
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.8), sideM);
  sideL.rotation.y = -Math.PI / 2; sideL.position.set(-.379, .9, 0);
  const sideR = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.8), sideM);
  sideR.rotation.y = Math.PI / 2; sideR.position.set(.379, .9, 0);
  g.add(sideL, sideR);
  // marquee
  const marqTex = TX.ct(256, 64, (gg, w, h) => {
    gg.fillStyle = '#141414'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffe45c'; gg.font = '900 28px "Courier New", monospace'; gg.textAlign = 'center';
    gg.fillText('PRIME BREAKER', w / 2, 42);
  });
  const marq = new THREE.Mesh(new THREE.PlaneGeometry(.72, .22), new THREE.MeshStandardMaterial({ map: marqTex, emissive: 0xffffff, emissiveMap: marqTex, emissiveIntensity: .6 }));
  marq.position.set(0, 1.72, .41);
  g.add(marq);
  // screen (highscores drawn by minigames.js)
  const scrTex = TX.ct(256, 256, (gg) => { gg.fillStyle = '#000'; gg.fillRect(0, 0, 256, 256); });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.56, .48), new THREE.MeshStandardMaterial({ map: scrTex, emissive: 0xffffff, emissiveMap: scrTex, emissiveIntensity: .7 }));
  scr.position.set(0, 1.25, .41); scr.rotation.x = -.12;
  g.add(scr);
  // control deck
  const deck = box(.7, .08, .3, new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: .5 }), 0, .92, .5);
  deck.rotation.x = .3;
  g.add(deck);
  g.add(cyl(.03, .03, .12, M.chrome, -.15, 1.02, .52, 8));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: .4 })).translateX(-.15).translateY(1.1).translateZ(.5));
  for (const bx of [.08, .22]) g.add(cyl(.035, .035, .03, new THREE.MeshStandardMaterial({ color: 0xffde3b }), bx, 1.0, .53, 10));
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, .9, .95);
  W.anchors.arcadeScreen = scrTex;
  inter({ id: 'arcade', type: 'arcade', x, z: z + 1.1, r: 1.2, label: 'Play PRIME BREAKER' });
}

function chessTable(scene, x, z) {
  const g = new THREE.Group();
  g.add(box(1.0, .06, 1.0, M.woodDark, 0, .72, 0));
  g.add(cyl(.06, .08, .7, M.blackMetal, 0, .36, 0, 10));
  g.add(box(.5, .04, .5, M.blackMetal, 0, .02, 0));
  // checker board texture
  const bTex = TX.ct(256, 256, (gg, w, h) => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      gg.fillStyle = (r + c) % 2 ? '#7a5a3a' : '#e8d9b8';
      gg.fillRect(c * 32, r * 32, 32, 32);
    }
    gg.strokeStyle = '#4a3520'; gg.lineWidth = 6; gg.strokeRect(0, 0, w, h);
  });
  const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(.72, .03, .72), new THREE.MeshStandardMaterial({ map: bTex, roughness: .6 }));
  boardMesh.position.y = .765;
  g.add(boardMesh);
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, 1.1, 1.1);
  // two green chairs facing each other (white sits at -x)
  for (const s of [-1, 1]) {
    const c = simpleChair(M.chairGreen);
    c.position.set(x + s * .95, 0, z);
    c.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(c);
  }
  // invisible pick squares
  const squares = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = new THREE.Mesh(new THREE.BoxGeometry(.09, .02, .09), new THREE.MeshBasicMaterial({ visible: false }));
    // white (row 7) toward -x chair: board row 0 (black back rank) at +x
    sq.position.set(x + (3.5 - r) * .09, .79, z + (c - 3.5) * .09);
    sq.userData = { r, c };
    scene.add(sq);
    squares.push(sq);
  }
  W.pick.chess = squares;
  W.anchors.chess = { x, z, y: .79, cell: .09, group: new THREE.Group() };
  scene.add(W.anchors.chess.group);
  inter({ id: 'chess', type: 'chess', x, z, r: 1.7, label: 'Play chess' });
}

function simpleChair(mat) {
  const g = new THREE.Group();
  g.add(box(.46, .05, .45, mat, 0, .46, 0));
  const back = box(.46, .45, .05, mat, 0, .78, -.2);
  back.rotation.x = -.12;
  g.add(back);
  for (const [lx, lz] of [[-.19, -.18], [.19, -.18], [-.19, .18], [.19, .18]])
    g.add(cyl(.015, .015, .46, M.chrome, lx, .23, lz, 6));
  return g;
}

function connect4(scene, id, x, z, ry) {
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardMaterial({ color: 0x1a4fb4, roughness: .5 });
  // frame with 42 holes (visual: front/back plates + hole discs via texture)
  const plateTex = TX.ct(256, 220, (gg, w, h) => {
    gg.fillStyle = '#1a4fb4'; gg.fillRect(0, 0, w, h);
    // punch real holes so the discs inside are visible
    gg.globalCompositeOperation = 'destination-out';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      gg.beginPath(); gg.arc(20 + c * 36, 18 + r * 31, 13, 0, 7); gg.fill();
    }
    gg.globalCompositeOperation = 'source-over';
    gg.strokeStyle = '#0d2a66'; gg.lineWidth = 3;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      gg.beginPath(); gg.arc(20 + c * 36, 18 + r * 31, 13, 0, 7); gg.stroke();
    }
  });
  const plateM = new THREE.MeshStandardMaterial({ map: plateTex, roughness: .5, transparent: true, alphaTest: .4, side: THREE.DoubleSide });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.45), plateM); front.position.set(0, 1.02, .1);
  const backP = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.45), plateM); backP.position.set(0, 1.02, -.1); backP.rotation.y = Math.PI;
  g.add(front, backP);
  g.add(box(1.9, .1, .3, blue, 0, .32, 0));
  g.add(box(.1, 1.55, .22, blue, -.95, 1.05, 0));
  g.add(box(.1, 1.55, .22, blue, .95, 1.05, 0));
  // legs
  g.add(box(.12, .32, .7, blue, -.89, .16, 0));
  g.add(box(.12, .32, .7, blue, .89, .16, 0));
  g.position.set(x, 0, z); g.rotation.y = ry;
  g.scale.setScalar(.72); // real one is ~4 ft tall (from trips)
  scene.add(g);
  collide(x, z, 1.6, .8);
  // disc pool (42) — laid out by minigames.js in board-local coords then transformed
  const discGeo = new THREE.CylinderGeometry(.115, .115, .16, 16);
  const discRed = new THREE.MeshStandardMaterial({ color: 0xd63a2f, roughness: .5 });
  const discYel = new THREE.MeshStandardMaterial({ color: 0xf2c521, roughness: .5 });
  const discs = [];
  for (let i = 0; i < 42; i++) {
    const dm = new THREE.Mesh(discGeo, discRed);
    dm.rotation.x = Math.PI / 2;
    dm.visible = false;
    g.add(dm);
    discs.push(dm);
  }
  // pick columns (invisible boxes above board)
  const cols = [];
  for (let c = 0; c < 7; c++) {
    const cm = new THREE.Mesh(new THREE.BoxGeometry(.25, 1.5, .35), new THREE.MeshBasicMaterial({ visible: false }));
    cm.position.set(-.81 + c * .27, 1.05, 0);
    cm.userData = { col: c };
    g.add(cm);
    cols.push(cm);
  }
  // column hover indicator
  const hover = new THREE.Mesh(new THREE.ConeGeometry(.1, .18, 4), new THREE.MeshBasicMaterial({ color: 0x37e06f }));
  hover.rotation.x = Math.PI; hover.visible = false;
  g.add(hover);
  W.pick.c4[id] = cols;
  W.anchors[`c4-${id}`] = { group: g, discs, discRed, discYel, hover, x, z };
  inter({ id: `c4-${id}`, type: 'c4', x: x + Math.sin(ry) * 1.2, z: z + Math.cos(ry) * 1.2, r: 2.0, label: 'Play giant Connect 4', data: { board: id } });
}

// ============================================================ DINING
function dining(scene) {
  const clusters = [];
  // zone order from trips, west→east: brown, green, orange, yellow
  const zoneMats = [M.chairBrown, M.chairGreen, M.chairOrange, M.chairYellow];
  const xStarts = [-8.2, 2.0, 12.2, 22.4];
  const rows = [-14, -11.3, -8.6, -5.9, -3.2, 3.2, 5.9, 8.6, 11.3, 14];
  for (let zi = 0; zi < 4; zi++) for (const rz of rows) clusters.push({ x: xStarts[zi] + 3.6, z: rz, zone: zi });

  // each cluster = four 6-ft (1.78 m) folding tables butted end to end, with
  // visible seams and folding legs at each table end (from trips)
  const TL = 1.78, GAP = .045, PER = 4;
  const topGeo = new THREE.BoxGeometry(TL, .05, .76);
  const edgeGeo = new THREE.BoxGeometry(TL + .02, .07, .8);
  const tops = new THREE.InstancedMesh(topGeo, M.tableTop, clusters.length * PER);
  const edges = new THREE.InstancedMesh(edgeGeo, M.blackMetal, clusters.length * PER);
  const legGeo = new THREE.CylinderGeometry(.018, .022, .72, 6);
  const legs = new THREE.InstancedMesh(legGeo, M.blackMetal, clusters.length * PER * 4);
  const o = new THREE.Object3D();
  let ti = 0, li = 0;
  clusters.forEach((cl) => {
    for (let t = 0; t < PER; t++) {
      const tx = cl.x + (t - (PER - 1) / 2) * (TL + GAP);
      o.rotation.set(0, 0, 0);
      o.position.set(tx, .745, cl.z); o.updateMatrix();
      tops.setMatrixAt(ti, o.matrix);
      o.position.set(tx, .705, cl.z); o.updateMatrix();
      edges.setMatrixAt(ti++, o.matrix);
      // folding wire legs: an angled pair near each end
      for (const lx of [-TL / 2 + .18, TL / 2 - .18]) for (const lz of [-.26, .26]) {
        o.position.set(tx + lx, .36, cl.z + lz * .7);
        o.rotation.set(.35 * (lz > 0 ? 1 : -1), 0, 0);
        o.updateMatrix();
        legs.setMatrixAt(li++, o.matrix);
      }
    }
    collide(cl.x, cl.z, PER * (TL + GAP) + .1, .8);
  });
  scene.add(tops, edges, legs);

  // chairs packed tight, ~0.72 m pitch, 10 per side (shoulder-to-shoulder)
  const seatGeo = new THREE.BoxGeometry(.46, .05, .45);
  const backGeo = new THREE.BoxGeometry(.46, .48, .05);
  const sledGeo = new THREE.CylinderGeometry(.016, .016, .5, 6);
  const perZone = [[], [], [], []];
  const rowSpan = PER * (TL + GAP);
  clusters.forEach((cl) => {
    for (let ci = 0; ci < 10; ci++) {
      const cx = cl.x - rowSpan / 2 + .55 + ci * ((rowSpan - 1.1) / 9);
      for (const s of [-1, 1]) {
        perZone[cl.zone].push({ x: cx, z: cl.z + s * .62, ry: s > 0 ? Math.PI : 0 });
      }
    }
  });
  perZone.forEach((list, zi) => {
    const seats = new THREE.InstancedMesh(seatGeo, zoneMats[zi], list.length);
    const backs = new THREE.InstancedMesh(backGeo, zoneMats[zi], list.length);
    const sleds = new THREE.InstancedMesh(sledGeo, M.chrome, list.length * 2);
    let si = 0;
    list.forEach((c, i) => {
      o.rotation.set(0, c.ry, 0);
      o.position.set(c.x, .46, c.z); o.updateMatrix(); seats.setMatrixAt(i, o.matrix);
      const bo = new THREE.Object3D();
      bo.position.set(c.x - Math.sin(c.ry) * .21, .78, c.z - Math.cos(c.ry) * .21);
      bo.rotation.set(0, c.ry, 0); bo.updateMatrix(); backs.setMatrixAt(i, bo.matrix);
      for (const s of [-1, 1]) {
        const so = new THREE.Object3D();
        so.position.set(c.x + Math.cos(c.ry) * s * .2, .24, c.z - Math.sin(c.ry) * s * .2);
        so.rotation.set(Math.PI / 2 * .06, c.ry, .06); so.updateMatrix();
        sleds.setMatrixAt(si++, so.matrix);
      }
      W.seats.push({ id: `dine-${zi}-${i}`, x: c.x, z: c.z, y: .5, ry: c.ry + Math.PI, type: 'chair', exitX: c.x, exitZ: c.z + (c.z > 0 ? 1 : -1) * 0 + Math.cos(c.ry) * .9 });
    });
    scene.add(seats, backs, sleds);
  });

  // table clutter: napkin dispensers (black) + july newsletters (white tents) + sanitizer
  const dispGeo = new THREE.BoxGeometry(.16, .2, .12);
  const dispM = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: .4 });
  const disps = new THREE.InstancedMesh(dispGeo, dispM, clusters.length * 2);
  const tentGeo = new THREE.PlaneGeometry(.17, .22);
  const tentM = new THREE.MeshStandardMaterial({ map: TX.newsletterTexture(), side: THREE.DoubleSide, roughness: .8 });
  const tents = new THREE.InstancedMesh(tentGeo, tentM, clusters.length * 2);
  const sanGeo = new THREE.CylinderGeometry(.03, .035, .14, 8);
  const sanM = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: .3, transparent: true, opacity: .85 });
  const sans = new THREE.InstancedMesh(sanGeo, sanM, clusters.length);
  let di = 0, ni = 0;
  clusters.forEach((cl, i) => {
    for (const s of [-1, 1]) {
      o.rotation.set(0, Math.random() * Math.PI, 0);
      o.position.set(cl.x + s * 1.8, .86, cl.z); o.updateMatrix();
      disps.setMatrixAt(di++, o.matrix);
      const to2 = new THREE.Object3D();
      to2.position.set(cl.x + s * 2.6, .87, cl.z);
      to2.rotation.set(-.25, s > 0 ? .4 : Math.PI - .4, 0);
      to2.updateMatrix();
      tents.setMatrixAt(ni++, to2.matrix);
    }
    o.rotation.set(0, 0, 0);
    o.position.set(cl.x + .6, .83, cl.z); o.updateMatrix();
    sans.setMatrixAt(i, o.matrix);
  });
  scene.add(disps, tents, sans);

  // window-side laptop cart with orange chair + blue CABLE tape (from trips)
  const cart = new THREE.Group();
  cart.add(box(.7, 1.1, .55, new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: .5 }), 0, .55, 0));
  cart.add(box(.42, .26, .03, new THREE.MeshStandardMaterial({ color: 0x1b2731, roughness: .25 }), 0, 1.28, -.1)); // laptop screen
  cart.add(box(.42, .02, .28, new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: .4 }), 0, 1.11, .06));
  cart.position.set(6, 0, 16.1);
  scene.add(cart);
  collide(6, 16.1, .8, .7);
  const oc = simpleChair(M.chairOrange);
  oc.position.set(5.2, 0, 15.2); oc.rotation.y = .5;
  scene.add(oc);
  const cable = new THREE.Mesh(new THREE.PlaneGeometry(.28, 3.2), new THREE.MeshBasicMaterial({ color: 0x1f6fd6, transparent: true, opacity: .85 }));
  cable.rotation.x = -Math.PI / 2; cable.position.set(6, .012, 14.4);
  scene.add(cable);
}

// ============================================================ AVENUE C MARKET (east wall) + NORTH WALL
function market(scene) {
  // wood-look header bands on the east wall, split around the annex passage
  scene.add(box(.25, 1.0, 14.5, M.wood, 37.7, 3.3, -9.75));
  scene.add(box(.25, 1.0, 12.8, M.wood, 37.7, 3.3, 10.6));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, .66), new THREE.MeshStandardMaterial({ map: TX.avenueCTexture() }));
  sign.rotation.y = -Math.PI / 2; sign.position.set(37.5, 3.3, -8);
  scene.add(sign);
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(3.6, .58), new THREE.MeshStandardMaterial({ map: TX.avenueCTexture() }));
  signB.rotation.y = -Math.PI / 2; signB.position.set(37.5, 3.3, 8);
  scene.add(signB);
  // sign above north lockers too (from trips)
  const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .55), new THREE.MeshStandardMaterial({ map: TX.avenueCTexture() }));
  sign2.position.set(29, 3.1, -16.8);
  scene.add(sign2);

  // drink coolers (south of center) + food coolers + red bull
  let zPos = -13.5;
  cooler(scene, 37.4, zPos, 'redbull'); zPos += 1.2;
  for (let i = 0; i < 5; i++) { cooler(scene, 37.4, zPos, 'drinks'); zPos += 1.1; }
  for (let i = 0; i < 4; i++) { cooler(scene, 37.4, zPos, 'food'); zPos += 1.1; }
  // snack slat-walls
  for (const sz of [4.8, 8.6] ) snackWall(scene, 37.6, sz);
  // self-checkout kiosks
  kiosk(scene, 34.6, -3.6, -Math.PI / 2 - .4);
  kiosk(scene, 34.6, 3.6, -Math.PI / 2 + .4);
  // coffee station (SE corner)
  coffeeStation(scene, 35.5, 13.5);
  // microwave counter north of market
  counterUnit(scene, 34, -13.5);

  // ---- north wall fixtures ----
  // Pepsi machines (from trips)
  for (let i = 0; i < 4; i++) vending(scene, -2.5 + i * 1.15, -16.35, i < 2 ? 'pepsi' : 'snack');
  // lockers (from trips)
  for (let i = 0; i < 5; i++) lockers(scene, 23.5 + i * 2.1, -16.5);
  // trash + recycle near market
  trash(scene, 20.5, -16.2, 0x2a63c9);
  trash(scene, 21.6, -16.2, 0x6a6e73);
}

function cooler(scene, x, z, kind) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(.8, 2.1, 1.05), new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: .5 }));
  c.position.set(x, 1.05, z);
  scene.add(blocker(c));
  const ctex = TX.coolerTexture(kind);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.05), new THREE.MeshStandardMaterial({ map: ctex, emissive: 0xffffff, emissiveMap: ctex, emissiveIntensity: .32 }));
  face.rotation.y = -Math.PI / 2; face.position.set(x - .42, 1.05, z);
  scene.add(face);
  collide(x, z, 1.0, 1.1);
  inter({ id: `cooler-${z.toFixed(1)}`, type: 'vend', x: x - .9, z, r: 1.0, label: kind === 'food' ? 'Grab fresh food' : kind === 'redbull' ? 'Grab an energy drink' : 'Grab a drink', data: { kind } });
}
function snackWall(scene, x, z) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshStandardMaterial({ map: TX.snackWallTexture(), roughness: .8 }));
  s.rotation.y = -Math.PI / 2; s.position.set(x - .1, 1.55, z);
  scene.add(s);
  collide(x, z, .5, 3.5);
  inter({ id: `snack-${z}`, type: 'vend', x: x - .8, z, r: 1.2, label: 'Grab a snack', data: { kind: 'snack' } });
}
function kiosk(scene, x, z, ry) {
  const g = new THREE.Group();
  g.add(box(.55, 1.05, .5, new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: .5 }), 0, .53, 0));
  const ktex = TX.kioskScreenTexture();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.42, .52), new THREE.MeshStandardMaterial({ map: ktex, emissive: 0xffffff, emissiveMap: ktex, emissiveIntensity: .5 }));
  scr.position.set(0, 1.28, .1); scr.rotation.x = -.25;
  g.add(scr);
  g.add(box(.46, .6, .06, new THREE.MeshStandardMaterial({ color: 0x1a1c20 }), 0, 1.22, .04));
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  collide(x, z, .7, .7);
}
function coffeeStation(scene, x, z) {
  const g = new THREE.Group();
  g.add(box(2.6, .9, .8, new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: .7 }), 0, .45, 0));
  g.add(box(2.6, .05, .85, M.blackMetal, 0, .92, 0));
  // two coffee brewers + airpots
  for (const ox of [-.8, -.1]) {
    g.add(box(.34, .5, .4, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .4 }), ox, 1.2, -.1));
    g.add(box(.3, .06, .3, M.chrome, ox, .97, .05));
  }
  for (const ox of [.5, .8, 1.1]) g.add(cyl(.09, .11, .36, M.chrome, ox, 1.13, 0, 10));
  g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2;
  scene.add(g);
  collide(x, z, 1.0, 2.7);
  inter({ id: 'coffee', type: 'coffee', x: x - .9, z, r: 1.2, label: 'Pour coffee' });
}
function counterUnit(scene, x, z) {
  const g = new THREE.Group();
  g.add(box(2.0, .9, .7, new THREE.MeshStandardMaterial({ color: 0x54483c, roughness: .8 }), 0, .45, 0));
  for (const ox of [-.6, .1]) {
    g.add(box(.5, .32, .45, new THREE.MeshStandardMaterial({ color: 0x191a1e, roughness: .4 }), ox, 1.08, 0));
    g.add(box(.34, .2, .02, new THREE.MeshStandardMaterial({ color: 0x2c3844, roughness: .2 }), ox - .02, 1.08, .23));
  }
  g.position.set(x, 0, z);
  scene.add(g);
  collide(x, z, 2.1, .8);
  inter({ id: 'micro', type: 'micro', x, z: z + .9, r: 1.1, label: 'Heat up lunch' });
}
function vending(scene, x, z, kind) {
  const v = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, .85), new THREE.MeshStandardMaterial({ color: kind === 'pepsi' ? 0x0e3a8c : 0x3d3f45, roughness: .5 }));
  v.position.set(x, .95, z);
  scene.add(blocker(v));
  const tex = TX.vendingTexture(kind);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.96, 1.86), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .28 }));
  face.position.set(x, .95, z + .44);
  scene.add(face);
  collide(x, z, 1.05, .9);
  inter({ id: `vend-${x.toFixed(1)}`, type: 'vend', x, z: z + 1.0, r: 1.0, label: kind === 'pepsi' ? 'Buy a soda' : 'Buy a snack', data: { kind: kind === 'pepsi' ? 'soda' : 'snack' } });
}
let lockerTexShared = null;
function lockers(scene, x, z, ry = 0) {
  lockerTexShared ||= TX.lockersTexture();
  const g = new THREE.Group();
  const body = box(2.0, 1.9, .5, new THREE.MeshStandardMaterial({ color: 0xd6cfc0, roughness: .7 }), 0, .95, 0);
  g.add(body);
  W.camBlockers.push(body);
  // sloped crown like the real locker banks
  const crown = box(2.0, .06, .6, new THREE.MeshStandardMaterial({ color: 0xc7bfae, roughness: .7 }), 0, 2.0, -.04);
  crown.rotation.x = -.4;
  g.add(crown);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 1.86), new THREE.MeshStandardMaterial({ map: lockerTexShared, roughness: .7 }));
  face.position.set(0, .95, .26);
  g.add(face);
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  const flip = Math.abs(Math.sin(ry)) > .5;
  collide(x, z, flip ? .6 : 2.05, flip ? 2.05 : .6);
}

// ============================================================ FLAGS / TVS / CLOCKS
function decor(scene) {
  // flags at the top, all the way around the room (on every wall
  // carries a band of international flags near the ceiling)
  const flagAt = (name, x, z, ry, big = false) => {
    const fl = new THREE.Mesh(
      new THREE.PlaneGeometry(big ? 2.1 : 1.45, big ? 1.3 : .92),
      new THREE.MeshStandardMaterial({ map: TX.flagTexture(name), side: THREE.DoubleSide, roughness: .9 }));
    fl.position.set(x, big ? 4.7 : 4.35, z);
    fl.rotation.y = ry;
    fl.rotation.z = (Math.random() - .5) * .09;
    scene.add(fl);
  };
  let fi = 0;
  const next = () => TX.FLAG_NAMES[fi++ % TX.FLAG_NAMES.length];
  // west glass: big flags hanging over the windows (from trips)
  for (let z = -15; z <= 15; z += 3.4) flagAt(next(), -37.4, z, Math.PI / 2, true);
  // games-corner gray wall row (El Salvador, Haiti, USA, Finland, Brazil, Nepal)
  for (const [i, f] of ['elsalvador', 'haiti', 'usa', 'kyrgyzstan', 'finland', 'brazil', 'nepal'].entries())
    flagAt(f, -26 + i * 1.9, -16.72, 0);
  // north wall band, dining stretch
  for (let x = -10; x <= 36; x += 2.6) flagAt(next(), x, -16.72, 0);
  // south wall band (hangs in front of the glass, like the real one)
  for (let x = -28; x <= 36; x += 2.6) flagAt(next(), x, 16.72, Math.PI);
  // east wall band above the market
  for (let z = -15; z <= 15; z += 2.6) flagAt(next(), 37.6, z, -Math.PI / 2);
  // flags strung on wires ACROSS the hall (walk-through shows transverse strings)
  for (const wx of [-2, 14]) {
    scene.add(box(.02, .02, 31, M.blackMetal, wx, 4.62, 0));
    for (let z = -13.8; z <= 13.8; z += 2.3) flagAt(next(), wx, z, Math.PI / 2);
  }

  // TVs — dynamic canvases
  W.dynamic.tvs = [];
  const tvSpots = [
    { x: -37.6, y: 3.4, z: -8, ry: Math.PI / 2 },   // west glass wall TV (from trips)
    { x: 4, y: 3.6, z: -16.8, ry: 0 },
    { x: 12, y: 3.6, z: 16.8, ry: Math.PI },
    { x: 37.6, y: 4.65, z: -8, ry: -Math.PI / 2 },
    { x: 37.6, y: 4.65, z: 8, ry: -Math.PI / 2 },
  ];
  for (const s of tvSpots) {
    const tv = TX.makeTV();
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.24), new THREE.MeshStandardMaterial({ map: tv.tex, emissive: 0xffffff, emissiveMap: tv.tex, emissiveIntensity: .5 }));
    scr.position.set(s.x, s.y, s.z); scr.rotation.y = s.ry;
    scene.add(scr);
    const frame = box(2.3, 1.34, .06, M.blackMetal, s.x, s.y, s.z);
    frame.rotation.y = s.ry;
    frame.translateZ(-.04);
    scene.add(frame);
    W.dynamic.tvs.push(tv);
  }
  // red LED clocks (from trips)
  W.dynamic.clocks = [];
  for (const s of [{ x: -25, y: 3.9, z: -16.85, ry: 0 }, { x: 30, y: 3.4, z: 16.85, ry: Math.PI }, { x: 37.8, y: 3.9, z: 2.5, ry: -Math.PI / 2 }]) {
    const ck = TX.makeClock();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.85, .32), new THREE.MeshBasicMaterial({ map: ck.tex }));
    m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry;
    scene.add(m);
    W.dynamic.clocks.push(ck);
  }
  // exit signs
  const exitM = new THREE.MeshBasicMaterial({ map: TX.ct(128, 48, (g, w, h) => { g.fillStyle = '#200'; g.fillRect(0, 0, w, h); g.fillStyle = '#f33'; g.font = '900 30px Arial'; g.textAlign = 'center'; g.fillText('EXIT', w / 2, 36); }) });
  for (const s of [{ x: 14.5, z: -16.6, ry: 0 }, { x: -36.5, z: 0, ry: Math.PI / 2, y: 2.9 }]) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(.5, .2), exitM);
    e.position.set(s.x, s.y || 2.6, s.z); e.rotation.y = s.ry;
    scene.add(e);
  }
}

// ============================================================ LIGHTS
function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xf2f5f8, 0x54575c, 1.05));
  const sun = new THREE.DirectionalLight(0xffeed8, 1.35);
  sun.position.set(-30, 26, 14);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, .5);
  fill.position.set(30, 20, -10);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, .28));
}

// ============================================================ SERVICE HALLWAY (z -17.3..-22.3)
// From many break-room trips: long corridor behind the cafeteria north wall —
// microwave/coffee counter, ice machine, chest freezer, bag racks, bulletin
// boards, bathrooms, V.STORAGE door; smoke-cage patio at the far west end.
function serviceHallway(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 5), new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: .4, metalness: .06 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, .001, -19.8);
  scene.add(floor);
  // shell: north wall (with bathroom + smoke-door gaps), end walls, drop ceiling
  scene.add(blocker(box(2.1, 3.4, .25, M.white, -28.95, 1.7, -22.3)));
  scene.add(blocker(box(14.1, 3.4, .25, M.white, -19.45, 1.7, -22.3)));
  scene.add(blocker(box(2.6, 3.4, .25, M.white, -9.1, 1.7, -22.3)));
  scene.add(blocker(box(2.6, 3.4, .25, M.white, -3.9, 1.7, -22.3)));
  scene.add(blocker(box(32.6, 3.4, .25, M.white, 13.7, 1.7, -22.3)));
  scene.add(blocker(box(.25, 3.4, 5.4, M.white, -30, 1.7, -19.8)));
  scene.add(blocker(box(.25, 3.4, 5.4, M.white, 30, 1.7, -19.8)));
  collide(-28.95, -22.3, 2.1, .5); collide(-19.45, -22.3, 14.1, .5); collide(-9.1, -22.3, 2.6, .5); collide(-3.9, -22.3, 2.6, .5);
  collide(13.7, -22.3, 32.6, .5); collide(-30, -19.8, .5, 5.5); collide(30, -19.8, .5, 5.5);
  const tile = TX.ct(256, 256, (g, w, h) => {
    g.fillStyle = '#eceeef'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9ccd0'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
  }, { repeat: [24, 2] });
  // one-sided (visible from below only) so the 3P camera riding at ceiling
  // height doesn't catch the plane edge-on as a white wedge (Bug27)
  scene.add(blocker(new (class extends THREE.Mesh {})(new THREE.PlaneGeometry(60, 5.4), new THREE.MeshStandardMaterial({ map: tile, roughness: .95 }))));
  const ceil = scene.children[scene.children.length - 1];
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.15, -19.8);
  tile.anisotropy = 8; // keep the grid readable at grazing camera angles (Bug27)
  // segmented center light fixtures — a single 56 m emissive strip read as a
  // giant white wedge when viewed edge-on just under the drop ceiling
  const lin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .8 });
  for (let i = -4; i <= 4; i++) scene.add(box(4.2, .05, .28, lin, i * 6.2, 3.08, -19.8));

  // ---- south side: microwave/coffee counter run (from trips) ----
  const counter = new THREE.Group();
  counter.add(box(24, .9, .7, new THREE.MeshStandardMaterial({ color: 0x6a6e73, roughness: .6, metalness: .3 }), 0, .45, 0));
  counter.add(box(24, .05, .78, new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: .4 }), 0, .93, 0));
  counter.add(box(24, .05, .55, new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: .6 }), 0, 1.5, -.1)); // upper shelf
  counter.position.set(-14, 0, -17.85);
  scene.add(counter);
  collide(-14, -17.85, 24, .85);
  // microwaves on two tiers (instanced)
  const mwGeo = new THREE.BoxGeometry(.5, .32, .42);
  const mwM = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: .4 });
  const mws = new THREE.InstancedMesh(mwGeo, mwM, 16);
  const o = new THREE.Object3D();
  for (let i = 0; i < 16; i++) {
    o.position.set(-25 + (i % 8) * 2.1, i < 8 ? 1.12 : 1.7, -17.9);
    o.updateMatrix(); mws.setMatrixAt(i, o.matrix);
  }
  scene.add(mws);
  inter({ id: 'hall-micro', type: 'micro', x: -14, z: -19, r: 2.6, label: 'Heat up lunch' });
  // coffee machine + cup rack (from trips)
  scene.add(box(.55, .85, .5, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .35 }), -27.3, 1.35, -17.9));
  scene.add(box(.3, .2, .02, new THREE.MeshStandardMaterial({ color: 0x2a72b8, roughness: .2, emissive: 0x1a4a80, emissiveIntensity: .4 }), -27.35, 1.55, -17.62));
  for (let i = 0; i < 3; i++) scene.add(cyl(.055, .04, .3, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: .5 }), -26.6 + i * .18, 1.85, -17.9, 8));
  inter({ id: 'hall-coffee', type: 'coffee', x: -27, z: -19, r: 1.6, label: 'Brew a coffee' });
  // ice/water machine + chest freezer + caution cone (from trips)
  scene.add(box(1.0, 1.7, .8, new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: .3, metalness: .5 }), .8, .85, -17.9));
  scene.add(box(.5, .3, .1, new THREE.MeshStandardMaterial({ color: 0x14181d }), .8, .8, -17.44));
  collide(.8, -17.9, 1.1, .9);
  inter({ id: 'hall-water', type: 'water', x: .8, z: -19, r: 1.4, label: 'Get ice water' });
  scene.add(box(1.5, .85, .7, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: .5 }), 2.6, .43, -17.9));
  collide(2.6, -17.9, 1.6, .8);
  const cone = cyl(.03, .16, .5, new THREE.MeshStandardMaterial({ color: 0xf2c521, roughness: .6 }), 3.9, .25, -18.6, 8);
  scene.add(cone);
  // dark vending pair with glowing dots further along
  for (const vx of [6.5, 7.7]) {
    scene.add(blocker(box(1.1, 1.9, .8, new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .5 }), vx, .95, -17.95)));
    scene.add(box(.7, 1.2, .02, new THREE.MeshStandardMaterial({ color: 0x1c62d1, emissive: 0x1c62d1, emissiveIntensity: .7, roughness: .4 }), vx, 1.05, -17.53));
    collide(vx, -17.95, 1.15, .85);
  }

  // ---- north side: racks, boards, bins, storage door, bathrooms ----
  const rackM = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .6 });
  for (const rx of [14, 20]) {
    for (let s = 0; s < 4; s++) scene.add(box(1.6, .04, .5, rackM, rx, .35 + s * .45, -21.9));
    for (const [px, pz] of [[-.78, -.23], [.78, -.23], [-.78, .23], [.78, .23]]) scene.add(cyl(.018, .018, 1.9, rackM, rx + px, .95, -21.9 + pz, 6));
    scene.add(box(.5, .3, .35, new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: .8 }), rx - .3, 1.55, -21.9));
    scene.add(box(.45, .28, .3, new THREE.MeshStandardMaterial({ color: 0x555149, roughness: .8 }), rx + .4, .65, -21.9));
    collide(rx, -21.9, 1.7, .6);
  }
  const boardTex = TX.ct(256, 160, (g, w, h) => {
    g.fillStyle = '#b8926a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) g.fillRect(12 + (i % 4) * 60, 14 + Math.floor(i / 4) * 72, 48, 60);
    g.fillStyle = '#e8720c'; g.fillRect(12, 14, 48, 60);
  });
  for (const bx2 of [-14, 5]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ map: boardTex, roughness: .8 }));
    b.position.set(bx2, 1.6, -22.15);
    scene.add(b);
  }
  trash(scene, 9.5, -21.8, 0x6a6e73);
  trash(scene, -16.5, -21.8, 0x6a6e73);
  // V.STORAGE door + label
  scene.add(box(1.1, 2.4, .1, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: .7 }), -25.5, 1.2, -22.2));
  const vsTex = TX.ct(192, 48, (g, w, h) => {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 20px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('1121  V.STORAGE', w / 2, 32);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.9, .22), new THREE.MeshBasicMaterial({ map: vsTex })).translateX(-24.5).translateY(2.1).translateZ(-22.16));
  // blue tape zones along the walls
  tapeZone(scene, 14, -21.8, 1.8, .8, null);
  tapeZone(scene, 20, -21.8, 1.8, .8, null);

  // ---- bathrooms off the hallway (user: "next to the bathroom in this hallway") ----
  const tileTex = TX.ct(256, 256, (g, w, h) => {
    g.fillStyle = '#cdd2d4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#aeb4b8'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
    }
  }, { repeat: [3, 2] });
  const bfloor = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 4.4), new THREE.MeshStandardMaterial({ map: tileTex, roughness: .5 }));
  bfloor.rotation.x = -Math.PI / 2; bfloor.position.set(-6.5, .004, -24.5);
  scene.add(bfloor);
  scene.add(blocker(box(11.8, 3.2, .25, M.white, -6.5, 1.6, -26.7)));
  scene.add(blocker(box(.25, 3.2, 4.4, M.white, -12.3, 1.6, -24.5)));
  scene.add(blocker(box(.25, 3.2, 4.4, M.white, -.7, 1.6, -24.5)));
  scene.add(blocker(box(.25, 3.2, 4.4, M.white, -6.5, 1.6, -24.5)));
  scene.add(box(12, .15, 4.8, M.white, -6.5, 3.2, -24.5));
  collide(-6.5, -26.8, 11.9, .5); collide(-12.3, -24.5, .5, 4.5); collide(-.7, -24.5, .5, 4.5); collide(-6.5, -24.5, .5, 4.5);
  for (const [cx, sign] of [[-9.4, '🚹 MEN'], [-3.6, '🚺 WOMEN']]) {
    scene.add(box(1.7, .08, .55, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: .4 }), cx, .85, -26.3));
    scene.add(box(1.7, .75, .08, new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: .08, metalness: .5 }), cx, 1.75, -26.55));
    for (const sx of [-.45, .45]) scene.add(cyl(.16, .12, .18, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: .3 }), cx + sx, .93, -26.25, 12));
    collide(cx, -26.3, 1.8, .7);
    for (const sx of [-1.5, -.3]) {
      scene.add(box(1.1, 1.9, .06, new THREE.MeshStandardMaterial({ color: 0x6b7a8c, roughness: .7 }), cx + sx + .55, 1.15, -23.4));
      scene.add(box(.06, 1.9, 1.4, new THREE.MeshStandardMaterial({ color: 0x6b7a8c, roughness: .7 }), cx + sx, 1.15, -24.1));
    }
    collide(cx - .3, -24, 2.3, 1.3);
    const st = TX.ct(160, 64, (g, w, h) => {
      g.fillStyle = '#232f3e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '600 24px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.fillText(sign, w / 2, 42);
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.7, .28), new THREE.MeshBasicMaterial({ map: st })).translateX(cx + 1.35).translateY(2.5).translateZ(-22.4));
  }

  // broom leaning by the storage door — free to grab
  const broomG = new THREE.Group();
  const bp = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 1.15, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: .7 }));
  bp.position.y = .6; bp.rotation.z = .18;
  broomG.add(bp);
  const bh = new THREE.Mesh(new THREE.BoxGeometry(.24, .1, .05), new THREE.MeshStandardMaterial({ color: 0xd7b356, roughness: .9 }));
  bh.position.set(.1, .06, 0);
  broomG.add(bh);
  broomG.position.set(-24.2, 0, -22);
  scene.add(broomG);
  inter({ id: 'pk-broom', type: 'pickup', x: -24.2, z: -21.6, r: 1.3, label: 'Pick up broom 🧹', data: { item: 'broom' } });

  // ---- building fabric over/behind the hallway strip (the FC continues west):
  // roof slab, upper wall bands to meet it, and a facade parapet so sightlines
  // from the cafeteria hit building — not open sky (Bug27/28) ----
  scene.add(blocker(box(68, .2, 5.6, M.ceiling, 4, 6.3, -19.8)));      // roof over strip
  scene.add(box(60, 2.9, .25, M.white, 0, 4.85, -22.3));               // outer wall → roof
  scene.add(box(.25, 2.9, 5.4, M.white, 30, 4.85, -19.8));             // end walls → roof
  scene.add(box(.25, 2.9, 5.4, M.white, -30, 4.85, -19.8));
  scene.add(box(76, 3.2, .25, M.white, 0, 7.9, -22.6));                // facade parapet band

  // ---- lightwell courtyard behind the lounge-corner glass (was an unroofed
  // void): concrete pad, planters, a tree and a rooftop-style mech unit ----
  const cyPad = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.1), new THREE.MeshStandardMaterial({ color: 0xa9adaf, roughness: .95 }));
  cyPad.rotation.x = -Math.PI / 2; cyPad.position.set(-34, .004, -19.7);
  scene.add(cyPad);
  scene.add(blocker(box(8, 6.2, .3, M.wall, -34, 3.1, -22.45)));       // courtyard west wall
  scene.add(blocker(box(.3, 6.2, 5.6, M.wall, -38, 3.1, -19.8)));      // courtyard south wall
  collide(-34, -22.45, 8, .6); collide(-38, -19.8, .6, 5.6);
  const plM = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: .85 });
  const bushM = new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: .9 });
  for (const [px, pz] of [[-36.6, -18.4], [-31.4, -21.2]]) {
    scene.add(box(.9, .5, .9, plM, px, .25, pz));
    const b = new THREE.Mesh(new THREE.SphereGeometry(.5, 9, 7), bushM);
    b.position.set(px, .85, pz); b.scale.y = .85;
    scene.add(b);
  }
  scene.add(cyl(.08, .11, 1.7, M.woodDark, -33.6, .85, -20.6, 8));
  const cyFol = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), bushM);
  cyFol.position.set(-33.6, 2.5, -20.6); cyFol.scale.y = 1.3;
  scene.add(cyFol);
  scene.add(box(1.6, 1.1, .9, new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: .5, metalness: .4 }), -36.4, .55, -21.4));

  smokeCagePatio(scene);
}

// ============================================================ SMOKE CAGE PATIO
// From many break-room trips: attached covered patio with
// black chain-link + privacy mesh, black picnic tables, ash receptacles, signs.
function smokeCagePatio(scene) {
  const X0 = -30, X1 = -18, Z0 = -29.2, Z1 = -22.6; // footprint north of the hallway
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ color: 0xb5b8ba, roughness: .9 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(cx, .002, cz);
  scene.add(pad);
  // white corrugated roof + posts
  scene.add(box(X1 - X0 + .6, .12, Z1 - Z0 + .6, new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: .8 }), cx, 3.1, cz));
  for (const [px, pz] of [[X0 + .4, Z0 + .4], [X1 - .4, Z0 + .4], [X0 + .4, Z1 - .4], [X1 - .4, Z1 - .4], [cx, Z0 + .4]]) {
    scene.add(cyl(.09, .09, 3.1, new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: .6 }), px, 1.55, pz, 8));
    collide(px, pz, .25, .25);
  }
  // dark chain-link + privacy mesh walls (west, north, east; door on south from hallway)
  const meshTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = 'rgba(20,22,26,.55)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,95,100,.8)'; g.lineWidth = 1.5;
    for (let i = -8; i < 16; i++) {
      g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 64, h); g.stroke();
      g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 - 64, h); g.stroke();
    }
  }, { repeat: [4, 1] });
  const meshM = new THREE.MeshStandardMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, roughness: .7, metalness: .3 });
  const fence = (w, x, z, ry) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.9), meshM);
    f.rotation.y = ry; f.position.set(x, 1.45, z);
    scene.add(f);
  };
  fence(X1 - X0, cx, Z0, 0);
  fence(Z1 - Z0, X0, cz, Math.PI / 2);
  fence(Z1 - Z0, X1, cz, Math.PI / 2);
  collide(cx, Z0, X1 - X0, .2); collide(X0, cz, .2, Z1 - Z0); collide(X1, cz, .2, Z1 - Z0);
  // emergency exit gate sign on the east fence
  const emTex = TX.ct(128, 96, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c22127'; g.font = '700 17px Arial'; g.textAlign = 'center';
    g.fillText('EMERGENCY', w / 2, 40); g.fillText('EXIT ONLY', w / 2, 62);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.55, .4), new THREE.MeshBasicMaterial({ map: emTex, side: THREE.DoubleSide })).translateX(X1 - .01).translateY(1.7).translateZ(cz).rotateY(Math.PI / 2));
  // smoking-rules signs on the fences (from trips)
  const ruleTex = TX.ct(160, 200, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#232f3e'; g.font = '600 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('PLEASE dispose of', w / 2, 50); g.fillText('cigarette butts in the', w / 2, 72);
    g.fillText('provided receptacles.', w / 2, 94); g.fillText('Thank you.', w / 2, 116);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.7, .85), new THREE.MeshBasicMaterial({ map: ruleTex, side: THREE.DoubleSide })).translateX(X0 + .02).translateY(1.7).translateZ(cz - 1.4).rotateY(Math.PI / 2));
  // door from the hallway (E010) — gap in hallway north wall at x -27.9..-26.6 exists? use gap: cut segment
  const doorTex = TX.ct(96, 48, (g, w, h) => {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '600 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('E010', w / 2, 33);
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(.5, .25), new THREE.MeshBasicMaterial({ map: doorTex })).translateX(-27.2).translateY(2.5).translateZ(-22.38));
  // black expanded-metal picnic tables (from trips): table + two attached benches
  const metalM = new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: .55, metalness: .35 });
  const picnic = (x, z, ry) => {
    const g = new THREE.Group();
    g.add(box(1.8, .05, .75, metalM, 0, .76, 0));
    g.add(box(1.8, .05, .3, metalM, 0, .47, .62));
    g.add(box(1.8, .05, .3, metalM, 0, .47, -.62));
    for (const s of [-.7, .7]) {
      g.add(box(.06, .74, .1, metalM, s, .38, .3));
      g.add(box(.06, .74, .1, metalM, s, .38, -.3));
      g.add(box(.06, .05, 1.5, metalM, s, .44, 0));
    }
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    collide(x, z, 2.0, 1.7);
    for (const s of [-1, 1]) {
      const sz = z + Math.cos(ry) * s * .62, sx2 = x + Math.sin(ry) * s * .62;
      W.seats.push({ id: `smoke-${x.toFixed(0)}-${s}`, x: sx2, z: sz, y: .5, ry: ry + (s > 0 ? Math.PI : 0), type: 'chair', exitX: x, exitZ: z + s * 1.4 });
    }
  };
  picnic(-27.5, -24.2, 0);
  picnic(-27.5, -27.3, 0);
  picnic(-23.5, -24.2, .1);
  picnic(-23.5, -27.6, 0);
  picnic(-20, -25.8, Math.PI / 2);
  // bullet ash receptacles + trash
  for (const [ax, az] of [[-21.3, -23.3], [-25.4, -28.5]]) {
    scene.add(cyl(.09, .14, .9, new THREE.MeshStandardMaterial({ color: 0xcac2b2, roughness: .6 }), ax, .45, az, 10));
    scene.add(cyl(.03, .09, .18, new THREE.MeshStandardMaterial({ color: 0xb5ad9d, roughness: .6 }), ax, .99, az, 10));
    collide(ax, az, .3, .3);
  }
  trash(scene, -29, -23.4, 0x17181c);
  inter({ id: 'smoke', type: 'smoke', x: cx, z: cz, r: 3.2, label: 'Take a smoke break' });
}

// ============================================================ EAST EXTERIOR
// The building front — huge white facade with
// blue roofline stripe, wood-band tower with the Amazon smile, blue "main entry"
// canopy, bollards, landscaped central walkway (spawn), Amazon Tours signs,
// food truck, flag pole, hydrant. Player spawns on the walkway and badges in.
function exteriorEast(scene) {
  // ground: plaza concrete + asphalt lot
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(7, 44), new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: .9 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(95.5, -.005, 0);
  scene.add(plaza);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(28, 76), new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: .95 }));
  lot.rotation.x = -Math.PI / 2; lot.position.set(112, -.02, 0);
  scene.add(lot);
  // central landscaped walkway (from trips) — the spawn path
  const walkway = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), new THREE.MeshStandardMaterial({ color: 0xc3c6c8, roughness: .85 }));
  walkway.rotation.x = -Math.PI / 2; walkway.position.set(109, -.004, 0);
  scene.add(walkway);
  const mulchM = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  for (const s of [-1, 1]) {
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), mulchM);
    bed.rotation.x = -Math.PI / 2; bed.position.set(109, -.003, s * 3.4);
    scene.add(bed);
    // grasses + shrubs + small trees in the beds
    for (let i = 0; i < 7; i++) {
      const bx2 = 99.5 + i * 3.1, bz = s * (2.6 + (i % 3) * .55);
      if (i % 3 === 0) {
        const t = new THREE.Group();
        t.add(cyl(.05, .07, 1.7, M.woodDark, 0, .85, 0, 6));
        const fol = new THREE.Mesh(new THREE.SphereGeometry(.75, 9, 7), new THREE.MeshStandardMaterial({ color: 0x5b8a42, roughness: .9 }));
        fol.position.y = 2.1; fol.scale.y = 1.35;
        t.add(fol);
        t.position.set(bx2, 0, bz);
        scene.add(t);
      } else if (i % 3 === 1) {
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(.42, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3f6f35, roughness: .95 })).translateX(bx2).translateY(.3).translateZ(bz));
      } else {
        for (let gj = 0; gj < 3; gj++) {
          const grass = new THREE.Mesh(new THREE.ConeGeometry(.3, .9, 5), new THREE.MeshStandardMaterial({ color: 0x6d8a4e, roughness: .95 }));
          grass.position.set(bx2 + gj * .3 - .3, .45, bz + (gj % 2) * .3);
          scene.add(grass);
        }
      }
    }
    collide(109, s * 3.4, 22, 3.0); // stay on the path like a good visitor
  }
  // trash barrel mid-path + Amazon Tours A-frames
  scene.add(cyl(.35, .3, .85, new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: .8 }), 104.5, .43, 1.1, 12));
  collide(104.5, 1.1, .7, .7);
  const toursTex = TX.ct(160, 192, (g, w, h) => {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '700 26px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Amazon', w / 2, 90); g.fillText('Tours', w / 2, 122);
  });
  for (const [ax, az, ry] of [[99, 2.2, .3], [113.5, -2.2, -.2]]) {
    const a = new THREE.Group();
    for (const s2 of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(.85, 1.0), new THREE.MeshStandardMaterial({ map: toursTex, side: THREE.DoubleSide }));
      p.rotation.x = -s2 * .22; // tops lean together into the A
      p.position.z = s2 * .12;
      p.position.y = .5;
      a.add(p);
    }
    a.position.set(ax, 0, az); a.rotation.y = ry;
    scene.add(a);
    collide(ax, az, .9, .6);
  }
  // bollards along the storefront curb + crosswalk + tactile pad
  for (let bz = -13.2; bz <= 13.3; bz += 2.4) {
    if (Math.abs(bz) < 1) continue; // keep the door path clear
    scene.add(cyl(.09, .09, .95, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: .6 }), 96.6, .48, bz, 10));
    collide(96.6, bz, .25, .25);
  }
  const cw = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .8 });
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .35), cw);
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(97.6, .003, -1.2 + i * .6);
    scene.add(stripe);
  }
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.6), new THREE.MeshStandardMaterial({ color: 0xd6a516, roughness: .9 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(96.9, .004, 0);
  scene.add(pad);
  // parking stripes + cars flanking the walkway
  const stripeM = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .8 });
  const stripeG = new THREE.PlaneGeometry(5, .18);
  const stripes = new THREE.InstancedMesh(stripeG, stripeM, 28);
  const d = new THREE.Object3D();
  let si = 0;
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
    d.position.set(103.5, .002, s * (7.5 + i * 3.1));
    d.rotation.x = -Math.PI / 2;
    d.updateMatrix(); stripes.setMatrixAt(si++, d.matrix);
    d.position.set(112.5, .002, s * (7.5 + i * 3.1));
    d.updateMatrix(); stripes.setMatrixAt(si++, d.matrix);
  }
  stripes.count = si;
  scene.add(stripes);
  const carCols = [0x8a8f96, 0x2e3f55, 0x7a2c2c, 0xd8d8d8, 0x1a1c1e, 0x4a6b52];
  W.cars = [];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    const cM = new THREE.MeshStandardMaterial({ color: carCols[i % carCols.length], roughness: .35, metalness: .5 });
    g.add(box(1.8, .55, 4.1, cM, 0, .55, 0));
    g.add(box(1.6, .5, 2.2, new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: .2, metalness: .3 }), 0, 1.05, -.2));
    // headlights + taillights so driving at speed reads well
    for (const s2 of [-1, 1]) {
      g.add(box(.3, .12, .06, new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xfff2cf, emissiveIntensity: .5 }), s2 * .55, .62, 2.05));
      g.add(box(.3, .1, .06, new THREE.MeshStandardMaterial({ color: 0xd93025, emissive: 0x8a1610, emissiveIntensity: .5 }), s2 * .55, .62, -2.05));
    }
    for (const [wx, wz] of [[-.85, 1.3], [.85, 1.3], [-.85, -1.3], [.85, -1.3]]) {
      const wh = cyl(.32, .32, .22, M.blackMetal, wx, .32, wz); wh.rotation.z = Math.PI / 2; g.add(wh);
    }
    const s = i % 2 ? 1 : -1;
    g.position.set(101.4 + (i % 3) * 5.6, 0, s * (9 + Math.floor(i / 2) * 3.1));
    g.rotation.y = Math.PI / 2;
    scene.add(g);
    const col = { x0: g.position.x - 2.1, x1: g.position.x + 2.1, z0: g.position.z - 1, z1: g.position.z + 1, off: false };
    W.colliders.push(col);
    const id = 'car' + i;
    const it = { id, type: 'car', x: g.position.x, z: g.position.z, r: 3.4, label: 'Drive the car 🚗', data: { car: id } };
    inter(it);
    W.cars.push({ id, group: g, col, inter: it, driver: null, x: g.position.x, z: g.position.z, ry: Math.PI / 2 });
  }
  // flag pole + hydrant + food truck (from trips)
  const pole = cyl(.05, .07, 9, M.chrome, 94.5, 4.5, -10, 8);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .95), new THREE.MeshStandardMaterial({ map: TX.flagTexture('usa'), side: THREE.DoubleSide }));
  flag.position.set(95.3, 8.2, -10);
  scene.add(flag);
  collide(94.5, -10, .3, .3);
  const hyd = new THREE.Group();
  hyd.add(cyl(.14, .16, .6, new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: .5 }), 0, .3, 0, 10));
  hyd.add(new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: .5 })).translateY(.62));
  hyd.position.set(99.5, 0, 5.6);
  scene.add(hyd);
  collide(99.5, 5.6, .4, .4);
  const truck = new THREE.Group();
  truck.add(box(2.3, 2.6, 6.2, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: .5 }), 0, 1.5, 0));
  truck.add(box(2.1, 1.1, 1.6, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: .4 }), 0, .85, 3.7)); // cab
  const grillTex = TX.ct(512, 192, (g, w, h) => {
    g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c22127'; g.font = '900 54px Arial'; g.textAlign = 'center';
    g.fillText('GRILL BROS', w / 2, 70);
    g.fillStyle = '#232f3e'; g.font = '700 30px Arial';
    g.fillText('WE BRING THE SIZZLE!', w / 2, 130);
  });
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.7), new THREE.MeshStandardMaterial({ map: grillTex }));
  gp.rotation.y = -Math.PI / 2; gp.position.set(-1.16, 1.6, .4);
  truck.add(gp);
  truck.add(box(.05, .9, 2.6, new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .4 }), -1.17, 2.0, .3)); // serving window? awning below
  const awning = box(1.3, .06, 3.4, new THREE.MeshStandardMaterial({ color: 0xc22127, roughness: .7 }), -1.7, 2.75, .3);
  awning.rotation.z = .35;
  truck.add(awning);
  for (const [wx, wz] of [[-1.05, 2.4], [1.05, 2.4], [-1.05, -2.2], [1.05, -2.2]]) {
    const wh = cyl(.4, .4, .3, M.blackMetal, wx, .4, wz);
    wh.rotation.z = Math.PI / 2;
    truck.add(wh);
  }
  truck.position.set(98.8, 0, 13);
  scene.add(truck);
  collide(98.8, 13, 2.6, 6.4);

  // ---- building facade above/around the storefront (FrontEnterance / webp refs) ----
  const facadeM = new THREE.MeshStandardMaterial({ color: 0xe6e8e9, roughness: .9 });
  const greigeM = new THREE.MeshStandardMaterial({ color: 0xb3aca0, roughness: .9 });
  const grayM = new THREE.MeshStandardMaterial({ color: 0xb6bcc1, roughness: .9 });
  // greige feature band above the storefront carries the smile
  scene.add(box(.5, 7.2, 34.4, greigeM, 92.35, 9.8, 0));
  // textured pilaster strips flanking the smile (vertical scratter panels)
  for (const pz of [-8.5, 8.5]) scene.add(box(.56, 7, 1.6, new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: .95 }), 92.3, 9.7, pz));
  // side wings — the building continues far north/south
  for (const s of [-1, 1]) {
    scene.add(box(.5, 13.4, 24, facadeM, 92.35, 6.7, s * 29));
    collide(92.35, s * 29, .8, 24);
    // gray panel accents + louvers
    scene.add(box(.56, 5, 6, grayM, 92.32, 3.4, s * 24));
    scene.add(box(.56, 2.6, 4, new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: .9 }), 92.3, 10.6, s * 27));
  }
  // blue roofline stripe across everything
  scene.add(box(.56, .8, 82, new THREE.MeshStandardMaterial({ color: 0x2a7de1, roughness: .7 }), 92.3, 13.1, 0));
  // center tower (gray) with a second blue stripe like the real tower
  scene.add(box(3.5, 5.2, 15, grayM, 93.8, 15.5, 0));
  scene.add(box(3.56, .55, 15.1, new THREE.MeshStandardMaterial({ color: 0x2a7de1, roughness: .7 }), 93.8, 14.6, 0));
  const smileTex2 = TX.ct(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2a7de1'; g.lineWidth = 26; g.lineCap = 'round';
    g.beginPath(); g.moveTo(70, 90); g.quadraticCurveTo(w / 2, 200, w - 90, 110); g.stroke();
    g.beginPath(); g.moveTo(w - 120, 70); g.lineTo(w - 68, 104); g.lineTo(w - 130, 140); g.stroke();
  });
  const smile = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: smileTex2, transparent: true }));
  smile.rotation.y = -Math.PI / 2; smile.position.set(92.0, 10.6, 0);
  scene.add(smile);
  // the sweeping tall blue canopy fascia across the whole entrance, with the
  // dark-navy "main entry" panel at its end (FrontEnterance.jpg)
  const canM = new THREE.MeshStandardMaterial({ color: 0x2a86d8, roughness: .55 });
  scene.add(box(2.9, 1.7, 33, canM, 93.6, 6.05, 0));
  scene.add(box(3.1, .12, 33.4, new THREE.MeshStandardMaterial({ color: 0x1f6ab0, roughness: .6 }), 93.6, 5.18, 0));
  // slight curve suggestion: stepped end caps
  scene.add(box(2.3, 1.45, 1.6, canM, 93.3, 6.0, -16.9));
  scene.add(box(2.3, 1.45, 1.6, canM, 93.3, 6.0, 16.9));
  const meTex = TX.ct(768, 160, (g, w, h) => {
    g.fillStyle = '#16324e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '400 84px "Segoe UI", sans-serif'; g.textAlign = 'left';
    g.fillText('main entry', 40, 108);
  });
  const meSign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.2), new THREE.MeshBasicMaterial({ map: meTex }));
  meSign.rotation.y = -Math.PI / 2; meSign.position.set(95.06, 6.05, 12.5);
  scene.add(meSign);
  // street lamps
  for (const [lx, lz] of [[100, -6.2], [113, 6.2]]) {
    scene.add(cyl(.06, .09, 5.5, M.blackMetal, lx, 2.75, lz, 8));
    scene.add(box(.9, .12, .3, new THREE.MeshStandardMaterial({ color: 0x17181c, emissive: 0xfff2cf, emissiveIntensity: .4 }), lx + .35, 5.4, lz));
    collide(lx, lz, .3, .3);
  }
}

// teal walking-path tape + red STOP floor decals (from trips)
// ground + parking apron along the relocated cafeteria's east glass (site plan:
// the lot wraps the whole front) and base plane under the south wing
function exteriorSouth(scene) {
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(32, 84), new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: .95 }));
  lot.rotation.x = -Math.PI / 2; lot.position.set(112, -.025, 70);
  scene.add(lot);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(4, 82), new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: .9 }));
  walk.rotation.x = -Math.PI / 2; walk.position.set(94, -.006, 70);
  scene.add(walk);
  const stripeM = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .8 });
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(.18, 5), stripeM);
    p.rotation.x = -Math.PI / 2; p.position.set(103, .002, 34 + i * 5.2);
    scene.add(p);
  }
  const base = new THREE.Mesh(new THREE.PlaneGeometry(64, 98), new THREE.MeshStandardMaterial({ color: 0x8e9294, roughness: .95 }));
  base.rotation.x = -Math.PI / 2; base.position.set(60, -.04, 66);
  scene.add(base);
  for (const [tx, tz] of [[97.5, 42], [97.5, 72], [97.5, 100]]) {
    const t = new THREE.Group();
    t.add(cyl(.09, .12, 1.6, M.woodDark, 0, .8, 0, 8));
    const fol = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: .9 }));
    fol.position.y = 2.2; fol.scale.y = 1.25;
    t.add(fol);
    t.position.set(tx, 0, tz);
    scene.add(t);
  }
}

function floorPaths(scene) {
  const teal = new THREE.MeshBasicMaterial({ color: 0x17a08b, transparent: true, opacity: .88, depthWrite: false });
  const seg = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(.14, len), teal);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.atan2(x2 - x1, z2 - z1);
    p.position.set((x1 + x2) / 2, .011, (z1 + z2) / 2);
    p.renderOrder = 1;
    scene.add(p);
  };
  // main route: front doors → badge gates → past the island desk → south through
  // a detector lane → locker hallway → cafeteria double doors (site plan)
  seg(79, -5.2, 75.5, -3.6);
  seg(75.5, -3.6, 73.5, .5);
  seg(73.5, .5, 69.4, 7);
  seg(69.4, 7, 69.4, 19);
  seg(69.4, 19, 75.9, 28);
  seg(75.9, 28, 75.9, 36);
  seg(75.9, 36, 76.1, 103);
  const stopTex = TX.ct(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#c22127'; g.beginPath(); g.arc(w / 2, h / 2, w * .46, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(w / 2, h / 2, w * .40, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.font = '900 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', w / 2, h / 2);
  });
  const stopM = new THREE.MeshBasicMaterial({ map: stopTex, transparent: true, depthWrite: false });
  // oriented so the text reads upright for the main (inbound, southbound) flow
  for (const [x, z, hx, hz] of [[77.1, 102, 0, 1], [77.1, 32.5, 0, 1], [69.4, 15.4, 0, 1], [74.1, 2.6, -.53, .85]])
    W.anchors.floorDecal(scene, stopM, x, z, hx, hz, .85);
}

function pickups(scene) {
  inter({ id: 'pk-tapegun', type: 'pickup', x: 65.2, z: 21, r: 1.3, label: 'Take the tape gun 📼', data: { item: 'tapegun' } });
  inter({ id: 'pk-tube', type: 'pickup', x: 90, z: 25.8, r: 1.3, label: 'Grab a cardboard tube 📦', data: { item: 'tube' } });
  inter({ id: 'pk-wrench', type: 'pickup', x: 59.8, z: 86.2, r: 1.3, label: 'Borrow the wrench 🔧', data: { item: 'wrench' } });
  inter({ id: 'pk-banana', type: 'pickup', x: 81.4, z: 32.4, r: 1.3, label: 'Take a banana 🍌', data: { item: 'banana' } });
  inter({ id: 'pk-hardhat', type: 'pickup', x: 63.3, z: 11.8, r: 1.4, label: 'Take a hard hat ⛑️', data: { item: 'hat-hardhat' } });
  inter({ id: 'pk-paddle', type: 'pickup', x: 64.5, z: 94, r: 1.3, label: 'Take a spare paddle 🏓', data: { item: 'paddle' } });
}

// ============================================================ STREETS & HOME
// Overhead layout: 172nd St NE runs past the front parking lot, 51st Ave NE
// crosses it, and Longhouse Trail Ln is the little residential lane — so you
// can badge out, get in a car, and actually drive home.
function streets(scene) {
  const asph = new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: .95 });
  const mk = (w, d, x, z, y = -.028) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), asph);
    p.rotation.x = -Math.PI / 2; p.position.set(x, y, z);
    scene.add(p); return p;
  };
  // grass base under the whole expansion
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(232, 252), new THREE.MeshStandardMaterial({ color: 0x74855f, roughness: .95 }));
  grass.rotation.x = -Math.PI / 2; grass.position.set(36, -.045, 64);
  scene.add(grass);
  mk(12, 244, 138, 64);           // 172nd St NE (game: north-south at x 138)
  mk(190, 12, 43, 138, -.026);    // 51st Ave NE (game: east-west at z 138)
  mk(16, 9, 126, 0);              // lot exit north
  mk(16, 9, 126, 70);             // lot exit south
  mk(8, 30, 30, 152, -.024);      // Longhouse Trail Ln
  const cul = new THREE.Mesh(new THREE.CircleGeometry(9, 22), asph);
  cul.rotation.x = -Math.PI / 2; cul.position.set(30, -.024, 170);
  scene.add(cul);
  // lane markings
  const dashM = new THREE.MeshBasicMaterial({ color: 0xe8e6da });
  const dash = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dashM); m.rotation.x = -Math.PI / 2; m.position.set(x, -.018, z); scene.add(m); };
  for (let z = -50; z <= 178; z += 7) if (z < 130 || z > 146) dash(.22, 2.6, 138, z);
  for (let x = -44; x <= 128; x += 7) dash(2.6, .22, x, 138);
  const edgeM = new THREE.MeshBasicMaterial({ color: 0xd8d8d2 });
  for (const ex of [132.6, 143.4]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(.16, 244), edgeM); m.rotation.x = -Math.PI / 2; m.position.set(ex, -.018, 64); scene.add(m); }
  // street signs at the corner + a stop sign at the lot exit
  const bladeTex = (t) => TX.ct(256, 48, (g, w, h) => {
    g.fillStyle = '#0f6b38'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#fff'; g.font = '700 26px Arial'; g.textAlign = 'center'; g.fillText(t, w / 2, 33);
  });
  const signPost = (x, z) => { scene.add(cyl(.04, .05, 3, M.chrome, x, 1.5, z, 8)); };
  signPost(131.4, 131.2);
  for (const [t, y, ry] of [['172nd St NE', 2.8, 0], ['51st Ave NE', 2.45, Math.PI / 2]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .32), new THREE.MeshBasicMaterial({ map: bladeTex(t), side: THREE.DoubleSide }));
    b.position.set(131.4, y, 131.2); b.rotation.y = ry;
    scene.add(b);
  }
  const stopTex = TX.ct(128, 128, (g, w, h) => {
    g.fillStyle = '#c22127'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; const px = w / 2 + Math.cos(a) * 58, py = h / 2 + Math.sin(a) * 58; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = '900 40px Arial'; g.textAlign = 'center'; g.fillText('STOP', w / 2, h / 2 + 14);
  });
  for (const [sx, sz] of [[130.5, 5.5], [130.5, 75.5]]) {
    scene.add(cyl(.04, .05, 2.6, M.chrome, sx, 1.3, sz, 8));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(.7, .7), new THREE.MeshBasicMaterial({ map: stopTex, transparent: true, side: THREE.DoubleSide }));
    s.position.set(sx, 2.3, sz); s.rotation.y = Math.PI / 2;
    scene.add(s);
  }
  // street lights along 172nd
  const lampM = new THREE.MeshStandardMaterial({ color: 0xfff3c9, emissive: 0xfff3c9, emissiveIntensity: .9 });
  for (const lz of [-30, 10, 50, 90, 126]) {
    scene.add(cyl(.07, .09, 6.4, M.blackMetal, 132.2, 3.2, lz, 8));
    scene.add(box(1.6, .08, .12, M.blackMetal, 133, 6.35, lz));
    scene.add(box(.5, .1, .22, lampM, 133.7, 6.28, lz));
    collide(132.2, lz, .3, .3);
  }
  // ---- Longhouse Trail houses ----
  const house = (hx, hz, ry, cBody, cRoof, isHome) => {
    const h = new THREE.Group();
    h.add(box(5, 2.7, 4.2, new THREE.MeshStandardMaterial({ color: cBody, roughness: .85 }), 0, 1.35, 0));
    const roofM = new THREE.MeshStandardMaterial({ color: cRoof, roughness: .9 });
    const r1 = box(5.6, .14, 2.65, roofM, 0, 3.28, -1.05); r1.rotation.x = -.42;
    const r2 = box(5.6, .14, 2.65, roofM, 0, 3.28, 1.05); r2.rotation.x = .42;
    h.add(r1, r2);
    const gable = new THREE.BufferGeometry(); // fill the triangular ends under the ridge
    gable.setAttribute('position', new THREE.Float32BufferAttribute([
      -2.5, 2.7, -2.1, -2.5, 2.7, 2.1, -2.5, 3.8, 0,
      2.5, 2.7, 2.1, 2.5, 2.7, -2.1, 2.5, 3.8, 0,
    ], 3));
    gable.computeVertexNormals();
    h.add(new THREE.Mesh(gable, new THREE.MeshStandardMaterial({ color: cBody, roughness: .85, side: THREE.DoubleSide })));
    h.add(box(.9, 1.9, .08, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: .8 }), -1.1, .95, 2.12)); // door
    for (const wx of [.7, 1.7]) h.add(box(.9, .8, .06, new THREE.MeshStandardMaterial({ color: 0xbfd6e4, roughness: .25, metalness: .3 }), wx, 1.5, 2.12));
    if (isHome) {
      h.add(box(.22, .14, .14, new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb52e, emissiveIntensity: .9 }), -1.75, 2.15, 2.14)); // porch light
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(1, .6), new THREE.MeshBasicMaterial({ map: TX.ct(96, 64, (g, w, hh) => { g.fillStyle = '#7a4b2a'; g.fillRect(0, 0, w, hh); g.fillStyle = '#fff'; g.font = '700 15px "Segoe UI"'; g.textAlign = 'center'; g.fillText('WELCOME', w / 2, 38); }) }));
      mat.rotation.x = -Math.PI / 2; mat.position.set(-1.1, .02, 2.75); h.add(mat);
    }
    h.position.set(hx, 0, hz); h.rotation.y = ry;
    scene.add(h);
    collide(hx, hz, 5.4, 4.6);
  };
  const bodies = [0xcfc6b4, 0x9fb2c0, 0xb8a390, 0x8f9d8a, 0xc9b9a1];
  for (let i = 0; i < 3; i++) {
    house(21.5, 148 + i * 9, Math.PI / 2, bodies[i], 0x4d4a45, false);
    house(38.5, 150 + i * 9, -Math.PI / 2, bodies[i + 2 > 4 ? 0 : i + 2], 0x5a544c, false);
    mk(3.5, 2.6, 25.4, 148 + i * 9, -.022); mk(3.5, 2.6, 34.6, 150 + i * 9, -.022);
  }
  // your house, at the end of the cul-de-sac
  house(30, 176.5, Math.PI, 0xdccfae, 0x6b3f34, true);
  mk(3, 4.2, 30, 172.6, -.022);
  const mbPost = cyl(.04, .04, 1.1, M.woodDark, 27.4, .55, 172.2, 6);
  scene.add(mbPost);
  scene.add(box(.5, .3, .32, new THREE.MeshStandardMaterial({ color: 0x2e4d8a, roughness: .5 }), 27.4, 1.2, 172.2));
  inter({ id: 'home', type: 'home', x: 30, z: 174.2, r: 2.4, label: 'You made it — go relax 🏠' });
  // a few yard trees
  for (const [tx, tz] of [[14, 146], [46, 158], [14, 168], [44, 174], [120, 150]]) {
    scene.add(cyl(.09, .12, 1.7, M.woodDark, tx, .85, tz, 8));
    const fol = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: .9 }));
    fol.position.set(tx, 2.6, tz); fol.scale.y = 1.25;
    scene.add(fol);
    collide(tx, tz, .4, .4);
  }

  // ---- the secret: a rusty container behind the smoke cage, something golden inside ----
  const rustM = new THREE.MeshStandardMaterial({ color: 0x8a4a2e, roughness: .8, metalness: .3 });
  scene.add(blocker(box(.16, 2.7, 8, rustM, 39.2, 1.35, 96)));   // west wall
  scene.add(blocker(box(.16, 2.7, 8, rustM, 43.2, 1.35, 96)));   // east wall
  scene.add(blocker(box(4.2, 2.7, .16, rustM, 41.2, 1.35, 92)));  // closed north end
  scene.add(blocker(box(4.2, .14, 8.2, rustM, 41.2, 2.75, 96)));  // roof
  collide(39.2, 96, .3, 8); collide(43.2, 96, .3, 8); collide(41.2, 92, 4.2, .3);
  // the Lamborghini
  const lam = new THREE.Group();
  const lamB = new THREE.MeshStandardMaterial({ color: 0xf7c500, roughness: .2, metalness: .75 });
  const lamG = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: .15, metalness: .4 });
  lam.add(box(1.9, .36, 4.35, lamB, 0, .4, 0));                   // low floorpan
  const nose = box(1.78, .22, 1.5, lamB, 0, .56, 1.5); nose.rotation.x = .09; lam.add(nose);
  const shield = box(1.6, .1, 1.05, lamG, 0, .82, .62); shield.rotation.x = .42; lam.add(shield);
  lam.add(box(1.66, .3, 1.15, lamG, 0, .78, -.25));               // cabin
  const engineDeck = box(1.8, .2, 1.35, lamB, 0, .68, -1.45); engineDeck.rotation.x = -.06; lam.add(engineDeck);
  lam.add(box(1.94, .07, .42, lamG, 0, 1.02, -2.0));              // spoiler
  for (const s of [-1, 1]) {
    lam.add(box(.09, .3, .09, lamG, s * .75, .85, -2.0));
    lam.add(box(.34, .07, .1, new THREE.MeshStandardMaterial({ color: 0xfff8d8, emissive: 0xfff8d8, emissiveIntensity: .6 }), s * .62, .52, 2.2));
    lam.add(box(.4, .1, .08, new THREE.MeshStandardMaterial({ color: 0xd93025, emissive: 0xa01812, emissiveIntensity: .7 }), s * .55, .62, -2.16));
    lam.add(box(.5, .04, .5, lamG, s * .6, .59, -1.4));           // engine vents
  }
  for (const [wx, wz] of [[-.88, 1.4], [.88, 1.4], [-.88, -1.35], [.88, -1.35]]) {
    const wh = cyl(.34, .34, .3, M.blackMetal, wx, .34, wz); wh.rotation.z = Math.PI / 2; lam.add(wh);
  }
  lam.position.set(41.2, 0, 97.2); // ry 0 = nose toward the open (south) end
  scene.add(lam);
  const lamCol = { x0: 41.2 - 1.05, x1: 41.2 + 1.05, z0: 97.2 - 2.15, z1: 97.2 + 2.15, off: false };
  W.colliders.push(lamCol);
  const lamIt = { id: 'lambo', type: 'car', x: 41.2, z: 97.2, r: 3.9, label: 'Wait… is that a LAMBORGHINI?! 🏎️', data: { car: 'lambo' } };
  inter(lamIt);
  W.cars.push({ id: 'lambo', group: lam, col: lamCol, inter: lamIt, driver: null, x: 41.2, z: 97.2, ry: 0, top: 30, acc: 19, hl: 2.2, hw: 1.05 });
  // the only hint, scribbled inside the smoke cage
  const hintTex = TX.ct(192, 96, (g, w, h) => {
    g.fillStyle = '#e8e2d2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3a3a'; g.font = 'italic 600 15px "Segoe UI"'; g.textAlign = 'center';
    g.fillText('night shift only:', w / 2, 34);
    g.fillText('the good car is', w / 2, 54);
    g.fillText('behind the cage 🔑', w / 2, 74);
  });
  const hint = new THREE.Mesh(new THREE.PlaneGeometry(.8, .4), new THREE.MeshBasicMaterial({ map: hintTex, side: THREE.DoubleSide }));
  hint.rotation.y = Math.PI / 2; hint.position.set(45.85, 1.35, 95);
  scene.add(hint);
}

export function buildWorld(scene) {
  mats();
  scene.background = new THREE.Color(0xbcd2e2);
  scene.fog = new THREE.Fog(0xbcd2e2, 90, 260); // far enough to see down the streets
  lights(scene);
  // ---- cafeteria block: built in its legacy local frame, then rotated 90 deg and
  // moved SOUTH of the security block per the site plan — the old east door
  // wall now faces north into the locker hallway, and the old south window run
  // becomes the east building face at x=92 (windows onto the parking lot).
  const caf = new THREE.Group();
  caf.rotation.y = Math.PI / 2;
  caf.position.set(75, 0, 69);
  scene.add(caf);
  const mark = { col: W.colliders.length, seat: W.seats.length, inter: W.interactables.length };
  const preAnchors = new Set(Object.keys(W.anchors));
  shell(caf);
  lounge(caf);
  gamesCorner(caf);
  dining(caf);
  market(caf);
  decor(caf);
  // registries were recorded in the group's local frame: local (x,z) -> world (z+75, -x+69)
  const rot = (x, z) => [z + 75, -x + 69];
  for (let i = mark.col; i < W.colliders.length; i++) {
    const c = W.colliders[i];
    const [nx0, nx1] = [c.z0 + 75, c.z1 + 75];
    const [nz0, nz1] = [-c.x1 + 69, -c.x0 + 69];
    c.x0 = nx0; c.x1 = nx1; c.z0 = nz0; c.z1 = nz1;
  }
  for (let i = mark.seat; i < W.seats.length; i++) {
    const st = W.seats[i];
    [st.x, st.z] = rot(st.x, st.z);
    if (st.exitX !== undefined) [st.exitX, st.exitZ] = rot(st.exitX, st.exitZ);
    st.ry = (st.ry ?? 0) + Math.PI / 2;
  }
  for (let i = mark.inter; i < W.interactables.length; i++) {
    const it = W.interactables[i];
    [it.x, it.z] = rot(it.x, it.z);
  }
  // anchors registered inside the group keep local x/z (their meshes are group
  // children) but also get world wx/wz for player-distance checks (pong quit
  // used local coords → distance was always huge → leave-spam broke minigames)
  for (const k of Object.keys(W.anchors)) {
    if (preAnchors.has(k)) continue;
    const a = W.anchors[k];
    if (a && typeof a.x === 'number' && typeof a.z === 'number') [a.wx, a.wz] = rot(a.x, a.z);
  }
  lockerHall(scene);
  securityLobby(scene);
  exterior(scene);
  exteriorEast(scene);
  exteriorSouth(scene);
  streets(scene);
  floorPaths(scene);
  pickups(scene);
  return W;
}

// circle-vs-AABB collision resolve, returns corrected [x,z]
export function resolveCollisions(x, z, r) {
  for (const c of W.colliders) {
    if (c.off) continue;
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-9) { // inside: push toward nearest edge
        const pushes = [
          [c.x0 - r - x, 0], [c.x1 + r - x, 0],
          [0, c.z0 - r - z], [0, c.z1 + r - z],
        ];
        pushes.sort((a, b) => (Math.abs(a[0] + a[1])) - Math.abs(b[0] + b[1]));
        x += pushes[0][0]; z += pushes[0][1];
      } else {
        const d = Math.sqrt(d2);
        x = nx + dx / d * r;
        z = nz + dz / d * r;
      }
    }
  }
  return [x, z];
}
