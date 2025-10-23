# GreenSpring

Simple web dashboard to **view/toggle Raspberry Pi GPIO pins** with live updates and optional **MQTT** bridge. Ships with a Bootstrap UI (`public/`), a Node.js backend (`server.js`), and JSON files for config/state.

> Works in two modes:
> - **Pi mode** (with real GPIO via `onoff`)
> - **Mock/dev mode** (no hardware; useful for testing UI + JSON saving)

---

## Features

- **Realtime UI** (Socket.IO) to toggle outputs and see inputs change  
- **Editable GPIO config** (`/api/config`) with a basic **Admin UI** (`/public/admin.html`)  
- **State persistence** in `gpio-state.json`  
- **MQTT bridge**  
  - Publishes state to `home/gpio/<PIN>/state` (`ON`/`OFF`)  
  - Listens to `home/gpio/<PIN>/set` to drive outputs  
- **Static assets** under `public/` (Bootstrap, icons, favicon)

---

## Project structure

```
greenspring/
├─ public/
│  ├─ index.html         # main dashboard
│  ├─ admin.html         # config editor (calls /api/config)
│  └─ img/icons/...      # favicons & logos
├─ server.js             # Express + Socket.IO + onoff + MQTT
├─ gpio-config.json      # which pins exist, labels, directions
├─ gpio-state.json       # (created at runtime) last-known output states
└─ package.json          # (optional) add deps here
```

**Config file example (`gpio-config.json`):**
```json
{
  "pins": [
    { "number": 17, "label": "LED", "direction": "out" },
    { "number": 22, "label": "Button", "direction": "in" }
  ]
}
```

---

## Requirements

- **Node.js 18+** on the machine that runs `server.js`
- On Raspberry Pi (Pi mode):  
  - `onoff` requires access to GPIO (run with proper permissions or via `sudo`)
- MQTT (optional): reachable broker URL + credentials

> On regular **shared web hosting without Node**, you can only serve `public/` as static files. The live GPIO/MQTT features require the Node server running somewhere.

---

## Install & Run

> If you don’t want to use npm on shared hosting, skip to **“Static hosting only”** below.

1) **Install dependencies** (recommended)
```bash
# in the project directory
npm init -y
npm install express socket.io onoff mqtt
# (optional dev auto-reload)
npm install --save-dev nodemon
```

2) **Configure MQTT (optional)**  
Set environment variables (recommended):
```bash
export MQTT_URL="mqtt://localhost"
export MQTT_USERNAME="user"
export MQTT_PASSWORD="pass"
export MQTT_PREFIX="home/gpio"
```
Or edit directly in `server.js` (less flexible).

3) **Run**
```bash
# Pi mode (with real GPIO)
node server.js

# Dev mode with auto-reload (optional)
npx nodemon server.js

# Mock mode (no hardware)
GS_MOCK=1 node server.js
```

4) **Open the UI**  
Visit: `http://localhost:3000/`

- Dashboard: `/` (index.html)  
- Admin config editor: `/admin.html`

---

## Static hosting only (no Node)

If your shared host only serves static files:

- Upload the `public/` folder and open `public/index.html` in your browser.  
- You can view the layout, but **no realtime or GPIO/MQTT** works without the Node server.  
- To test config/state flows without hardware, run the backend **elsewhere** (your PC or a small VPS) and point your browser to that server.

---

## Configuration

### Edit pins via Admin UI
- Open `/admin.html`, add/remove rows, set:
  - **number** (BCM GPIO number)
  - **label** (display name)
  - **direction**: `in` or `out`
- Save. The server writes `gpio-config.json` and reloads pins.

### File paths (important!)
This version uses **absolute paths** to avoid “wrong path” issues:
```js
const path = require('path');
const CONFIG_FILE = path.join(__dirname, 'gpio-config.json');
const STATE_FILE  = path.join(__dirname, 'gpio-state.json');
app.use(express.static(path.join(__dirname, 'public')));
```

---

## MQTT topics

- **Publish (from server):**  
  `home/gpio/<PIN>/state` → `ON` or `OFF`
- **Subscribe (server listens):**  
  `home/gpio/<PIN>/set` → `ON` or `OFF`

Use this to integrate with **Home Assistant** or other systems.

---

## Mock / Dev mode (no GPIO)

Toggle with env var:
```bash
GS_MOCK=1 node server.js
```
In mock mode, GPIO is emulated in-memory and mirrored to `gpio-state.json` so you can test the UI, config saving, and MQTT without hardware.

---

## Security notes

- There’s **no auth** by default. Put it **behind your LAN/VPN** or add simple auth (HTTP Basic, token check) in `server.js`.
- If exposing to the internet, add:
  - Auth + CSRF protection
  - CORS rules
  - HTTPS termination (proxy like Nginx/Caddy)

---

## System service (Pi)

Create a systemd unit so it runs on boot:

```
/etc/systemd/system/greenspring.service
```

```ini
[Unit]
Description=GreenSpring GPIO Dashboard
After=network.target

[Service]
WorkingDirectory=/home/pi/greenspring
ExecStart=/usr/bin/node server.js
Restart=always
User=pi
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now greenspring
```

---

## Troubleshooting

**Config not loading / cannot save pins**
- Start the server from the project folder or use absolute paths (already enabled).
- Ensure the process can **read/write** `gpio-config.json` and `gpio-state.json`:
  ```bash
  ls -l gpio-*.json || true
  touch gpio-config.json gpio-state.json
  chmod 664 gpio-*.json
  ```

**“It works locally but not on my shared host”**
- Shared hosts usually **don’t run Node**. You can only serve `/public`.  
  Run the Node server on a Pi/VPS and access it remotely.

**MQTT not connecting**
- Verify `MQTT_URL`, credentials, and network reachability.

**Auto-reload not working**
- Install and run with `npx nodemon server.js`.

**GPIO permission errors on Pi**
- Run as a user with GPIO access or use `sudo`.
- On newer Raspberry Pi OS, ensure the **gpio** group permissions are set.

---

## Roadmap

- Proper **auth** and CORS
- REST endpoints for scripting
- Health page (GPIO, MQTT, config path checks)
- Better logging & validation on `/api/config`

---

## License

MIT
