// Player avatars: warehouse associates — shirt, hi-vis vest w/ reflective stripes,
// simple limb animation, name tag sprite, chat bubbles, held snack items.
import * as THREE from 'three';
import { ct } from './textures.js';

export const VEST_COLORS = {
  yellow: 0xd3e50b, orange: 0xff7b1c, green: 0x28c76f,
  blue: 0x3aa0ff, pink: 0xff5da2, none: null,
};
export const SHIRTS = [0x3b4048, 0x5a3b3b, 0x2f4a3d, 0x39395c, 0x4a4a4a, 0x6b5335, 0x7a2c5e, 0x1f6f6a];
export const SKINS = [0xf0dbc0, 0xead0b4, 0xd2a377, 0xa9764c, 0x8a5a35, 0x5f3d22];
export const HAIRS = [0x14100c, 0x3a2a18, 0x6b4a26, 0x555149, 0x8a8580, 0xb5651d];
export const HATS = ['none', 'cap', 'beanie', 'hardhat'];

function nameSprite(name, guest) {
  const tex = ct(256, 64, (g, w, h) => {
    g.font = '700 30px "Segoe UI", sans-serif';
    const tw = Math.min(240, g.measureText(name).width + 26);
    g.fillStyle = 'rgba(10,14,20,.68)';
    g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, 44, 12); g.fill();
    g.fillStyle = guest ? '#9fb0c3' : '#ffd34d';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, 32);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.5, .38, 1);
  sp.renderOrder = 5;
  return sp;
}

const HELD_ITEMS = {
  chips: { color: 0xf26f21, w: .14, h: .18, d: .05 },
  soda: { color: 0x1c62d1, w: .07, h: .13, d: .07, cyl: true },
  candy: { color: 0xe84f9b, w: .12, h: .06, d: .03 },
  coffee: { color: 0xf5f2ec, w: .07, h: .11, d: .07, cyl: true },
  energy: { color: 0x8aa9d6, w: .06, h: .14, d: .06, cyl: true },
  water: { color: 0xd9ecf5, w: .07, h: .1, d: .07, cyl: true },
  food: { color: 0xcfe0cf, w: .16, h: .06, d: .12 },
};

// per-item grip transforms so props sit in the fist correctly (Bug9)
export const GRIPS = {
  paddle:  { p: [0, .02, .07], r: [-2.1, 0, .18] },     // blade forward-up like a ready grip
  broom:   { p: [0, .28, .04], r: [.35, 0, .12] },      // pole through the fist, head down-forward
  tube:    { p: [0, .12, .05], r: [-.9, 0, 0] },
  wrench:  { p: [0, .05, .02], r: [-1.1, 0, 0] },
  tapegun: { p: [0, .02, .05], r: [-1.3, .3, 0] },
  banana:  { p: [0, .04, .05], r: [-1.9, .3, .6] },
  physgun: { p: [0, .03, .06], r: [-1.45, 0, 0] },
  flashlight: { p: [0, .03, .05], r: [-1.4, 0, 0] },
  axe:       { p: [0, .1, .04], r: [-1.0, 0, .1] },
  stoneaxe:  { p: [0, .1, .04], r: [-1.0, 0, .1] },
  pickaxe:   { p: [0, .1, .04], r: [-1.0, 0, .1] },
  stonepick: { p: [0, .1, .04], r: [-1.0, 0, .1] },
  pistol:    { p: [0, .04, .05], r: [-1.55, 0, 0] },
  wall:      { p: [0, .04, .05], r: [-.6, 0, 0] },
  floor:     { p: [0, .04, .05], r: [-.6, 0, 0] },
  chips:   { p: [0, .04, .05], r: [-.5, 0, 0] },
  food:    { p: [0, .02, .06], r: [-.4, 0, 0] },
  candy:   { p: [0, .03, .05], r: [-.5, 0, 0] },
  soda:    { p: [0, .05, .02], r: [-.25, 0, 0] },       // cans/cups stay near-upright
  coffee:  { p: [0, .05, .02], r: [-.25, 0, 0] },
  energy:  { p: [0, .05, .02], r: [-.25, 0, 0] },
  water:   { p: [0, .05, .02], r: [-.25, 0, 0] },
};

