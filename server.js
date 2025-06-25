// server.js
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Gpio = require('onoff').Gpio;
const mqtt = require('mqtt');

// Load GPIO config and state
const CONFIG_FILE = 'gpio-config.json';
const STATE_FILE = 'gpio-state.json';

let config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
let savedState = {};
try {
  savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (e) {
  savedState = {};
}

const app = express();
app.use(express.json());
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server);

// MQTT setup
// setting to be edited according to your setting
const mqttClient = mqtt.connect('mqtt://192.168.178.12', {
  username: 'admin',
  password: 'password'
});

mqttClient.on('error', err => {
  console.error('MQTT Error:', err.message);
});

let pins = {};

function setupGpioPins() {
  // Cleanup existing watchers and unexport pins
  for (const pin in pins) {
    try {
      pins[pin].gpio.unwatchAll();
      pins[pin].gpio.unexport();
    } catch {}
  }

  pins = {};

  config.pins.forEach(({ number, label, direction }) => {
    const gpio = new Gpio(number, direction);
    if (direction === 'out') {
      gpio.writeSync(savedState[number] ?? 0);
    } else if (direction === 'in') {
      gpio.watch((err, value) => {
        if (!err) {
          emitStatus();
          mqttClient.publish(`home/gpio/${number}/state`, value ? 'ON' : 'OFF');
        }
      });
    }
    pins[number] = { gpio, label, direction };
  });
}

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  config.pins.forEach(pin => {
    mqttClient.subscribe(`home/gpio/${pin.number}/set`);
  });
});

mqttClient.on('message', (topic, message) => {
  const match = topic.match(/home\/gpio\/(\d+)\/set/);
  if (match) {
    const pin = match[1];
    const value = message.toString() === 'ON' ? 1 : 0;
    if (pins[pin] && pins[pin].direction === 'out') {
      pins[pin].gpio.writeSync(value);
      saveState(pin, value);
      emitStatus();
      mqttClient.publish(`home/gpio/${pin}/state`, value ? 'ON' : 'OFF');
    }
  }
});

function emitStatus() {
  const status = {};
  for (const pin in pins) {
    const obj = pins[pin];
    status[pin] = {
      value: obj.gpio.readSync(),
      label: obj.label,
      direction: obj.direction
    };
  }
  io.emit('status', status);
}

function saveState(pin, value) {
  savedState[pin] = value;
  fs.writeFileSync(STATE_FILE, JSON.stringify(savedState, null, 2));
}

io.on('connection', (socket) => {
  emitStatus();

  socket.on('toggle', (pin) => {
    if (pins[pin] && pins[pin].direction === 'out') {
      const newValue = pins[pin].gpio.readSync() ^ 1;
      pins[pin].gpio.writeSync(newValue);
      saveState(pin, newValue);
      emitStatus();
      mqttClient.publish(`home/gpio/${pin}/state`, newValue ? 'ON' : 'OFF');
    }
  });
});

// API endpoint to GET current GPIO config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// API endpoint to POST new GPIO config with live reload
app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  if (!Array.isArray(newConfig.pins)) {
    return res.status(400).json({ error: 'Invalid config format: missing pins[]' });
  }

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    config = newConfig;
    setupGpioPins(); // 🔄 reload pins live
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save config:', err);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

setupGpioPins();

server.listen(3000, () => {
  console.log('GPIO dashboard running at http://localhost:3000');
});