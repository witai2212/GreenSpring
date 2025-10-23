// GreenSpring server.js (absolute paths + mock mode + MQTT; fixes small typos)
//
// Requires: express, socket.io, mqtt, onoff (optional in mock mode)
//
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---- Configurable env ----
const PORT = process.env.PORT || 3000;
const USE_MOCK = process.env.GS_MOCK === '1';

const MQTT_URL = process.env.MQTT_URL || '';          // e.g. "mqtt://localhost"
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_PREFIX = process.env.MQTT_PREFIX || 'home/gpio';

// ---- Absolute paths ----
const CONFIG_FILE = path.join(__dirname, 'gpio-config.json');
const STATE_FILE  = path.join(__dirname, 'gpio-state.json');
const PUBLIC_DIR  = path.join(__dirname, 'public');

// ---- GPIO (real or mock) ----
let Gpio;
if (USE_MOCK) {
  console.log('[GPIO] Using MOCK adapter (GS_MOCK=1)');
  Gpio = class {
    constructor(number, direction) {
      this.number = number;
      this.direction = direction;
      this.value = 0;
      this.watchers = [];
    }
    writeSync(v) { this.value = Number(v); this._emit(); }
    readSync() { return this.value; }
    watch(cb) { this.watchers.push(cb); }
    unwatchAll() { this.watchers = []; }
    unexport() {}
    _emit() { this.watchers.forEach(cb => cb(null, this.value)); }
  };
} else {
  try {
    Gpio = require('onoff').Gpio;
  } catch (e) {
    console.warn('[GPIO] onoff not available, falling back to MOCK');
    Gpio = class {
      constructor(number, direction) {
        this.number = number;
        this.direction = direction;
        this.value = 0;
        this.watchers = [];
      }
      writeSync(v) { this.value = Number(v); this._emit(); }
      readSync() { return this.value; }
      watch(cb) { this.watchers.push(cb); }
      unwatchAll() { this.watchers = []; }
      unexport() {}
      _emit() { this.watchers.forEach(cb => cb(null, this.value)); }
    };
  }
}

// ---- MQTT (optional) ----
let mqttClient = null;
if (MQTT_URL) {
  const mqtt = require('mqtt');
  mqttClient = mqtt.connect(MQTT_URL, {
    username: MQTT_USERNAME || undefined,
    password: MQTT_PASSWORD || undefined,
  });
  mqttClient.on('connect', () => console.log('[MQTT] Connected'));
  mqttClient.on('error', err => console.error('[MQTT] Error:', err.message));
}

// ---- Helpers ----
function readJsonSafe(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJsonSafe(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---- Load config & state ----
let config = readJsonSafe(CONFIG_FILE, { pins: [] });
let savedState = readJsonSafe(STATE_FILE, {});

// ---- Runtime pin map ----
const pins = new Map(); // number -> { gpio, meta }

function publishMqtt(number, value) {
  if (!mqttClient) return;
  const topic = `${MQTT_PREFIX}/${number}/state`;
  const payload = value ? 'ON' : 'OFF';
  mqttClient.publish(topic, payload, { retain: true });
}

function subscribeMqttForPin(number) {
  if (!mqttClient) return;
  const setTopic = `${MQTT_PREFIX}/${number}/set`;
  mqttClient.subscribe(setTopic, (err) => {
    if (err) console.error('[MQTT] subscribe error:', err.message);
  });
}

function setupPins() {
  // Clean up existing
  for (const { gpio } of pins.values()) {
    try { gpio.unwatchAll(); gpio.unexport(); } catch {}
  }
  pins.clear();

  // Initialize new pins
  for (const p of config.pins || []) {
    const number = Number(p.number);
    const direction = (p.direction || 'out').toLowerCase() === 'in' ? 'in' : 'out';
    const label = p.label || `GPIO ${number}`;

    const gpio = new Gpio(number, direction);
    const meta = { number, direction, label };
    pins.set(number, { gpio, meta });

    if (direction === 'out') {
      const initial = Number(savedState[number] ?? 0) ? 1 : 0;
      try { gpio.writeSync(initial); } catch {}
      publishMqtt(number, initial);
    } else {
      // input pin: emit changes
      try {
        gpio.watch((err, value) => {
          if (err) return;
          io.emit('pin', { number, value: Number(value) });
          publishMqtt(number, Number(value));
        });
      } catch {}
    }
    subscribeMqttForPin(number);
  }

  broadcastFullState();
}

function getCurrentState() {
  const state = {};
  for (const [num, { gpio, meta }] of pins.entries()) {
    try {
      state[num] = Number(gpio.readSync());
    } catch {
      state[num] = Number(savedState[num] ?? 0);
    }
  }
  return state;
}

function broadcastFullState() {
  io.emit('init', {
    config: config,
    state: getCurrentState(),
  });
}

// ---- Web server ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Config API
app.get('/api/config', (_req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  if (!newConfig || !Array.isArray(newConfig.pins)) {
    return res.status(400).json({ error: 'Invalid config: expected { pins: [...] }' });
  }
  // Basic sanitize
  newConfig.pins = newConfig.pins.map(p => ({
    number: Number(p.number),
    label: String(p.label || ''),
    direction: String(p.direction || 'out').toLowerCase() === 'in' ? 'in' : 'out',
  }));

  config = newConfig;
  try {
    writeJsonSafe(CONFIG_FILE, config);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write gpio-config.json', details: e.message });
  }
  setupPins();
  res.json({ ok: true, config });
});

// State API
app.get('/api/state', (_req, res) => {
  res.json({ state: getCurrentState() });
});

// Socket.IO
io.on('connection', (socket) => {
  // Send current config/state
  socket.emit('init', { config, state: getCurrentState() });

  // Set output pin
  socket.on('setPin', ({ number, value }) => {
    const entry = pins.get(Number(number));
    if (!entry) return;
    const { gpio, meta } = entry;
    if (meta.direction !== 'out') return;

    const v = Number(value) ? 1 : 0;
    try { gpio.writeSync(v); } catch {}
    savedState[meta.number] = v;
    try { writeJsonSafe(STATE_FILE, savedState); } catch {}

    io.emit('pin', { number: meta.number, value: v });
    publishMqtt(meta.number, v);
  });
});

// MQTT inbound control
if (mqttClient) {
  mqttClient.on('message', (topic, payload) => {
    const s = payload.toString().trim().toUpperCase();
    const match = topic.match(new RegExp(`^${MQTT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d+)/set$`));
    if (!match) return;
    const number = Number(match[1]);
    const entry = pins.get(number);
    if (!entry || entry.meta.direction !== 'out') return;
    const v = s === 'ON' || s === '1' ? 1 : 0;
    try { entry.gpio.writeSync(v); } catch {}
    savedState[number] = v;
    try { writeJsonSafe(STATE_FILE, savedState); } catch {}
    io.emit('pin', { number, value: v });
    publishMqtt(number, v);
  });
}

server.listen(PORT, () => {
  console.log(`GreenSpring on http://0.0.0.0:${PORT}`);
  setupPins();
});

// Graceful shutdown
process.on('SIGINT', () => {
  for (const { gpio } of pins.values()) {
    try { gpio.unwatchAll(); gpio.unexport(); } catch {}
  }
  process.exit(0);
});
