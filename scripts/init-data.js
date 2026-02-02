const fs = require('fs');
const path = require('path');
const bcrypt = require('../server/node_modules/bcryptjs');

function resolveConfigPath() {
  const candidates = [
    process.env.CONFIG_PATH,
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), '..', 'config.json'),
    path.join(__dirname, '..', 'config.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Impossibile trovare config.json. Cercati percorsi:\n${candidates.join('\n')}`);
}

function loadConfig() {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  const configDir = path.dirname(configPath);

  if (config.dataRoot && !path.isAbsolute(config.dataRoot)) {
    config.dataRoot = path.join(configDir, config.dataRoot);
  }

  if (!config.dataRoot) {
    config.dataRoot = path.join(configDir, 'data');
  }

  return config;
}

function ensureDirectories(basePath) {
  const dirs = [
    basePath,
    path.join(basePath, 'config'),
    path.join(basePath, 'config', 'policies'),
    path.join(basePath, 'state'),
    path.join(basePath, 'state', 'jobs'),
    path.join(basePath, 'state', 'runs'),
    path.join(basePath, 'state', 'agents'),
    path.join(basePath, 'state', 'scheduler'),
    path.join(basePath, 'users'),
    path.join(basePath, 'logs')
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Creata directory: ${dir}`);
    }
  });
}

function initSchedulerState(basePath) {
  const schedulerStatePath = path.join(basePath, 'state', 'scheduler', 'state.json');
  if (!fs.existsSync(schedulerStatePath)) {
    fs.writeFileSync(
      schedulerStatePath,
      JSON.stringify({ jobs: [] }, null, 2),
      'utf8'
    );
    console.log(`Creato stato scheduler vuoto: ${schedulerStatePath}`);
  }
}

function initDefaultAdmin(basePath, password) {
  const usersPath = path.join(basePath, 'users', 'users.json');

  if (fs.existsSync(usersPath)) {
    console.log('File utenti già presente: nessuna modifica.');
    return;
  }

  const adminPassword = password || process.env.ADMIN_PASSWORD || 'admin';
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  const defaultUser = {
    username: 'admin',
    passwordHash,
    role: 'admin',
    mustChangePassword: true,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(usersPath, JSON.stringify([defaultUser], null, 2), 'utf8');
  console.log(
    `Creato utente admin predefinito in ${usersPath} (password iniziale: ${adminPassword})`
  );
}

function main() {
  try {
    const config = loadConfig();
    const basePath = config.dataRoot;

    console.log(`Config caricata. dataRoot: ${basePath}`);

    ensureDirectories(basePath);
    initSchedulerState(basePath);

    const providedPassword = process.argv[2];
    initDefaultAdmin(basePath, providedPassword);

    console.log('\nInizializzazione completata.');
  } catch (error) {
    console.error('Errore durante l\'inizializzazione:', error.message);
    process.exit(1);
  }
}

main();
