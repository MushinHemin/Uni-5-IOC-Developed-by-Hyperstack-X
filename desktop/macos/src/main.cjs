'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, Menu, Notification, screen,
  session, shell, safeStorage, systemPreferences, protocol
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  serverOrigin, isUniPage, externalURL, senderIs, allowsAudio,
  partitionName, validLogin, safeNotice
} = require('./policy.cjs');

const TITLE = 'Uni 5.6 Napa Valley';
const CHROME_HEIGHT = 36;
const shellURL = 'uni-shell://app/src/shell.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'uni-shell', privileges: { standard: true, secure: true } }]);
const shellFiles = {
  '/src/shell.html': 'text/html; charset=utf-8',
  '/src/shell.css': 'text/css; charset=utf-8',
  '/src/shell.js': 'text/javascript; charset=utf-8',
  '/build/uni-icon.svg': 'image/svg+xml'
};

function serveShell() {
  session.defaultSession.protocol.handle('uni-shell', request => {
    const url = new URL(request.url);
    const mime = shellFiles[url.pathname];
    if (request.method !== 'GET' || url.hostname !== 'app' || !mime || url.search) return new Response(null, { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, '..', url.pathname)), { headers: { 'Content-Type': mime } });
  });
}
const adapter = fs.readFileSync(path.join(__dirname, 'adapter.js'), 'utf8');
const adapterCSS = fs.readFileSync(path.join(__dirname, 'remote.css'), 'utf8');
const retryDelays = [1000, 3000, 8000];

let prefs, configFile, win, connection, retryTimer, boundsTimer;
let mode = 'setup', message = '输入你的 Uni 服务器地址。';
let quitAllowed = false;
let quitting = false;
let closing = false;
let returnMode = 'setup';
let notificationIds = new Set();
const activeNotifications = new Set();

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readPrefs() {
  let data;
  try { data = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { data = {}; }
  return {
    origin: serverOrigin(data?.origin), background: data?.background === true,
    notifications: data?.notifications !== false, previews: data?.previews === true,
    bounds: data?.bounds
  };
}

function savePrefs() {
  atomicWrite(configFile, JSON.stringify(prefs));
}

function loginFile(origin) {
  return path.join(path.dirname(configFile), 'saved-logins', partitionName(origin).slice(8) + '.encrypted');
}

function readLogin(origin) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const login = JSON.parse(safeStorage.decryptString(fs.readFileSync(loginFile(origin))));
    return validLogin(login) ? login : null;
  } catch { return null; }
}

function forgetLogin(origin) {
  if (origin) fs.rmSync(loginFile(origin), { force: true });
}

function prefsState() {
  return {
    origin: prefs.origin, background: prefs.background, notifications: prefs.notifications,
    previews: prefs.previews, mode, message, canReturn: mode === 'settings' && Boolean(connection?.ready)
  };
}

function setMode(next, text) {
  mode = next;
  message = text;
  if (!win || win.isDestroyed()) return;
  connection?.view.setVisible(next === 'app');
  win.webContents.send('shell:update', prefsState());
  if (next !== 'app' && win.isFocused()) win.webContents.focus();
}

function layout() {
  if (!connection || !win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  connection.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
}

function captureBounds() {
  clearTimeout(boundsTimer);
  if (!win || win.isDestroyed()) return;
  prefs.bounds = win.getNormalBounds();
  savePrefs();
}

function restoreBounds() {
  const b = prefs.bounds;
  if (!b || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(b[key]))) return { width: 1180, height: 800, center: true };
  const work = screen.getDisplayMatching(b).workArea;
  const width = Math.min(work.width, Math.max(640, b.width));
  const height = Math.min(work.height, Math.max(480, b.height));
  return {
    width, height,
    x: Math.min(Math.max(work.x, b.x), work.x + work.width - width),
    y: Math.min(Math.max(work.y, b.y), work.y + work.height - height)
  };
}

function windowSecurity(preload, extraPrefs = {}) {
  return {
    preload: path.join(__dirname, preload), nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    webviewTag: false, devTools: false, ...extraPrefs
  };
}

function navigationTarget(event, details) {
  return typeof details === 'string' ? details : details?.url ?? event.url;
}