// break-room "weapons" — playful melee props, built as small mesh groups
export function buildHeldMesh(item) {
  const def = HELD_ITEMS[item];
  if (def) {
    return def.cyl
      ? new THREE.Mesh(new THREE.CylinderGeometry(def.w / 2, def.w / 2, def.h, 10), new THREE.MeshStandardMaterial({ color: def.color, roughness: .4 }))
      : new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), new THREE.MeshStandardMaterial({ color: def.color, roughness: .6 }));
  }
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: .7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: .5 });
  if (item === 'paddle') {
    const face = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .02, 14), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: .6 }));
    face.rotation.x = Math.PI / 2; face.position.y = -.16;
    g.add(face);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(.03, .13, .02), wood));
  } else if (item === 'broom') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 1.15, 8), wood);
    pole.position.y = -.35;
    g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.24, .1, .05), new THREE.MeshStandardMaterial({ color: 0xd7b356, roughness: .9 }));
    head.position.y = -.98;
    g.add(head);
  } else if (item === 'tapegun') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .05), dark));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .045, 12), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: .4 }));
    roll.rotation.x = Math.PI / 2; roll.position.set(.04, .08, 0);
    g.add(roll);
  } else if (item === 'tube') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .85, 10), new THREE.MeshStandardMaterial({ color: 0xb8926a, roughness: .85 }));
    t.position.y = -.28;
    g.add(t);
  } else if (item === 'wrench') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(.035, .3, .02), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .3, metalness: .7 })));
    const jaw = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .022, 10), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .3, metalness: .7 }));
    jaw.rotation.x = Math.PI / 2; jaw.position.y = -.17;
    g.add(jaw);
  } else if (item === 'banana') {
    const b = new THREE.Mesh(new THREE.TorusGeometry(.09, .026, 8, 12, Math.PI * .9), new THREE.MeshStandardMaterial({ color: 0xf2d21f, roughness: .6 }));
    b.rotation.z = .6;
    g.add(b);
  } else if (item === 'axe' || item === 'stoneaxe' || item === 'pickaxe' || item === 'stonepick') {
    const stone = item.startsWith('stone');
    const headM = new THREE.MeshStandardMaterial({ color: stone ? 0x757b82 : 0x9aa4ae, roughness: stone ? .85 : .35, metalness: stone ? .1 : .6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.02, .024, .62, 8), wood);
    pole.position.y = -.14;
    g.add(pole);
    if (item.includes('axe')) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.05, .16, .14), headM);
      blade.position.set(0, .14, .08);
      g.add(blade);
    } else { // pick: two tapered spikes
      for (const s of [-1, 1]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(.035, .2, 6), headM);
        spike.rotation.x = s * Math.PI / 2;
        spike.position.set(0, .15, s * .12);
        g.add(spike);
      }
    }
  } else if (item === 'pistol') {
    const gm = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: .35, metalness: .5 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(.05, .06, .22), gm);
    slide.position.set(0, .03, -.05);
    g.add(slide);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.045, .13, .06), new THREE.MeshStandardMaterial({ color: 0x33281c, roughness: .7 }));
    grip.position.set(0, -.05, .05);
    grip.rotation.x = .25;
    g.add(grip);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .07, 8), gm);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, .035, -.18);
    g.add(barrel);
  } else if (item === 'wall' || item === 'floor') {
    for (let i = 0; i < 3; i++) { // bundle of planks
      const pl = new THREE.Mesh(new THREE.BoxGeometry(.05, .02, .34), wood);
      pl.position.set((i - 1) * .05, i * .02, 0);
      g.add(pl);
    }
  } else if (item === 'flashlight') {
    const bodyC = new THREE.Mesh(new THREE.CylinderGeometry(.035, .042, .22, 10), dark);
    bodyC.rotation.x = Math.PI / 2;
    g.add(bodyC);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(.048, .04, .05, 10), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 1.3 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -.13;
    g.add(lens);
  } else if (item === 'physgun') {
    const glowM = new THREE.MeshStandardMaterial({ color: 0x35e0ff, emissive: 0x35e0ff, emissiveIntensity: 1.5, roughness: .3 });
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(.09, .1, .34), dark);
    g.add(bodyM);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.05, .15, .07), dark);
    grip.position.set(0, -.1, .11); grip.rotation.x = .35;
    g.add(grip);
    for (const z of [-.05, -.13]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.06, .013, 6, 14), glowM);
      ring.position.z = z;
      g.add(ring);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.032, 8, 6), glowM);
    tip.position.z = -.2;
    g.add(tip);
  } else return null;
  return g;
}

