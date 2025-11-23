const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BackupServer',
  description: 'Backup management server (Node.js)',
  script: path.join(__dirname, 'app.js')
});

svc.on('install', () => {
  console.log('Service installed');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Service already installed');
});

svc.on('start', () => {
  console.log('Service started');
});

svc.install();
