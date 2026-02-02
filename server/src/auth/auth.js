const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class AuthManager {
  constructor(storage, logger, config) {
    this.storage = storage;
    this.logger = logger;
    this.config = config;
    this.sessions = new Map();
    this.persistSessions = Boolean(this.config?.auth?.persistSessions);
    this.initDefaultAdmin();
    this.loadSessions();
  }

  initDefaultAdmin() {
    const users = this.storage.loadUsers();

    if (users.length === 0) {
      const defaultAdmin = {
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin', 10),
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        role: 'admin'
      };

      this.storage.saveUsers([defaultAdmin]);
      this.logger.info('Utente admin di default creato', { username: 'admin' });
    }
  }

  loadSessions() {
    if (!this.persistSessions) {
      this.storage.saveSessions({});
      this.logger.info('Persistenza sessioni disabilitata: sessioni azzerate all\'avvio');
      return;
    }
    const sessions = this.storage.loadSessions();
    if (sessions) {
      // Converti da oggetto a Map
      Object.entries(sessions).forEach(([sessionId, session]) => {
        this.sessions.set(sessionId, session);
      });
      this.logger.info('Sessioni ripristinate', { count: this.sessions.size });
    }
  }

  saveSessions() {
    if (!this.persistSessions) {
      return;
    }
    // Converti Map a oggetto per JSON
    const sessionsObj = {};
    this.sessions.forEach((session, sessionId) => {
      sessionsObj[sessionId] = session;
    });
    this.storage.saveSessions(sessionsObj);
  }

  async authenticate(username, password) {
    const users = this.storage.loadUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
      this.logger.logAuthAttempt(username, false, 'user_not_found');
      return { success: false, reason: 'Credenziali non valide' };
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      this.logger.logAuthAttempt(username, false, 'invalid_password');
      return { success: false, reason: 'Credenziali non valide' };
    }

    const sessionId = uuidv4();
    this.sessions.set(sessionId, {
      username: user.username,
      role: user.role,
      createdAt: Date.now(),
      lastAccess: Date.now()
    });

    // Persisti sessioni su disco
    this.saveSessions();

    this.logger.logAuthAttempt(username, true);

    return {
      success: true,
      sessionId,
      mustChangePassword: user.mustChangePassword,
      username: user.username,
      role: user.role
    };
  }

  validateSession(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'session_not_found' };
    }

    const timeout = this.config.auth.sessionTimeout || 3600000;
    const now = Date.now();

    if (now - session.lastAccess > timeout) {
      this.sessions.delete(sessionId);
      this.saveSessions();
      return { valid: false, reason: 'session_expired' };
    }

    session.lastAccess = now;

    // Salva sessioni periodicamente (ogni validazione sarebbe troppo, solo ogni 5 minuti)
    const lastSave = session.lastSave || 0;
    if (now - lastSave > 300000) { // 5 minuti
      session.lastSave = now;
      this.saveSessions();
    }

    return {
      valid: true,
      username: session.username,
      role: session.role
    };
  }

  logout(sessionId) {
    this.sessions.delete(sessionId);
    this.saveSessions();
    this.logger.debug('Logout effettuato', { sessionId });
  }

  changePassword(username, oldPassword, newPassword) {
    const users = this.storage.loadUsers();
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex === -1) {
      return { success: false, reason: 'Utente non trovato' };
    }

    const user = users[userIndex];

    const passwordValid = bcrypt.compareSync(oldPassword, user.passwordHash);

    if (!passwordValid) {
      return { success: false, reason: 'Password corrente non valida' };
    }

    const minLength = this.config.auth.passwordMinLength || 8;
    if (newPassword.length < minLength) {
      return { success: false, reason: `La password deve essere di almeno ${minLength} caratteri` };
    }

    users[userIndex].passwordHash = bcrypt.hashSync(newPassword, 10);
    users[userIndex].mustChangePassword = false;
    users[userIndex].passwordChangedAt = new Date().toISOString();

    this.storage.saveUsers(users);
    this.logger.info('Password cambiata', { username });

    return { success: true };
  }

  createUser(username, password, role = 'admin', mustChangePassword = false) {
    const users = this.storage.loadUsers();

    if (users.find(u => u.username === username)) {
      return { success: false, reason: 'Utente già esistente' };
    }

    const minLength = this.config.auth.passwordMinLength || 8;
    if (password.length < minLength) {
      return { success: false, reason: `La password deve essere di almeno ${minLength} caratteri` };
    }

    const newUser = {
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      mustChangePassword,
      createdAt: new Date().toISOString(),
      role
    };

    users.push(newUser);
    this.storage.saveUsers(users);
    this.logger.info('Utente creato', { username, role });

    return { success: true };
  }

  getUsers() {
    return this.storage.loadUsers().map(u => ({
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      mustChangePassword: u.mustChangePassword
    }));
  }

  getAllUsers() {
    return this.storage.loadUsers();
  }

  resetPassword(username, newPassword) {
    const users = this.storage.loadUsers();
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex === -1) {
      return { success: false, reason: 'Utente non trovato' };
    }

    const minLength = this.config.auth.passwordMinLength || 8;
    if (newPassword.length < minLength) {
      return { success: false, reason: `La password deve essere di almeno ${minLength} caratteri` };
    }

    users[userIndex].passwordHash = bcrypt.hashSync(newPassword, 10);
    users[userIndex].mustChangePassword = false;
    users[userIndex].passwordChangedAt = new Date().toISOString();

    this.storage.saveUsers(users);
    this.logger.info('Password resettata', { username });

    return { success: true };
  }

  importUser(userData) {
    const users = this.storage.loadUsers();
    const existingIndex = users.findIndex(u => u.username === userData.username);

    if (existingIndex !== -1) {
      users[existingIndex] = {
        ...users[existingIndex],
        ...userData,
        updatedAt: new Date().toISOString()
      };
    } else {
      users.push({
        ...userData,
        createdAt: new Date().toISOString()
      });
    }

    this.storage.saveUsers(users);
    this.logger.debug('Utente importato', { username: userData.username });

    return { success: true };
  }

  deleteUser(username) {
    if (username === 'admin') {
      return { success: false, reason: 'Impossibile eliminare l\'utente admin' };
    }

    const users = this.storage.loadUsers();
    const filteredUsers = users.filter(u => u.username !== username);

    if (filteredUsers.length === users.length) {
      return { success: false, reason: 'Utente non trovato' };
    }

    this.storage.saveUsers(filteredUsers);
    this.logger.info('Utente eliminato', { username });

    return { success: true };
  }

  cleanupExpiredSessions() {
    const timeout = this.config.auth.sessionTimeout || 3600000;
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccess > timeout) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Sessioni scadute eliminate', { count: cleaned });
    }
  }
}

module.exports = AuthManager;
