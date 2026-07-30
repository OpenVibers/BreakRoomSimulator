// Day/night cycle + lighting. The clock is derived from wall time so every
// player (and every future visitor) shares the same sky — the lot at 3am is
// the same lonely lot for everyone. Full cycle: 24 minutes.
import * as THREE from 'three';
import { W } from './world.js';

const DAY_LEN = 480; // seconds per in-game day — 8 minutes, brisk enough to watch

export function timeOfDay() { // 0 = midnight, .5 = noon
  return (Date.now() / 1000 % DAY_LEN) / DAY_LEN;
}

// give every opaque mesh under root shadow flags (transparent decals would
// cast solid black rectangles)
export function enableShadows(root) {
  root.traverse?.(o => {
    if (!o.isMesh) return;
    const m = o.material;
    const transp = Array.isArray(m) ? m.some(x => x.transparent) : m?.transparent;
    o.castShadow = !transp;
    o.receiveShadow = true;
  });
}

export function initLighting(scene, renderer, shadows = true) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemi = new THREE.HemisphereLight(0xf2f5f8, 0x54575c, 1.0);
  const amb = new THREE.AmbientLight(0xffffff, .22);
  const sun = new THREE.DirectionalLight(0xffeed8, 1.35);
  const moon = new THREE.DirectionalLight(0x8fa8d8, 0);
  sun.castShadow = true;
  // shadow pass = the whole scene rendered again; refresh it every OTHER
  // frame — the sun moves slowly enough that nobody can tell
  renderer.shadowMap.autoUpdate = false;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 240;
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .35;
  scene.add(hemi, amb, sun, sun.target, moon, moon.target);
  // interior fluorescents — the lights stay on all night (Bug44: the facility
  // went pitch black after dark). World coords: cafeteria, security, lockers,
  // service hallway.
  // every light here is evaluated per-fragment on every draw (forward
  // renderer) — fewer, wider lights beat many narrow ones
  const interiorLights = [];
  for (const [x, y, z, i2, dist] of [
    [70, 4.6, 60, .85, 42], [80, 4.6, 82, .85, 42],
    [77, 4.4, -5, .7, 30], [75, 4.2, 24, .65, 26],
    [55.2, 2.8, 69, .6, 40],
  ]) {
    const pl = new THREE.PointLight(0xf6f4ea, i2, dist, 1.2);
    pl.position.set(x, y, z);
    scene.add(pl);
    interiorLights.push(pl);
  }
  enableShadows(scene); // everything built so far

  // stars, on a huge dome, visible only at night
  const starPos = [];
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2, e = .06 + Math.random() * 1.35, r = 235;
    starPos.push(35 + Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, 64 + Math.sin(a) * Math.cos(e) * r);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false,
  }));
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  scene.add(stars);

  const skyDay = new THREE.Color(0xbcd2e2);
  const skyDusk = new THREE.Color(0xe89a5e);
  const skyNight = new THREE.Color(0x0b1322);
  const sunWarm = new THREE.Color(0xff9a4a);
  const sunNoon = new THREE.Color(0xffeed8);
  const hemiDay = new THREE.Color(0xf2f5f8), hemiNight = new THREE.Color(0x28344e);
  const gndDay = new THREE.Color(0x54575c), gndNight = new THREE.Color(0x0e1218);
  const sky = new THREE.Color();
  const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

  // the facility runs 24/7: when the player is inside, ambient light stays
  // near daytime levels no matter the hour (Bug46/47 — interiors went black).
  // Outside the windows it's still night: sun, sky, fog and stars are
  // untouched by this.
  const INDOORS = [
    [58, 92, 31, 107],    // cafeteria / games / market
    [62, 92, -17, 17],    // security lobby
    [58, 92, 17, 31],     // locker hall
    [52.5, 58, 39, 99],   // service hallway
    [48, 53, 63, 82],     // bathrooms
  ];
  let indoorK = 0;

  let frameN = 0;
  function update(dt, px, pz) {
    frameN++;
    if (renderer.shadowMap.enabled && frameN % 3 === 0) renderer.shadowMap.needsUpdate = true;
    const inside = INDOORS.some(([x0, x1, z0, z1]) => px >= x0 && px <= x1 && pz >= z0 && pz <= z1) ? 1 : 0;
    indoorK += (inside - indoorK) * Math.min(1, (dt || .016) * 4);
    const t = timeOfDay();
    const elev = -Math.cos(t * Math.PI * 2);      // -1 midnight … +1 noon
    const az = t * Math.PI * 2;
    const d = smooth(-.14, .28, elev);            // day factor

    sky.copy(skyNight).lerp(skyDay, d);
    if (elev > -.3 && elev < .3) sky.lerp(skyDusk, Math.max(0, 1 - Math.abs(elev) / .3) * .55);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);

    sun.intensity = 1.4 * d;
    sun.color.copy(sunWarm).lerp(sunNoon, smooth(.05, .45, elev));
    sun.position.set(px + Math.sin(az) * 80, Math.max(4, elev * 90), pz + Math.cos(az) * 40);
    sun.target.position.set(px, 0, pz);

    moon.intensity = .22 * (1 - d);
    moon.position.set(px - Math.sin(az) * 70, Math.max(10, -elev * 80), pz - Math.cos(az) * 35);
    moon.target.position.set(px, 0, pz);

    const dl = Math.max(d, indoorK * .82); // indoor light floor: fluorescents
    hemi.intensity = .3 + .75 * dl;
    hemi.color.copy(hemiNight).lerp(hemiDay, dl);
    hemi.groundColor.copy(gndNight).lerp(gndDay, dl);
    amb.intensity = .08 + .16 * dl;

    stars.material.opacity = (1 - d) * .95;

    // lamps/porch lights glow up as the sun goes down
    for (const g of W.nightGlow || []) {
      g.m.emissiveIntensity = g.day + (g.night - g.day) * (1 - d);
    }
    for (const nl of W.nightLights || []) {
      nl.light.intensity = nl.night * (1 - d);
    }
    W.dayFactor = d; // headlights/flashlight read this
    return t;
  }

  function refreshMaterials() {
    scene.traverse(o => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; });
    });
  }
  function setShadowQuality(q) { // 'off' | 'low' | 'high'
    renderer.shadowMap.enabled = q !== 'off';
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    renderer.shadowMap.needsUpdate = true;
    refreshMaterials();
  }
  function setExtraLights(on) { // interior fluorescents + street lamps + fire
    for (const pl of interiorLights) pl.visible = on;
    for (const nl of W.nightLights || []) nl.light.visible = on;
    for (const fl of W.extraLights || []) fl.visible = on;
    refreshMaterials();
  }

  return { update, setShadowQuality, setExtraLights, timeOfDay };
}
