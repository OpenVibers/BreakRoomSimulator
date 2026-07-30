// Simple JSON-file account store with scrypt password hashing. No native deps.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SCORES_FILE = path.join(DATA_DIR, 'highscores.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const GUESTS_FILE = path.join(DATA_DIR, 'guests.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const users = loadJSON(USERS_FILE, {});      // nameLower -> {name, salt, hash, vest, created, stats}
let highscores = loadJSON(SCORES_FILE, []);  // [{name, score, when}]
// guests and their login tokens persist to disk so a server restart doesn't
// wipe anyone's session or a guest's inventory — the world should feel permanent
const guests = new Map(Object.entries(loadJSON(GUESTS_FILE, {})));  // nameLower -> {name, vest, guest:true, inv, hotbar, ...}
const tokens = new Map(Object.entries(loadJSON(SESSIONS_FILE, {}))); // token -> nameLower (guests too)

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    fs.writeFileSync(SCORES_FILE, JSON.stringify(highscores, null, 2));
    fs.writeFileSync(GUESTS_FILE, JSON.stringify(Object.fromEntries(guests), null, 1));
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(tokens)));
  }, 250);
}
export function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  fs.writeFileSync(SCORES_FILE, JSON.stringify(highscores, null, 2));
  fs.writeFileSync(GUESTS_FILE, JSON.stringify(Object.fromEntries(guests), null, 1));
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(tokens)));
}

function hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 32).toString('hex');
}

const NAME_RE = /^[A-Za-z0-9_ -]{2,20}$/;

export function register(name, pass) {
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) return { error: 'Name must be 2-20 chars (letters, numbers, _ - space).' };
  if (String(pass || '').length < 4) return { error: 'Password must be at least 4 characters.' };
  const key = name.toLowerCase();
  if (users[key] || guests.has(key)) return { error: 'That name is already taken.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const firstAccount = Object.keys(users).length === 0; // first registered account runs the place
  users[key] = { name, salt, hash: hashPass(pass, salt), vest: 'yellow', admin: firstAccount, created: Date.now(), stats: { pongWins: 0, c4Wins: 0, chessWins: 0 } };
  saveSoon();
  if (firstAccount) console.log(`[admin] "${name}" registered as the first account and was granted admin.`);
  return { token: issueToken(key), user: publicUser(key) };
}

export function login(name, pass) {
  const key = String(name || '').trim().toLowerCase();
  const u = users[key];
  if (!u) return { error: 'No such account.' };
  if (hashPass(String(pass || ''), u.salt) !== u.hash) return { error: 'Wrong password.' };
  return { token: issueToken(key), user: publicUser(key) };
}

export function guest() {
  let name, key, tries = 0;
  do {
    name = 'Guest' + (1000 + Math.floor(Math.random() * 9000));
    key = name.toLowerCase();
  } while ((users[key] || guests.has(key)) && ++tries < 50);
  guests.set(key, { name, vest: 'yellow', guest: true, stats: { pongWins: 0, c4Wins: 0, chessWins: 0 } });
  saveSoon();
  return { token: issueToken(key), user: publicUser(key) };
}

function issueToken(key) {
  const token = crypto.randomBytes(24).toString('hex');
  // one live token per key: drop stale ones so sessions.json can't grow forever
  for (const [t, k] of tokens) if (k === key) tokens.delete(t);
  tokens.set(token, key);
  saveSoon();
  return token;
}

export function byToken(token) {
  const key = tokens.get(token);
  if (!key) return null;
  return publicUser(key);
}

function publicUser(key) {
  const u = users[key] || guests.get(key);
  if (!u) return null;
  return { key, name: u.name, vest: u.vest || 'yellow', guest: !!u.guest, admin: !!u.admin, ap: u.ap || null, inv: u.inv || null, hotbar: u.hotbar || null, stats: u.stats || {} };
}

export function setAdmin(name, value = true) {
  const u = users[String(name).toLowerCase()];
  if (!u) return false;
  u.admin = value;
  saveSoon();
  return true;
}

export function setAppearance(key, ap) {
  const u = users[key] || guests.get(key);
  if (!u || typeof ap !== 'object' || !ap) return;
  const clean = {};
  for (const f of ['skin', 'shirt', 'hair', 'hat']) {
    if (Number.isInteger(ap[f]) && ap[f] >= 0 && ap[f] <= 16) clean[f] = ap[f];
  }
  u.ap = { ...(u.ap || {}), ...clean };
  saveSoon();
  return u.ap;
}

export const ITEM_IDS = ['chips','soda','candy','coffee','energy','water','food',
  'paddle','broom','tapegun','tube','wrench','banana','physgun','flashlight',
  'wood','stone','axe','pickaxe','stoneaxe','stonepick','pistol','wall','floor',
  'hat-cap','hat-beanie','hat-hardhat','vest-yellow','vest-orange','vest-green','vest-blue','vest-pink'];
export function setInventory(key, inv, hotbar) {
  const u = users[key] || guests.get(key);
  if (!u) return false;
  if (!Array.isArray(inv) || inv.length > 24 || !Array.isArray(hotbar) || hotbar.length > 6) return false;
  const cleanSlot = (s) => {
    if (!s || typeof s !== 'object') return null;
    if (!ITEM_IDS.includes(s.id)) return null;
    return { id: s.id, n: Math.max(1, Math.min(999, Math.floor(Number(s.n) || 1))) };
  };
  u.inv = inv.map(cleanSlot);
  u.hotbar = hotbar.map(cleanSlot);
  saveSoon();
  return true;
}

export function setVest(key, vest) {
  const u = users[key] || guests.get(key);
  if (!u) return;
  const allowed = ['yellow', 'orange', 'green', 'blue', 'pink', 'none'];
  if (!allowed.includes(vest)) return;
  u.vest = vest;
  saveSoon();
}

export function addWin(key, stat) {
  const u = users[key] || guests.get(key);
  if (!u) return;
  u.stats = u.stats || {};
  u.stats[stat] = (u.stats[stat] || 0) + 1;
  saveSoon();
}

export function getInventory(key) {
  const u = users[key] || guests.get(key);
  return u ? { inv: u.inv || [], hotbar: u.hotbar || [] } : null;
}
export function clearInventory(key) {
  const u = users[key] || guests.get(key);
  if (!u) return;
  u.inv = [];
  u.hotbar = [];
  saveSoon();
}

export function getHighscores() { return highscores; }

export function submitScore(name, score) {
  score = Math.max(0, Math.min(999999, Math.floor(Number(score) || 0)));
  if (score <= 0) return highscores;
  highscores.push({ name, score, when: Date.now() });
  highscores.sort((a, b) => b.score - a.score);
  highscores = highscores.slice(0, 10);
  saveSoon();
  return highscores;
}
