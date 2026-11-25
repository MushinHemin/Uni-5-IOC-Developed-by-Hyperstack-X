'use strict';

// Development harness only. The fixture uses a fresh data directory and a Chromium synthetic microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { _electron: electron, chromium } = require(process.env.UNI_PLAYWRIGHT_MODULE || 'playwright');
const { startFixture, password } = require('../../../test/fixtures/uni-call-server.cjs');

const output = path.resolve(process.env.UNI_MAC_TEST_OUTPUT || 'dist/test-results');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-macos-test-'));
const inner = path.join(profile, 'qa-entry.cjs');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(inner, `const electron = require('electron');
electron.app.setName('Uni Desktop QA');
electron.app.setPath('userData', ${JSON.stringify(profile)});
globalThis.__desktopQA = { launches: [], notices: [], linkEvents: [], show: true, microphone: 'granted' };
electron.ipcMain.on('uni:external-link', event => __desktopQA.linkEvents.push({ focus: !!electron.BrowserWindow.getFocusedWindow(), frame: event.senderFrame === event.sender.mainFrame }));
electron.systemPreferences.getMediaAccessStatus = () => __desktopQA.microphone;
electron.shell.openExternal = async url => { __desktopQA.launches.push(url); };
const show = electron.Notification.prototype.show;
electron.Notification.prototype.show = function () {
  __desktopQA.notices.push({ title: this.title, body: this.body, notification: this });
  if (__desktopQA.show) show.call(this);
};
require(${JSON.stringify(path.resolve(__dirname, '../src/main.cjs'))});`);
const result = { checks: [], versions: null, media: null, performance: {}, pageErrors: [], observations: {} };

function observe(page) {
  page.on('pageerror', error => result.pageErrors.push(error.message));
}
async function check(name, run) {
  try {
    await run();
    result.checks.push({ name, pass: true });
  } catch (error) {
    result.checks.push({ name, pass: false, error: error.message });
    throw error;
  }
}
async function waitFor(app, prefix) {
  for (let i = 0; i < 90; i++) {
    const page = app.windows().find(value => value.url().startsWith(prefix));
    if (page) { await page.waitForLoadState('load'); return page; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Missing desktop page for ' + prefix);
}

async function metrics(app) {
  return app.evaluate(({ app }) => app.getAppMetrics());
}
async function snapshot(app) {
  await metrics(app);
  await new Promise(resolve => setTimeout(resolve, 1600));
  const list = await metrics(app);
  return {
    processes: list.length,
    summedWorkingSetMiB: Math.round(list.reduce((sum, { memory }) => sum + memory.workingSetSize, 0) / 1024),
    summedCpuPercent: Number(list.reduce((sum, { cpu }) => sum + cpu.percentCPUUsage, 0).toFixed(2))
  };
}

function instrument() {
  window.desktopMediaTest = { pcs: [], tracks: [] };
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(...args) { super(...args); window.desktopMediaTest.pcs.push(this); }
  };
  const audio = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await audio(constraints);
    window.desktopMediaTest.tracks.push(...stream.getTracks());
    return stream;
  };
}

async function mediaStats(page) {
  return page.evaluate(async () => {
    const peer = desktopMediaTest.pcs.at(-1);
    const stats = peer && await peer.getStats();
    const inbound = stats && [...stats.values()].find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
    return {
      connection: peer?.connectionState, packets: inbound?.packetsReceived || 0,
      codec: inbound && stats.get(inbound.codecId)?.mimeType,
      playing: !document.querySelector('[data-call="audio"]').paused,
      tracks: desktopMediaTest.tracks.map(track => ({ state: track.readyState, enabled: track.enabled }))
    };
  });
}

