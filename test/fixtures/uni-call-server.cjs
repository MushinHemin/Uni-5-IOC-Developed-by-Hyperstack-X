'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const http = require('node:http');
const { once } = require('node:events');
const root = path.resolve(__dirname, '../..');
const password = 'Synthetic-Uni-Call-Only-2026';

async function startFixture({ web = false, timeouts = {}, env = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-call-fixture-'));
  const filename = path.join(directory, 'server.js');
  const app = new Module(filename);
  app.filename = filename;
  app.paths = Module._nodeModulePaths(root);
  const variables = {
    PORT: '0', ADMIN_ACCOUNT: 'call_test_admin', ADMIN_USERNAME: '测试管理员',
    ADMIN_PASSWORD: password, ALLOWED_ORIGINS: '',
    UNI_CALL_STUN_URLS: '', UNI_CALL_TURN_URLS: '', UNI_CALL_TURN_SECRET: '',
    UNI_CALL_ICE_POLICY: 'all', ...env
  };
  const oldEnv = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  const listen = http.Server.prototype.listen;
  try {
    for (const name of ['server.js', 'package.json']) fs.copyFileSync(path.join(root, name), path.join(directory, name));
    if (web) {
      for (const item of ['index.html', 'manifest.json', 'scripts', 'styles', 'assets']) {
        fs.cpSync(path.join(root, 'public', item), path.join(directory, 'public', item), { recursive: true });
      }
    }
    const call = require('../../lib/uni-call.js');
    const requireLocal = app.require.bind(app);
    app.require = (name) => name === './lib/uni-call'
      ? { createUniCall: options => call.createUniCall({ ...options, ...timeouts }) }
      : requireLocal(name);
    Object.assign(process.env, variables);
    http.Server.prototype.listen = function (_port, callback) {
      return listen.call(this, 0, '127.0.0.1', callback);
    };
    app._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports = { server, io, db, users, banUser, revokeUserSessions, messagesForRoom, ALLOWED_ORIGINS };', filename);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    http.Server.prototype.listen = listen;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const fixture = app.exports;
  if (!fixture.server.listening) await once(fixture.server, 'listening');
  fixture.url = 'http://127.0.0.1:' + fixture.server.address().port;
  fixture.ALLOWED_ORIGINS.push(fixture.url);
  fixture.close = async () => {
    for (const user of fixture.users) fixture.revokeUserSessions(user.id);
    await new Promise(resolve => fixture.io.close(resolve));
    fixture.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return fixture;
}

module.exports = { startFixture, password };