// per-prop third-person attack styles: arm(wind,smash) → [rotX,rotY,rotZ] deltas,
// torso(wind,smash) → [pitch,twist], head(smash) → yaw delta
const SWING_STYLES = {
  default: { speed: 3.8, arm: (w, s) => [-w * .9 - s * 1.7, -s * .6, -w * .8 + s * .5], torso: (w, s) => [0, w * .25 - s * .55], head: s => s * .3 },
  tube:    { speed: 3.1, arm: (w, s) => [-w * 2.5 - s * 1.9, 0, -w * .15 + s * .1], torso: (w, s) => [-w * .12 + s * .3, w * .1 - s * .2], head: s => s * .12 },
  broom:   { speed: 3.4, arm: (w, s) => [-.95 - s * .2, -w * .7 + s * 1.7, -w * .35], torso: (w, s) => [s * .08, w * .5 - s * .95], head: s => s * .45 },
  tapegun: { speed: 5.4, arm: (w, s) => [-w * 1.15 - s * .5, s * .12, 0], torso: (w, s) => [s * .06, w * .12 - s * .3], head: s => s * .1 },
  banana:  { speed: 4.2, arm: (w, s) => [-w * .7 - s * .8, s * 2.3, -w * .6 + s * .9], torso: (w, s) => [0, w * .2 - s * .65], head: s => s * .4 },
};
SWING_STYLES.wrench = SWING_STYLES.default;
SWING_STYLES.paddle = { ...SWING_STYLES.default, speed: 4.4 };

