GreenSpring/
├── api/

│   └── config/           ← saving configuration

├── public/

│   └── index.html        ← Frontend: buttons, switches, live status

├── gpio-config.json      ← GPIO configuration

├── package.json

├── server.js             ← Node.js backend


Setup:
mkdir gpio-webapp && cd gpio-webapp
npm init -y
npm install express socket.io onoff


server.js:
edit mqtt server ip-address as well as username and password
