# 🏓 Amazon Break Room Simulator

[![Play now](https://img.shields.io/badge/play-simulator.rest-ff9900)](https://simulator.rest)
[![License: MIT](https://img.shields.io/badge/license-MIT-2de07c)](LICENSE)

A **free, open-source** realtime multiplayer 3D web game recreating an Amazon fulfillment
center break room, modeled from real photos. Runs on desktop and mobile — no build step,
vanilla JS + Three.js.

🎮 **Play it live: [simulator.rest](https://simulator.rest)** · 💻 **Source: [github.com/OpenVibers/BreakRoomSimulator](https://github.com/OpenVibers/BreakRoomSimulator)**

Issues and pull requests are welcome — map fixes, minigames, props, anything.

## Run it

```bash
git clone https://github.com/OpenVibers/BreakRoomSimulator.git
cd BreakRoomSimulator
npm install
npm start          # → http://localhost:3000
```

Open the URL on any device on your network (`http://<your-ip>:3000`) and everyone shares
the same break room. `?autoguest` in the URL skips the login screen with a guest account.

## The building (photo-accurate route)

You spawn on the **landscaped front walkway** (planter beds, Amazon Tours signs,
food truck, flag pole, bollarded plaza) under the huge white facade with its
blue roofline stripe, wood-band tower with the Amazon smile, and blue
**"main entry"** canopy — then enter the way associates really do:

**main entry glass doors** → **entry lobby** (blue walls, Amazon Family World
Map mural, green **hedge wall** with the neon *"Welcome to PAE2"* script, red
garland, Enter / Do-Not-Enter lanes) → **badge gates** (E to badge; paddles
open) → **security** (freestanding white **PAE2** desk island, three metal-detector
lanes + x-ray belt feeding the *Safe to Go* arch into the FC, Peccy statue,
*thank you / Exit* band) → through the mural wall's **locker opening** →
**locker hallway** (tan locker banks, teal floor path) → **double
doors by the red clock + flags** → **cafeteria** (avenue C market, dining
zones, couch corner, ping pong, giant Connect 4, chess, arcade, bathrooms,
smoke cage outside). All exterior cafeteria doors are emergency-exit-only.

## Admin & level editor

- The **first registered account** automatically becomes admin
  (or grant later: `node server/server.js --admin SomeName`).
- Admins get a 🛠️ button — a **persistent level editor**: place, move, rotate,
  scale, and delete props (tables, chairs, couches, lockers, vending, walls,
  invisible blockers, …). Edits save to `data/map-edits.json`, sync live to
  every connected player, and survive restarts.

## Features

- **Accounts** — register/login (scrypt-hashed passwords, JSON store) or play as a guest.
  Vest color and win stats persist per account.
- **Realtime multiplayer** — websocket sync (12 Hz snapshots): avatars, walk/run/sit
  animation, name tags, chat with speech bubbles, join/leave feed.
- **The room, from the photos**:
  - Lounge: leather couches inside blue-tape outlines labeled *COUCH*, oriental rug,
    coffee tables, bookshelves with board games, palm plants, *Together at Amazon* banner
  - Games corner: two JOOLA-style ping pong tables, yellow *PRIME BREAKER* arcade
    cabinet, chess table, **two giant Connect 4s**, cornhole board, stacked-chair zone
  - Dining hall: 40 clusters of folding tables, ~500 chairs color-zoned
    green → brown → orange → yellow, napkin dispensers, *July Newsletter* table tents
  - *avenue C* micro-market: glass-door coolers, snack slat-walls, self-checkout kiosks,
    Pepsi vending machines, Red Bull cooler, coffee station, microwaves, lockers
  - Annex corridor through the wide passage (from the panorama): day lockers,
    avenue C café/servery nook, glass-walled wellness room, teal walking-path
    tape with red STOP floor decals, second entrance doors
  - International flags around the whole perimeter + strung across the hall,
    blue-fascia recessed ceiling sections with yellow accent trim, pendant lights,
    live red LED clocks, TVs cycling live slides (online count, ping pong ladder),
    floor-to-ceiling windows with a parking lot, cars, trees, and a stop sign outside
- **Playable games** (server-authoritative):
  - 🏓 **Ping pong** — timing-based rallies, first to 7; solo practice mode
  - 🔴 **Giant Connect 4** — click a column to drop; win detection + rematch
  - ♟️ **Chess** — casual rules (capture the king), move validation, promotion
  - 🕹️ **PRIME BREAKER** — breakout arcade game with server-wide highscore board
    shown on the cabinet screen
  - 🛒 Grab snacks/drinks/coffee — item shows in your avatar's hand
- **Mobile** — virtual joystick, drag look, touch buttons, fullscreen.

## Controls

| Desktop | Mobile |
|---|---|
| WASD walk, Shift run, Space jump (bhop-friendly), Ctrl crouch | joystick (push far = run), 🔽 crouch, ⤒ jump |
| Mouse (click to lock) to look · V or 📷 first person | drag right side |
| E interact · F use item / swing prop | `E` button |
| 1-6 hotbar · Tab/🎒 inventory (drag & drop) | tap hotbar / 🎒 |
| Click column/square to play boards | tap column/square |
| Enter chat | 💬 button |

Movement is Source-engine style: ground friction + wish-direction acceleration,
air-strafe control with capped air acceleration, and jumps that preserve
horizontal velocity. Collect snacks (consumable), melee props (paddle, broom,
tape gun, wrench, banana, cardboard tube — swing with F or click in first
person), and clothes (hats/vests) from vending machines and pickups around the
facility. Inventory persists on your account.

## Stack

Node + Express + `ws` (no build step), Three.js frontend served as ES modules.
All textures are procedurally drawn on canvas — flags, signage, vending machines,
the rug — no external assets. Data persists to `data/*.json`.

## Website & public hosting (simulator.rest)

The server now serves a marketing landing page at `/` and the game itself at `/play`.
Real screenshots for the landing page live in `public/img/`.

### One-command deploy (Docker + Caddy, automatic HTTPS)

On any Linux server (1 vCPU / 1 GB is plenty to start):

1. Point DNS: `A` records for `simulator.rest` and `www.simulator.rest` → your server's IP.
2. Copy the project to the server (or `git clone` it), then:

```bash
docker compose up -d --build
```

That's it. The `game` container runs the Node server (only exposed to localhost),
and the `caddy` container terminates TLS for **simulator.rest** with an automatic
Let's Encrypt certificate and proxies HTTP + websockets through. Player accounts,
highscores and map edits persist in `./data` on the host.

- First registered account becomes **admin** (or grant later: `node server/server.js --admin NAME`
  won't work while the server runs — instead stop, run once with the flag, restart).
- Update: `git pull && docker compose up -d --build`.
- Logs: `docker compose logs -f game`.

### Without Docker

```bash
npm install
PORT=3000 npm start
```

then put any TLS-terminating proxy in front (the websocket path is same-origin, so a
plain `reverse_proxy`/`proxy_pass` with upgrade headers is all that's needed). Example
nginx location block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

A systemd unit for bare-metal installs:

```ini
[Unit]
Description=Amazon Break Room Simulator
After=network.target

[Service]
WorkingDirectory=/opt/amazon-break-room-simulator
ExecStart=/usr/bin/node server/server.js
Restart=always
Environment=PORT=3000
User=www-data

[Install]
WantedBy=multi-user.target
```