export function makeAvatar(name, vest = 'yellow', guest = false, ap = null) {
  const g = new THREE.Group();
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  // appearance: explicit customization wins, otherwise derived from the name
  const shirtC = SHIRTS[(ap?.shirt ?? seed) % SHIRTS.length];
  const skinC = SKINS[(ap?.skin ?? (seed * 7)) % SKINS.length];
  const hairC = HAIRS[(ap?.hair ?? seed) % HAIRS.length];
  const hat = ap?.hat != null ? HATS[ap.hat % HATS.length] : (seed % 3 === 0 ? 'cap' : 'none');

  const shirtM = new THREE.MeshStandardMaterial({ color: shirtC, roughness: .8 });
  const skinM = new THREE.MeshStandardMaterial({ color: skinC, roughness: .7 });
  const pantsM = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: .85 });

  const parts = {};
  // pelvis block joins the legs to the torso (they used to float apart)
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(.36, .3, .26), pantsM);
  pelvis.position.y = .86;
  g.add(pelvis);
  // legs
  parts.legL = new THREE.Group(); parts.legR = new THREE.Group();
  for (const [leg, s] of [[parts.legL, -1], [parts.legR, 1]]) {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(.085, .62, 3, 8), pantsM);
    l.position.y = -.42;
    leg.add(l);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(.16, .09, .27), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: .6 }));
    shoe.position.set(0, -.78, .04);
    leg.add(shoe);
    leg.position.set(s * .11, .82, 0);
    g.add(leg);
  }
  // torso
  parts.torso = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(.19, .4, 4, 10), shirtM);
  chest.scale.set(1.15, 1, .8);
  chest.position.y = .32;
  parts.torso.add(chest);
  // vest
  parts.vest = new THREE.Mesh(new THREE.CapsuleGeometry(.215, .34, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd3e50b, roughness: .6 }));
  parts.vest.scale.set(1.15, .92, .82);
  parts.vest.position.y = .34;
  parts.torso.add(parts.vest);
  // reflective stripes
  parts.stripes = [];
  for (const y of [.22, .44]) {
    const st = new THREE.Mesh(new THREE.TorusGeometry(.235, .018, 6, 20), new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: .25, metalness: .6 }));
    st.rotation.x = Math.PI / 2;
    st.scale.set(1.1, .8, 1);
    st.position.y = y;
    parts.stripes.push(st);
    parts.torso.add(st);
  }
  // arms + head are children of the TORSO so leaning/rolling carries them
  // (they used to hang off the root and visually detached while walking)
  parts.torso.position.y = .98;
  parts.armL = new THREE.Group(); parts.armR = new THREE.Group();
  for (const [arm, s] of [[parts.armL, -1], [parts.armR, 1]]) {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .42, 3, 8), shirtM);
    a.position.y = -.24;
    arm.add(a);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 6), skinM);
    hand.position.y = -.5;
    arm.add(hand);
    arm.position.set(s * .3, .52, 0); // shoulder height, local to torso
    parts.torso.add(arm);
  }
  g.add(parts.torso);
  // head
  parts.head = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 10), skinM);
  parts.head.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.163, 12, 8, 0, Math.PI * 2, 0, Math.PI * .55), new THREE.MeshStandardMaterial({ color: hairC, roughness: .9 }));
  hair.position.y = .02;
  parts.head.add(hair);
  if (hat === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.165, 10, 6, 0, Math.PI * 2, 0, Math.PI * .5), new THREE.MeshStandardMaterial({ color: 0x28323c, roughness: .8 }));
    cap.position.y = .03;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .02, 12, 1, false, -.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x28323c, roughness: .8 }));
    brim.position.set(0, .02, .1);
    parts.head.add(cap, brim);
  } else if (hat === 'beanie') {
    const bean = new THREE.Mesh(new THREE.SphereGeometry(.168, 10, 7, 0, Math.PI * 2, 0, Math.PI * .58), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: .9 }));
    bean.position.y = .025;
    parts.head.add(bean);
  } else if (hat === 'hardhat') {
    const hhM = new THREE.MeshStandardMaterial({ color: 0xf2c521, roughness: .45 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.172, 12, 8, 0, Math.PI * 2, 0, Math.PI * .52), hhM);
    dome.position.y = .03;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.2, .21, .025, 14), hhM);
    brim.position.y = .015;
    parts.head.add(dome, brim);
  }
  parts.head.position.y = .8; // local to torso (0.98 + 0.8 = 1.78 world)
  parts.torso.add(parts.head);

  // name tag + chat bubble
  const tag = nameSprite(name, guest);
  tag.position.y = 2.25;
  g.add(tag);
  const bubbles = []; // stacked chat bubbles above the head: {sp, age, life}

  // held item anchor rides in the right hand so items follow the arm swing
  const heldAnchor = new THREE.Group();
  heldAnchor.position.set(0, -.52, .08);
  parts.armR.add(heldAnchor);

  // fake shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.32, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .02;
  g.add(shadow);

  const av = {
    group: g, parts, tag, bubbles, heldAnchor, shadow,
    anim: 'idle', animT: Math.random() * 10, held: null, heldMesh: null, swingT: 0,
    setVest(v) {
      const c = VEST_COLORS[v];
      parts.vest.visible = c !== null && c !== undefined;
      parts.stripes.forEach(s => s.visible = parts.vest.visible);
      if (c) parts.vest.material.color.setHex(c);
    },
    setHeld(item) {
      if (item === av.held) return;
      av.held = item;
      if (av.heldMesh) { heldAnchor.remove(av.heldMesh); av.heldMesh = null; }
      const m = item ? buildHeldMesh(item) : null;
      if (!m) return;
      const grip = GRIPS[item];
      if (grip) {
        m.position.set(...grip.p);
        m.rotation.set(...grip.r);
      }
      heldAnchor.add(m);
      av.heldMesh = m;
    },
    swing() { av.swingT = 1; },
    flash() { // hurt: whole body glows red for a beat
      for (const m of [shirtM, skinM, pantsM, parts.vest.material]) {
        m.emissive.setHex(0xd42020);
        m.emissiveIntensity = .85;
      }
      clearTimeout(av._flashT);
      av._flashT = setTimeout(() => {
        for (const m of [shirtM, skinM, pantsM, parts.vest.material]) {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      }, 160);
    },
    say(text) {
      const tex = ct(512, 160, (gg, w, h) => {
        gg.font = '400 26px "Segoe UI", sans-serif';
        const words = String(text).split(' ');
        const lines = [];
        let cur = '';
        for (const wd of words) {
          if (gg.measureText(cur + ' ' + wd).width > 420) { lines.push(cur); cur = wd; }
          else cur = cur ? cur + ' ' + wd : wd;
        }
        lines.push(cur);
        const lh = 34, bh = lines.length * lh + 26;
        gg.fillStyle = 'rgba(255,255,255,.95)';
        gg.beginPath(); gg.roundRect(16, h - bh - 14, w - 32, bh, 16); gg.fill();
        gg.beginPath(); gg.moveTo(w / 2 - 12, h - 15); gg.lineTo(w / 2 + 12, h - 15); gg.lineTo(w / 2, h); gg.fill();
        gg.fillStyle = '#1a2230'; gg.textAlign = 'center';
        lines.forEach((l, i) => gg.fillText(l, w / 2, h - bh + 8 + (i + .6) * lh));
      });
      // map is set at construction (a mapless SpriteMaterial compiles its
      // shader untextured — assigning .map later rendered a blank white quad)
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0 });
      const sp = new THREE.Sprite(mat);
      sp.center.set(.5, 0); // bottom-anchored so bubbles stack cleanly
      sp.position.y = 2.42;
      sp.renderOrder = 6;
      sp.scale.set(1.1, .35, 1);
      g.add(sp);
      bubbles.push({ sp, age: 0, life: 6.4 });
      // keep at most 3 on screen — the oldest fast-fades out
      if (bubbles.length > 3) { const old = bubbles[0]; old.life = Math.min(old.life, old.age + .3); }
    },
    // smoothed pose blending: every joint eases toward its target so
    // idle↔walk↔run↔sit transitions flow instead of snapping
    pose: { legL: 0, legR: 0, armL: 0, armR: 0, armSpreadL: 0, armSpreadR: 0, torsoP: 0, torsoR: 0, headY: 0, headX: 0, liftL: 0, liftR: 0, bob: 0 },
    animate(dt) {
      // chat bubbles: pop in with a little overshoot, stack upward, then
      // drift up and fade away at end of life
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.age += dt;
        const back = bubbles.length - 1 - i;                 // 0 = newest
        const ty = 2.42 + back * .56;
        b.sp.position.y += (ty - b.sp.position.y) * Math.min(1, dt * 9);
        const inK = Math.min(1, b.age / .22);
        const pop = 1 + .22 * Math.sin(inK * Math.PI);
        const outK = Math.max(0, (b.age - (b.life - .8)) / .8);
        const s = (.5 + .5 * inK) * pop * (1 - .15 * outK);
        b.sp.scale.set(2.2 * s, .69 * s, 1);
        b.sp.material.opacity = Math.min(1, inK * 1.4) * (1 - outK);
        if (outK > 0) b.sp.position.y += dt * .35;
        if (b.age >= b.life) {
          g.remove(b.sp);
          b.sp.material.map?.dispose(); b.sp.material.dispose();
          bubbles.splice(i, 1);
        }
      }
      const p = av.pose;
      const moving = av.anim === 'walk' || av.anim === 'run';
      const run = av.anim === 'run';
      av.animT += dt * (run ? 12.5 : moving ? 8.5 : 1.6);
      const t = av.animT;
      const tgt = { legL: 0, legR: 0, armL: 0, armR: 0, armSpreadL: .04, armSpreadR: .04, torsoP: 0, torsoR: 0, headY: 0, headX: 0, liftL: 0, liftR: 0, bob: 0 };

      const crouched = av.anim === 'crouch' || av.anim === 'crouchwalk';
      if (crouched) {
        const moving2 = av.anim === 'crouchwalk';
        if (moving2) av.animT += dt * 4.6; // sneaky gait cadence on top of idle rate
        const s = Math.sin(t);
        // deep asymmetric squat: lead leg tucked, trail leg braced
        tgt.legL = -1.2 + (moving2 ? s * .42 : 0);
        tgt.legR = -.78 + (moving2 ? -s * .42 : 0);
        tgt.liftL = .36 + (moving2 ? Math.max(0, Math.cos(t)) * .05 : 0);
        tgt.liftR = .3 + (moving2 ? Math.max(0, -Math.cos(t)) * .05 : 0);
        tgt.torsoP = .46 + (moving2 ? Math.abs(s) * .04 : Math.sin(t * 1.3) * .015);
        tgt.torsoR = moving2 ? s * .07 : 0;               // low waddle
        tgt.armL = -.55 + (moving2 ? -s * .3 : 0);
        tgt.armR = av.heldMesh ? -.8 : -.55 + (moving2 ? s * .3 : 0);
        tgt.armSpreadL = .2; tgt.armSpreadR = .2;         // arms out for balance
        tgt.headX = -.38;                                 // keep eyes level despite the hunch
        tgt.bob = -.52 + (moving2 ? Math.abs(s) * .05 : Math.sin(t * 1.3) * .008);
      } else if (av.anim === 'sit') {
        tgt.legL = -Math.PI / 2 + .22; tgt.legR = -Math.PI / 2 + .28;
        tgt.armL = -.55; tgt.armR = -.55;
        tgt.torsoP = -.06;
        tgt.headX = .1;
        tgt.bob = -.42;
      } else if (moving) {
        const amp = run ? .85 : .55;
        const s = Math.sin(t), c = Math.cos(t);
        tgt.legL = s * amp;
        tgt.legR = -s * amp;
        tgt.liftL = Math.max(0, c * (run ? .09 : .05));   // heel lift on the swing-through
        tgt.liftR = Math.max(0, -c * (run ? .09 : .05));
        tgt.armL = -s * amp * .85;
        tgt.armR = av.heldMesh ? -.75 : s * amp * .85;
        tgt.armSpreadL = .1; tgt.armSpreadR = .1;
        tgt.torsoP = run ? .16 : .07;                     // lean into the run
        tgt.torsoR = s * (run ? .05 : .028);              // shoulder roll
        tgt.headY = Math.sin(t * .5) * .06;
        tgt.bob = Math.abs(s) * (run ? .07 : .04);
      } else { // idle: breathing, tiny weight shifts, occasional glance
        tgt.armL = Math.sin(t * 1.1) * .045;
        tgt.armR = av.heldMesh ? -.75 : Math.sin(t * 1.1 + .9) * .045;
        tgt.torsoP = Math.sin(t * 1.4) * .012;            // breathing
        tgt.torsoR = Math.sin(t * .42) * .02;             // weight shift
        tgt.headY = Math.sin(t * .3) * .22 + Math.sin(t * .77) * .08;
        tgt.headX = Math.sin(t * .5) * .03;
        tgt.bob = Math.sin(t * 1.4) * .008;
      }

      // airborne: tuck the legs, arms out for balance (overrides gait targets)
      if (av.airborne && av.anim !== 'sit' && !crouched) {
        tgt.legL = -.6; tgt.legR = -.22;
        tgt.liftL = .14; tgt.liftR = .05;
        tgt.armL = -.45; tgt.armR = av.heldMesh ? -.8 : -.45;
        tgt.armSpreadL = .5; tgt.armSpreadR = av.heldMesh ? .15 : .5;
        tgt.torsoP = .14;
        tgt.bob = 0;
      }

      // critically-damped-ish exponential ease toward targets
      const k = Math.min(1, dt * (av.anim === 'sit' || moving ? 10 : crouched ? 11 : 8));
      for (const key in tgt) p[key] += (tgt[key] - p[key]) * k;

      parts.legL.rotation.x = p.legL; parts.legR.rotation.x = p.legR;
      parts.legL.position.y = .82 + p.liftL; parts.legR.position.y = .82 + p.liftR;
      parts.armL.rotation.x = p.armL; parts.armR.rotation.x = p.armR;
      parts.armL.rotation.z = p.armSpreadL; parts.armR.rotation.z = -p.armSpreadR;
      parts.torso.rotation.x = p.torsoP;
      parts.torso.rotation.z = p.torsoR;
      parts.head.rotation.y = p.headY;
      parts.head.rotation.x = p.headX;
      av.bobY = p.bob;
      // one-shot melee attack overlay — each prop gets its own move:
      // tube = overhead slam, broom = wide sweep, tapegun = quick jab,
      // banana = silly spin-flick, paddle/wrench = cross-body chop
      const style = SWING_STYLES[av.held] || SWING_STYLES.default;
      if (av.swingT > 0) {
        av.swingT = Math.max(0, av.swingT - dt * style.speed);
        const t2 = 1 - av.swingT;                 // 0 → 1 over the swing
        const wind = Math.sin(Math.min(t2 / .3, 1) * Math.PI / 2);   // raise
        const smash = t2 < .3 ? 0 : Math.sin((t2 - .3) / .7 * Math.PI); // strike arc
        const [ax, ay, az] = style.arm(wind, smash);
        parts.armR.rotation.x = p.armR + ax;
        parts.armR.rotation.y = ay;
        parts.armR.rotation.z = -p.armSpreadR + az;
        const [tx2, ty2] = style.torso(wind, smash);
        parts.torso.rotation.x = p.torsoP + tx2;
        parts.torso.rotation.y = ty2;
        parts.head.rotation.y = p.headY + style.head(smash);
      } else {
        parts.armR.rotation.y = 0;
        parts.torso.rotation.y = 0;
      }
    },
  };
  av.setVest(vest);
  return av;
}