async function run() {
  const first = await startFixture({ web: true });
  const other = await startFixture({ web: true });
  let app, browser;
  try {
    const launch = async () => {
      const start = performance.now();
      app = await electron.launch({
        executablePath: process.env.UNI_ELECTRON_EXECUTABLE || require('electron'),
        args: [inner, '--use-fake-device-for-media-stream'],
        timeout: 20000
      });
      const local = await waitFor(app, 'uni-shell://');
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        window.focus();
      });
      result.performance.firstShellMs ??= Math.round(performance.now() - start);
      observe(local);
      return local;
    };

    let local = await launch();
    result.versions = await app.evaluate(({ app, screen }) => ({
      electron: process.versions.electron, chromium: process.versions.chrome,
      arch: process.arch, gpu: app.getGPUFeatureStatus(), scaleFactor: screen.getPrimaryDisplay().scaleFactor
    }));

    await check('First-launch Crystal Window, input validation and fixture connection', async () => {
      await local.locator('#address').fill('http://example.invalid:80');
      await local.locator('#connect').click();
      await local.getByRole('alert').getByText('请输入完整的 HTTPS 服务器地址。', { exact: false }).waitFor();
      await local.screenshot({ path: path.join(output, '01-connection.png') });
      await local.locator('#address').fill(first.url);
      await local.locator('#connect').click();
    });
    let a = await waitFor(app, first.url);
    observe(a);
    await a.waitForFunction(() => socket.connected && window.__uniDesktopReady && document.getElementById('appLaunch').hidden);
    await check('Trusted renderer is sandboxed and cannot access Node APIs', async () => {
      assert.deepEqual(await a.evaluate(() => [typeof window.require, typeof window.process, typeof window.uniDesktop]), ['undefined', 'undefined', 'object']);
      const settings = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL().startsWith(url)).getLastWebPreferences(), first.url);
      for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(settings[key], true);
      for (const key of ['nodeIntegration', 'allowRunningInsecureContent', 'webviewTag']) assert.equal(settings[key], false);
    });
    await check('Explicit sign-in preference, authenticated home and WebGL wallpaper rendering', async () => {
      await a.locator('#accountInput').fill('call_test_admin');
      await a.locator('#passwordInput').fill(password);
      await a.getByLabel('在此 Mac 上保持登录').check();
      await a.locator('#loginForm button[type="submit"]').click();
      await a.waitForFunction(() => state.userId && state.view === 'home' && NapaCrystal.status().renderPath === 'webgl1-to-2d');
      await a.screenshot({ path: path.join(output, '02-home.png') });
      const logins = path.join(profile, 'saved-logins');
      const files = fs.readdirSync(logins);
      assert.equal(files.length, 1);
      assert.equal(fs.readFileSync(path.join(logins, files[0])).includes(Buffer.from(password)), false);
    });
    result.performance.idle = await snapshot(app);

    await check('Saved sign-in survives a complete desktop restart', async () => {
      await app.close();
      local = await launch();
      a = await waitFor(app, first.url);
      observe(a);
      await a.waitForFunction(() => state.userId && state.view === 'home' && window.__uniDesktopReady);
    });
    const aID = await a.evaluate(() => state.userId);
    browser = await chromium.launch({
      executablePath: process.env.UNI_BROWSER_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream']
    });
    const context = await browser.newContext({ permissions: ['microphone'] });
    const b = await context.newPage();
    await b.goto(first.url);
    await b.waitForFunction(() => socket.connected && document.getElementById('appLaunch').hidden);
    await b.evaluate(password => socket.emit('register', { account: 'qa_desktop_peer', username: 'Napa QA', password }), password);
    await b.waitForFunction(() => Boolean(state.userId));
    const bID = await b.evaluate(() => state.userId);

    await check('Forum and real private-message notification with Dock badge and private click route', async () => {
      await a.locator('#homeForumOpen').click();
      await a.waitForFunction(() => state.view === 'forum' && state.forumPosts.length >= 0);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
      await b.evaluate(id => socket.emit('open private chat', id), aID);
      await b.waitForFunction(() => state.currentRoom?.type === 'private');
      await b.locator('#input').fill('Synthetic desktop receipt');
      await b.locator('#input').press('Enter');
      await a.waitForFunction(() => state.chatUnread > 0);
      const link = await app.evaluate(({ app }) => ({
        badge: app.dock.getBadge(), notices: __desktopQA.notices.map(({ title, body }) => ({ title, body }))
      }));
      assert.equal(link.badge, '1');
      assert.deepEqual(link.notices, [{ title: '新聊天消息', body: '打开 Uni 查看。' }]);
      await a.evaluate(() => { window.addEventListener('uni-desktop-notice', event => { window.qaNoticeTarget = event.detail.kind; }); });
      const clicked = await app.evaluate(() => __desktopQA.notices.find(({ title }) => title === '新聊天消息').notification.emit('click'));
      result.observations.notificationClickEmitted = clicked;
      await a.waitForFunction(() => window.qaNoticeTarget === 'chat', undefined, { timeout: 5000 });
      await a.waitForFunction(() => state.currentRoom?.type === 'private', undefined, { timeout: 6000 });
      await a.locator('#messages').getByText('Synthetic desktop receipt', { exact: true }).waitFor();
    });

    await check('Navigation, webcam and unsolicited microphone requests are denied', async () => {
      const deny = await a.evaluate(async () => {
        const tryMedia = async constraints => {
          try { (await navigator.mediaDevices.getUserMedia(constraints)).getTracks().forEach(t => t.stop()); return false; }
          catch (error) { return error.name === 'NotAllowedError'; }
        };
        return [await tryMedia({ audio: true }), await tryMedia({ video: true }), window.open('https://example.org/') === null];
      });
      assert.deepEqual(deny, [true, true, true]);
      await a.evaluate(() => {
        const anchor = document.createElement('a');
        anchor.href = 'https://example.org/manual';
        anchor.id = 'qa-external-link';
        anchor.textContent = 'External Link QA';
        anchor.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:white';
        document.body.append(anchor);
      });
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()[0].focus();
      });
      await a.locator('#qa-external-link').click();
      let opened;
      for (let attempt = 0; attempt < 20; attempt++) {
        const observation = await app.evaluate(() => ({ launches: __desktopQA.launches, events: __desktopQA.linkEvents }));
        opened = observation.launches;
        result.observations.externalLink = observation.events;
        if (opened.length) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.deepEqual(opened, ['https://example.org/manual']);
      assert.ok(a.url().startsWith(first.url));
      await a.locator('#qa-external-link').evaluate(a => a.remove());
    });

    await check('Chat images enlarge inside the sandboxed app instead of opening a popup', async () => {
      await a.evaluate(() => {
        const image = document.createElement('img');
        image.id = 'qa-image';
        image.className = 'chat-img';
        image.alt = 'Synthetic fixture';
        image.width = 48;
        image.height = 48;
        image.src = '/assets/icons/uni-icon.svg';
        document.getElementById('messages').append(image);
      });
      await a.locator('#qa-image').click();
      await a.getByRole('dialog', { name: '聊天图片预览' }).waitFor();
      await a.keyboard.press('Escape');
      await a.getByRole('dialog', { name: '聊天图片预览' }).waitFor({ state: 'detached' });
      await a.locator('#qa-image').evaluate(image => image.remove());
    });

    const phase = (p, name) => p.waitForFunction(name => document.getElementById('uniCall').dataset.phase === name, name);
    await a.evaluate(instrument);
    await b.evaluate(instrument);
    await check('Native permission denial leaves peer idle', async () => {
      await app.evaluate(() => { __desktopQA.microphone = 'denied'; });
      await a.locator('#privateCallOpen').click();
      await phase(a, 'ended');
      assert.equal(await b.locator('#uniCall').isVisible(), false);
      await app.evaluate(() => { __desktopQA.microphone = 'granted'; });
      await a.locator('#uniCall').waitFor({ state: 'hidden' });
    });

    await check('Real bidirectional Opus, Call Island, mute and media release', async () => {
      await a.locator('#privateCallOpen').click();
      await phase(b, 'incoming');
      await b.locator('[data-call="accept"]').click();
      await Promise.all([phase(a, 'connected'), phase(b, 'connected')]);
      await a.locator('[data-call="toggle"]').click();
      assert.equal(await a.locator('#uniCall').getAttribute('data-expanded'), 'true');
      await a.screenshot({ path: path.join(output, '03-call-island.png') });
      result.performance.call = await snapshot(app);
      result.media = { desktop: await mediaStats(a), peer: await mediaStats(b) };
      for (const stats of Object.values(result.media)) {
        assert.equal(stats.codec, 'audio/opus');
        assert.equal(stats.connection, 'connected');
        assert.ok(stats.packets > 5);
        assert.ok(stats.playing);
      }
      await a.locator('[data-call="mute"]').click();
      assert.equal((await mediaStats(a)).tracks.at(-1).enabled, false);
      await a.locator('[data-call="hangup"]').click();
      await Promise.all([phase(a, 'ended'), phase(b, 'ended')]);
      assert.ok((await mediaStats(a)).tracks.every(track => track.state === 'ended'));
      assert.ok((await mediaStats(b)).tracks.every(track => track.state === 'ended'));
    });

    await check('Transport drop reconnects using a fresh socket and no page replacement', async () => {
      const previous = await a.evaluate(() => socket.id);
      const endpoint = first.io.sockets.sockets.get(previous);
      endpoint.conn.close();
      await a.waitForFunction(old => socket.connected && socket.id !== old && state.userId, previous);
      assert.equal(await a.evaluate(() => state.userId), aID);
    });

    await check('A server switch isolates session and removes the old saved login', async () => {
      await local.locator('#settings').click();
      await local.locator('#address').fill(other.url);
      await local.locator('#connect').click();
      const fresh = await waitFor(app, other.url);
      await fresh.waitForFunction(() => socket.connected && window.__uniDesktopReady);
      assert.equal(await fresh.evaluate(() => state.userId), '');
      assert.equal(fs.readdirSync(path.join(profile, 'saved-logins')).length, 0);
    });

    assert.deepEqual(result.pageErrors, []);
  } finally {
    if (browser) await browser.close();
    if (app) await app.close().catch(() => {});
    await other.close();
    await first.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.writeFileSync(path.join(output, 'electron-results.json'), JSON.stringify(result, null, 2) + '\n');
  }
}
run().then(() => console.log(JSON.stringify(result)), error => {
  console.error(error);
  process.exitCode = 1;
});