function secureNavigation(contents, permits) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
  for (const name of ['will-navigate', 'will-redirect']) {
    contents.on(name, (event, details) => {
      if (!permits(navigationTarget(event, details))) event.preventDefault();
    });
  }
  contents.on('will-frame-navigate', (event, url, _inPlace, legacyMainFrame) => {
    if (!(event.isMainFrame ?? legacyMainFrame) || !permits(navigationTarget(event, url))) event.preventDefault();
  });
}

function denyPermissions(targetSession) {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_wc, _permission, reply) => reply(false));
  targetSession.setDisplayMediaRequestHandler((_details, reply) => reply({}));
}

function configureRemoteSession(target, origin) {
  const ses = target.view.webContents.session;
  const trustedAudio = (contents, details, requestingOrigin, mode) => {
    if (connection !== target || !isUniPage(contents?.getURL(), origin)) return false;
    return allowsAudio({ expected: target.view.webContents, contents, origin, details, requestingOrigin, mode });
  };
  const audioAction = () => Date.now() < target.microphoneUntil;
  const speakerAction = (contents, details, requestingOrigin) =>
    connection === target && contents === target.view.webContents && details.isMainFrame
    && isUniPage(contents.getURL(), origin) && isUniPage(details.requestingUrl || requestingOrigin, origin)
    && Date.now() < target.speakerUntil;
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (permission === 'speaker-selection') return speakerAction(contents, details, requestingOrigin);
    if (permission !== 'media' || !trustedAudio(contents, details, requestingOrigin, 'check')) return false;
    return audioAction() && ['granted', 'not-determined'].includes(systemPreferences.getMediaAccessStatus('microphone'));
  });
  ses.setPermissionRequestHandler((contents, permission, reply, details) => {
    if (permission === 'speaker-selection') return reply(speakerAction(contents, details, null));
    if (permission !== 'media' || !trustedAudio(contents, details, null, 'request') || !audioAction()) return reply(false);
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return reply(true);
    if (status !== 'not-determined') return reply(false);
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      reply(Boolean(granted && connection === target && !contents.isDestroyed() && isUniPage(contents.getURL(), origin)));
    }, () => reply(false));
  });
  ses.setDisplayMediaRequestHandler((_details, reply) => reply({}));
}

function clearNotices() {
  notificationIds.clear();
  for (const notice of [...activeNotifications]) notice.close();
  activeNotifications.clear();
}

