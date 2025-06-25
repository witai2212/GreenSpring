GreenSpring/
├── api
    └── config
├── public/
│   └── index.html        ← Frontend: buttons, switches, live status
├── gpi-config.json
├── package.json
├── server.js             ← Node.js backend

Setup:
mkdir gpio-webapp && cd gpio-webapp
npm init -y
npm install express socket.io onoff