function dispatch(target, name, detail = null) {
  const wc = target?.view.webContents;
  if (!target?.ready || wc.isDestroyed() || !isUniPage(wc.getURL(), target.origin)) return Promise.resolve();
  return wc.executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, {detail: ${JSON.stringify(detail)}}))`)
    .catch(() => {});
}

async function endCall(target) {
  if (!target?.ready) return;
  await Promise.race([dispatch(target, 'uni-desktop-end-call'), new Promise(resolve => setTimeout(resolve, 500))]);
  // The existing call controller stops capture before sending its end event.
  await new Promise(resolve => setTimeout(resolve, 110));
}

function removeRemote() {
  clearTimeout(retryTimer);
  const target = connection;
  connection = null;
  app.dock.setBadge('');
  clearNotices();
  if (!target) return;
  if (win && !win.isDestroyed()) win.contentView.removeChildView(target.view);
  const wc = target.view.webContents;
  if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
}

function failConnection(target, attempt) {
  if (connection !== target) return;
  target.ready = false;
  if (mode === 'settings') return;
  if (attempt < retryDelays.length) {
    const delay = retryDelays[attempt];
    setMode('connecting', `连接失败，${delay / 1000} 秒后重试（${attempt + 1}/${retryDelays.length}）。`);
    retryTimer = setTimeout(() => connect(attempt + 1), delay);
  } else {
    setMode('error', '请确认服务器正在运行、地址正确且 HTTPS 证书有效，然后重新连接。');
  }
}

async function connect(attempt = 0) {
  removeRemote();
  if (!prefs.origin) return setMode('setup', '输入你的 Uni 服务器地址。');
  const origin = prefs.origin;
  const ses = session.fromPartition(partitionName(origin));
  const view = new WebContentsView({
    webPreferences: windowSecurity('preload-uni.cjs', {
      session: ses, additionalArguments: ['--uni-origin=' + origin], backgroundThrottling: true
    })
  });
  const target = { origin, view, ready: false, microphoneUntil: 0, speakerUntil: 0 };
  const wc = view.webContents;
  connection = target;
  configureRemoteSession(target, origin);
  secureNavigation(wc, url => isUniPage(url, origin));
  wc.on('did-start-navigation', (_event, details, inPlace, mainFrame) => {
    if ((details?.isMainFrame ?? mainFrame) && !(details?.isSameDocument ?? inPlace)) {
      target.microphoneUntil = 0;
      target.speakerUntil = 0;
    }
  });
  wc.on('render-process-gone', () => {
    if (connection === target) {
      target.ready = false;
      setMode('error', '页面进程已关闭。选择重新连接恢复 Uni。');
    }
  });
  wc.on('did-finish-load', async () => {
    if (connection !== target || wc.isDestroyed() || !isUniPage(wc.getURL(), origin)) return;
    try {
      await wc.insertCSS(adapterCSS);
      const ok = await wc.executeJavaScript(`(${adapter.trim()})(window.uniDesktop, ${JSON.stringify(readLogin(origin))})`);
      if (connection !== target) return;
      if (!ok) return failConnection(target, attempt);
      target.ready = true;
      if (mode !== 'settings') setMode('app', '');
      if (win.isFocused() && mode === 'app') wc.focus();
    } catch { failConnection(target, attempt); }
  });
  win.contentView.addChildView(view);
  layout();
  setMode('connecting', '正在尝试连接到配置的 Uni 服务。');
  try { await wc.loadURL(origin + '/'); } catch {
    failConnection(target, attempt);
  }
}

function openSettings() {
  if (!win || win.isDestroyed()) createWindow();
  clearTimeout(retryTimer);
  if (mode !== 'settings') returnMode = mode;
  setMode('settings', '管理服务器连接及此 Mac 上的通知设置。');
  restoreWindow(false);
}

function showApp() {
  if (!connection?.ready) {
    if (returnMode === 'error') setMode('error', '请选择重新连接或修改服务器地址。');
    else connect();
    return;
  }
  setMode('app', '');
  connection.view.webContents.focus();
}

async function restart() {
  await endCall(connection);
  if (win && !win.isDestroyed()) connect();
}

function restoreWindow(focusContent = true) {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  win.focus();
  if (focusContent && mode === 'app' && connection?.ready) connection.view.webContents.focus();
}

function createWindow() {
  if (win && !win.isDestroyed()) return;
  denyPermissions(session.defaultSession);
  win = new BrowserWindow({
    ...restoreBounds(), minWidth: 640, minHeight: 480, show: false, title: 'Uni',
    backgroundColor: '#dbeafb', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: windowSecurity('preload-shell.cjs')
  });
  secureNavigation(win.webContents, url => url === shellURL);
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  for (const name of ['move', 'resize']) win.on(name, () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(captureBounds, 300);
  });
  win.on('close', async event => {
    if (quitAllowed || closing) return;
    event.preventDefault();
    captureBounds();
    if (prefs.background && !quitting) { win.hide(); return; }
    closing = true;
    await endCall(connection);
    removeRemote();
    if (win && !win.isDestroyed()) win.close();
  });
  win.on('closed', () => { removeRemote(); win = null; closing = false; });
  win.loadURL(shellURL).then(() => {
    if (mode === 'settings') setMode('settings', message);
    else connect();
  }).catch(() => {});
}

function notify(value, target) {
  if (!target.ready || !prefs.notifications || !Notification.isSupported()
    || (win.isVisible() && win.isFocused()) || notificationIds.has(value.kind + ':' + value.id)) return;
  if (notificationIds.size >= 512) notificationIds.delete(notificationIds.values().next().value);
  notificationIds.add(value.kind + ':' + value.id);
  const label = { chat: '新聊天消息', community: 'Uni 通知', call: '语音来电' }[value.kind];
  const notice = new Notification({
    title: prefs.previews && value.label ? value.label : label,
    body: prefs.previews && value.preview ? value.preview : '打开 Uni 查看。',
    silent: true
  });
  activeNotifications.add(notice);
  notice.once('close', () => activeNotifications.delete(notice));
  notice.once('failed', () => activeNotifications.delete(notice));
  notice.once('click', () => {
    activeNotifications.delete(notice);
    if (connection !== target) return;
    restoreWindow();
    if (mode === 'settings') showApp();
    dispatch(target, 'uni-desktop-notice', { kind: value.kind, target: value.target });
  });
  notice.show();
}

function registerIPC() {
  const local = event => senderIs(event, win?.webContents, url => url === shellURL);
  const remote = event => senderIs(event, connection?.view.webContents, url => isUniPage(url, connection.origin));
  ipcMain.handle('shell:state', event => local(event) ? prefsState() : null);
  ipcMain.handle('shell:open', event => { if (local(event)) openSettings(); });
  ipcMain.handle('shell:back', event => { if (local(event)) showApp(); });
  ipcMain.handle('shell:retry', event => { if (local(event)) return restart(); });
  ipcMain.handle('shell:forget', async event => {
    if (!local(event)) return false;
    forgetLogin(prefs.origin);
    await dispatch(connection, 'uni-desktop-forget');
    return true;
  });
  ipcMain.handle('shell:save', async (event, options) => {
    if (!local(event) || !options || !['settings', 'setup', 'error', 'connecting'].includes(mode)) return { ok: false };
    const origin = serverOrigin(options.address);
    if (!origin) return { ok: false, message: '请输入完整的 HTTPS 服务器地址。本机测试可使用带端口的 http://127.0.0.1。' };
    const changed = origin !== prefs.origin;
    if (changed) {
      await endCall(connection);
      if (!local(event)) return { ok: false };
      forgetLogin(prefs.origin);
      removeRemote();
    }
    prefs = { ...prefs, origin, background: options.background === true,
      notifications: options.notifications === true, previews: options.previews === true };
    savePrefs();
    if (!prefs.notifications || changed) clearNotices();
    showApp();
    return { ok: true };
  });
  ipcMain.handle('uni:remember', (event, login) => {
    if (!remote(event) || !validLogin(login) || !safeStorage.isEncryptionAvailable()) return false;
    atomicWrite(loginFile(connection.origin), safeStorage.encryptString(JSON.stringify({ account: login.account, password: login.password })));
    return true;
  });
  ipcMain.handle('uni:forget', event => {
    if (!remote(event)) return false;
    forgetLogin(connection.origin);
    clearNotices();
    return true;
  });
  ipcMain.on('uni:badge', (event, count) => {
    if (!remote(event) || !Number.isInteger(count) || count < 0) return;
    app.dock.setBadge(count > 99 ? '99+' : count ? String(count) : '');
  });
  ipcMain.on('uni:notice', (event, payload) => {
    if (!remote(event)) return;
    const notice = safeNotice(payload);
    if (notice) notify(notice, connection);
  });
  ipcMain.on('uni:external-link', (event, value) => {
    if (!remote(event) || mode !== 'app' || !win.isVisible()) return;
    const url = externalURL(value);
    if (url) shell.openExternal(url).catch(() => {});
  });
  ipcMain.on('uni:audio-action', (event, kind) => {
    if (!remote(event) || mode !== 'app' || !win.isVisible()) return;
    if (kind === 'microphone') connection.microphoneUntil = Date.now() + 10000;
    if (kind === 'speaker') connection.speakerUntil = Date.now() + 10000;
  });
}

function installMenu() {
  app.setAboutPanelOptions({ applicationName: 'Uni', applicationVersion: '5.6.0', version: '50602',
    credits: TITLE + '\nDesigned and developed by Hyperstack X.' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Uni', submenu: [
      { label: '关于 Uni', role: 'about' }, { type: 'separator' },
      { label: '设置…', accelerator: 'Command+,', click: openSettings },
      { label: '服务器连接设置…', click: openSettings },
      { label: '麦克风隐私设置…', click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone').catch(() => {}) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { label: '退出 Uni', role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: '显示', submenu: [
      { label: '重新加载 Uni', accelerator: 'Command+R', click: () => { if (win) restart(); } },
      { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' }
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (app.isReady()) restoreWindow(); });
  app.on('activate', () => { if (app.isReady()) restoreWindow(); });
  app.on('before-quit', event => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    captureBounds();
    endCall(connection).finally(() => {
      removeRemote();
      quitAllowed = true;
      app.quit();
    });
  });
  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'), 'connection.json');
    prefs = readPrefs();
    serveShell();
    registerIPC();
    installMenu();
    createWindow();
  });
}
