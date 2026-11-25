'use strict';

// Real Chromium RTCPeerConnections with Chromium's synthetic microphone.
// Only the isolated fixture receives account registrations or writes history.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { chromium } = require(process.env.UNI_PLAYWRIGHT_MODULE || 'playwright');
const { startFixture, password } = require('../fixtures/uni-call-server.cjs');
const before = process.env.UNI_CALL_BEFORE_DIR;

const output = process.env.UNI_VISUAL_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'uni-call-browser-'));
fs.mkdirSync(output, { recursive: true });
const result = { browser: '', checks: [], errors: [], media: {}, observations: {}, screenshots: [] };

async function main() {
  const fixture = await startFixture({ web: true });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.UNI_BROWSER_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream']
    });
    result.browser = browser.version();
    const pages = [];
    async function open(account) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
      await context.grantPermissions(['microphone'], { origin: fixture.url });
      await context.addInitScript(() => {
        const real = window.RTCPeerConnection;
        window.__callTest = { peers: [], local: [], audioContexts: [], rttSamples: [], denied: false, devices: null, webglRequests: 0 };
        const contextFor = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...options) {
          if (String(type).includes('webgl')) __callTest.webglRequests++;
          return contextFor.call(this, type, ...options);
        };
        window.RTCPeerConnection = class extends real {
          constructor(configuration) {
            super(configuration);
            __callTest.peers.push(this);
          }
          async getStats(...args) {
            const stats = await super.getStats(...args);
            const transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
            const pair = transport && stats.get(transport.selectedCandidatePairId)
              || [...stats.values()].find(row => row.type === 'candidate-pair' && row.nominated && row.state === 'succeeded');
            if (Number.isFinite(pair?.currentRoundTripTime)) __callTest.rttSamples.push(pair.currentRoundTripTime * 1000);
            return stats;
          }
        };
        const Audio = window.AudioContext;
        if (Audio) window.AudioContext = class extends Audio {
          constructor() {
            super();
            __callTest.audioContexts.push(this);
          }
        };
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
        navigator.mediaDevices.enumerateDevices = async () => __callTest.devices || enumerate();
        navigator.mediaDevices.getUserMedia = async constraints => {
          if (__callTest.denied) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
          const stream = await getUserMedia(constraints);
          __callTest.local.push(...stream.getTracks());
          return stream;
        };
      });
      const page = await context.newPage();
      if (before) {
        const overrides = new Map([
          ['/', 'index.html'], ['/styles/uni-call.css', 'styles/uni-call.css'], ['/scripts/uni-call.js', 'scripts/uni-call.js']
        ]);
        await page.route(fixture.url + '/**', route => {
          const pathname = new URL(route.request().url()).pathname;
          const file = overrides.get(pathname);
          return file ? route.fulfill({ path: path.join(before, 'public', file) }) : route.fallback();
        });
      }
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => result.errors.push({ account, message: error.message }));
      await page.goto(fixture.url);
      await page.waitForFunction(() => socket.connected && document.getElementById('appLaunch').hidden);
      await page.evaluate(({ account, password }) => socket.emit('register', { account, username: account, password }), { account, password });
      await page.waitForFunction(() => !!state.userId);
      pages.push(page);
      return page;
    }

    const [a, b] = await Promise.all([open('call_demo_a'), open('call_demo_b')]);
    const [aId, bId] = await Promise.all([a, b].map(p => p.evaluate(() => state.userId)));
    const status = (p, phase) => p.waitForFunction(phase => document.getElementById('uniCall').dataset.phase === phase, phase);
    const click = (p, action) => p.locator('[data-call="' + action + '"]').click();
    const island = p => p.locator('#uniCall');
    const settle = p => p.waitForFunction(() => !document.getElementById('uniCall').getAnimations({ subtree: true }).some(a => a.playState === 'running'));
    const centered = async p => {
      const box = await island(p).boundingBox();
      const viewport = p.viewportSize();
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 1, JSON.stringify({ box, viewport }));
      assert.ok(box.y >= 0 && box.y < 100 && box.y + box.height <= viewport.height);
      return box;
    };
    const capture = async (p, name) => {
      await p.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
      result.screenshots.push(name + '.png');
    };
    const captureMotion = async (page, box) => {
      await page.locator('[data-call="toggle"]').evaluate(el => el.click());
      const animations = await page.evaluateHandle(() => {
        const el = document.getElementById('uniCall');
        el.getBoundingClientRect();
        const transitions = el.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition);
        for (const animation of transitions) animation.pause();
        return transitions;
      });
      const samples = [0, 95, 190, 285, 380];
      const clip = { x: Math.floor(box.x - 16), y: Math.max(0, Math.floor(box.y - 12)), width: Math.ceil(box.width + 32), height: Math.ceil(box.height + 32) };
      for (const ms of samples) {
        await animations.evaluate((list, time) => list.forEach(animation => { animation.currentTime = time; }), ms);
        await page.screenshot({ path: path.join(output, 'motion-' + ms + '.png'), clip });
      }
      await animations.evaluate(list => list.forEach(animation => animation.play()));
      await animations.dispose();
      await settle(page);
    };
    const check = async (name, fn) => {
      try { await fn(); result.checks.push({ name, pass: true }); }
      catch (error) { result.checks.push({ name, pass: false, error: error.message }); throw error; }
    };
    const getTracks = p => p.evaluate(() => __callTest.local.map(track => ({ state: track.readyState, enabled: track.enabled })));
    const getStats = p => p.evaluate(async () => {
      const pc = __callTest.peers.at(-1);
      const stats = await pc.getStats();
      const inbound = [...stats.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'audio');
      return {
        connection: pc.connectionState, received: inbound?.packetsReceived || 0,
        energy: inbound?.totalAudioEnergy || 0,
        codec: inbound && stats.get(inbound.codecId)?.mimeType,
        activeRemote: pc.getReceivers().some(r => r.track.kind === 'audio' && r.track.readyState === 'live'),
        playing: !!document.querySelector('[data-call="audio"]').srcObject && !document.querySelector('[data-call="audio"]').paused
      };
    });

    await check('Private chat entry and noninterrupting incoming state', async () => {
      await a.evaluate(id => socket.emit('open private chat', id), bId);
      await a.locator('#privateCallOpen').waitFor({ state: 'visible' });
      await b.evaluate(() => openForumPage());
      await b.waitForFunction(() => state.view === 'forum');
      await b.locator('.forum-page button:visible').first().focus().catch(() => {});
      const focus = await b.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      await a.locator('#privateCallOpen').click();
      await Promise.all([status(a, 'outgoing'), status(b, 'incoming')]);
      assert.equal(await b.evaluate(() => document.activeElement.id || document.activeElement.tagName), focus);
      assert.deepEqual(await getTracks(b), []);
      await settle(b);
      const box = await centered(b);
      assert.ok(box.height >= 44 && box.height <= 54, JSON.stringify(box));
      assert.equal(await island(b).getAttribute('data-expanded'), 'false');
      assert.equal(await b.getByRole('button', { name: '接听来电' }).textContent().then(text => text.trim()), '');
      assert.equal(await a.getByRole('button', { name: '取消呼叫' }).count(), 1);
      await capture(a, '01-outgoing');
      await capture(b, '02-incoming-compact');
    });

    await check('Same island morphs in place, responds to hover, and reverses rapid toggles', async () => {
      const compact = await centered(b);
      const identity = await b.locator('[data-call="toggle"]').elementHandle();
      const baseLayout = await b.locator('.forum-shell').boundingBox();
      await b.mouse.move(compact.x + compact.width / 2, compact.y + compact.height / 2);
      await b.waitForFunction(() => {
        const { a, f } = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.uni-call-surface')).transform);
        return a >= 1.02 && f < -1.5;
      });
      result.observations.hover = await b.locator('.uni-call-surface').evaluate(el => getComputedStyle(el).transform);
      await b.mouse.move(2, 2);
      await settle(b);
      const frames = await b.evaluate(() => new Promise(resolve => {
        const island = document.getElementById('uniCall');
        const toggle = island.querySelector('[data-call="toggle"]');
        const dimensions = [];
        const sample = () => {
          const rect = island.getBoundingClientRect();
          dimensions.push([rect.width, rect.height, rect.left + rect.width / 2, performance.now()]);
          if (dimensions.length >= 24) resolve(dimensions);
          else requestAnimationFrame(sample);
        };
        toggle.click();
        sample();
      }));
      await settle(b);
      const expanded = await centered(b);
      assert.ok(expanded.width > compact.width + 40 && expanded.height > compact.height + 20);
      assert.ok(frames.some(([width, height]) => width > compact.width + 4 && width < expanded.width - 4 && height > compact.height + 4));
      assert.ok(frames.every(([, , center]) => Math.abs(center - b.viewportSize().width / 2) < 1));
      assert.ok(await identity.evaluate(el => el === document.querySelector('[data-call="toggle"]')));
      const afterLayout = await b.locator('.forum-shell').boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(baseLayout[key] - afterLayout[key]) < 1);
      result.observations.shape = { compact: [compact.width, compact.height], expanded: [expanded.width, expanded.height], frames };
      await capture(b, '03-incoming-expanded');
      await click(b, 'toggle');
      await settle(b);
      await captureMotion(b, expanded);

      await b.locator('[data-call="toggle"]').focus();
      for (let i = 0; i < 3; i++) {
        await b.keyboard.press('Space');
        await b.waitForTimeout(45);
      }
      await settle(b);
      assert.equal(await island(b).getAttribute('data-expanded'), 'false');
      assert.equal(await b.locator('[data-call="details"]').evaluate(el => el.inert), true);
      assert.deepEqual(await getTracks(b), []);
      await b.keyboard.press('Enter');
      await settle(b);
      assert.equal(await island(b).getAttribute('data-expanded'), 'true');
    });

    await check('Rendered glass transmits the live layer beneath it without an island canvas', async () => {
      // A uniform test backdrop makes the photographic sample independent of
      // wallpaper gradients. It stays underneath the live DOM/popover.
      const clip = await b.evaluate(() => {
        const patch = document.createElement('div');
        patch.id = 'islandCalibration';
        patch.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
        document.documentElement.append(patch);
        const r = document.querySelector('.uni-call-surface').getBoundingClientRect();
        return { x: Math.round(r.left + r.width * .52), y: Math.round(r.top + 25), width: 1, height: 1 };
      });
      try {
        const pixels = [];
        for (const color of ['#152948', '#e0c4ab']) {
          await b.evaluate(color => { document.getElementById('islandCalibration').style.backgroundColor = color; }, color);
          const png = await b.screenshot({ clip });
          const rgb = await sharp(png).removeAlpha().raw().toBuffer();
          pixels.push([...rgb].slice(0, 3));
        }
        const channelDifference = pixels[1].map((value, i) => Math.abs(value - pixels[0][i]));
        assert.ok(channelDifference.some(value => value > (before ? 22 : 50)), JSON.stringify(pixels));
        const canvases = await island(b).locator('canvas').count();
        assert.equal(canvases, 0);
        result.observations.transmission = { pixels, channelDifference, canvases };
      } finally {
        await b.evaluate(() => { document.getElementById('islandCalibration').remove(); });
      }
    });

    await check('Actual bidirectional WebRTC audio, Opus and browser playback', async () => {
      await click(b, 'accept');
      await Promise.all([status(a, 'connected'), status(b, 'connected')]);
      // Poll resolved samples. Passing an async predicate to waitForFunction can
      // observe the promise itself before a Chromium RTP report has data.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        [result.media.a, result.media.b] = await Promise.all([a, b].map(getStats));
        if ([result.media.a, result.media.b].every(s => s.received >= 15 && s.energy > 0 && s.playing)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      for (const [name, p] of [['a', a], ['b', b]]) {
        const sample = result.media[name] = await getStats(p);
        assert.equal(sample.connection, 'connected');
        assert.equal(sample.codec.toLowerCase(), 'audio/opus');
        assert.ok(sample.received >= 15 && sample.energy > 0 && sample.activeRemote && sample.playing);
      }
      assert.equal(await island(a).getAttribute('data-expanded'), 'false');
      await capture(a, '04-connected-compact');
    });

    await check('Mute uses the track, and audio settings are secondary to the island', async () => {
      await click(a, 'mute');
      assert.equal((await getTracks(a)).at(-1).enabled, false);
      assert.equal(await a.getByRole('button', { name: '解除麦克风静音' }).getAttribute('aria-pressed'), 'true');
      assert.equal(await island(a).getAttribute('data-expanded'), 'false');
      await click(a, 'mute');
      assert.equal((await getTracks(a)).at(-1).enabled, true);
      assert.equal(await a.locator('[data-call="volume"]').isVisible(), false);
      await click(a, 'toggle');
      await settle(a);
      assert.equal(await a.locator('[data-call="volume"]').isVisible(), false);
      await click(a, 'settings');
      await settle(a);
      assert.equal(await a.locator('[data-call="volume"]').isVisible(), true);
      await capture(a, '06-audio-settings');
      await a.locator('[data-call="volume"]').evaluate(input => {
        input.value = '.35';
        input.dispatchEvent(new Event('input'));
      });
      assert.equal(await a.locator('[data-call="audio"]').evaluate(audio => audio.volume), .35);
      await a.locator('[data-call="volume"]').focus();
      await a.keyboard.press('Escape');
      assert.equal(await a.locator('[data-call="settings"]').evaluate(el => document.activeElement === el), true);
      assert.equal(await island(a).getAttribute('data-settings'), 'false');
      await a.keyboard.press('Escape');
      await settle(a);
      assert.equal(await island(a).getAttribute('data-expanded'), 'false');
    });

    if (!before) await check('Device buttons switch a real captured track, handle hotplug and keep settings accessible', async () => {
      await click(a, 'toggle');
      await settle(a);
      await click(a, 'settings');
      await settle(a);
      const mic = a.locator('[data-call-device="mic"]');
      const trigger = mic.locator('.uni-call-device-trigger');
      const actual = await a.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).map(item => ({
        kind: item.kind, deviceId: item.deviceId, label: item.label
      })));
      const activeDevice = await a.evaluate(() => __callTest.local.at(-1).getSettings().deviceId);
      const alternative = actual.find(row => row.kind === 'audioinput' && row.deviceId && row.deviceId !== activeDevice);
      assert.ok(alternative, JSON.stringify(actual.map(row => row.kind)));
      const longLabel = '蓝牙耳机 Bluetooth Studio Pro 左右声道 — USB / 低延迟（测试设备）'.repeat(3);
      const inventory = actual.map(row => row.deviceId === alternative.deviceId ? { ...row, label: longLabel } : row);
      const update = devices => a.evaluate(value => {
        __callTest.devices = value;
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      }, devices);
      await update(inventory);
      await trigger.focus();
      await a.keyboard.press('ArrowDown');
      await settle(a);
      const row = mic.getByRole('button', { name: longLabel, exact: true });
      await row.waitFor();
      assert.equal(await row.getAttribute('aria-pressed'), 'false');
      assert.ok(await row.locator('span').first().evaluate(label => label.scrollWidth > label.clientWidth));
      await capture(a, '11-device-options');
      await row.focus();
      await a.keyboard.press('Enter');
      await a.waitForFunction(label => document.getElementById('uniCallMicName').textContent === label, longLabel);
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
      assert.equal(await a.evaluate(() => __callTest.local[0].readyState), 'ended');
      const switched = await a.evaluate(() => {
        const sender = __callTest.peers[0].getSenders().find(s => s.track?.kind === 'audio');
        return sender.track === __callTest.local.at(-1) && sender.track.readyState === 'live';
      });
      assert.ok(switched);
      await trigger.press('ArrowDown');
      assert.equal(await row.getAttribute('aria-pressed'), 'true');
      await update(inventory.filter(item => item.deviceId !== alternative.deviceId));
      await row.waitFor({ state: 'detached' });
      assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
      assert.equal(await mic.locator('[aria-pressed="true"]').count(), 0);
      await a.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

      const output = a.locator('[data-call-device="output"]');
      const supportsOutput = await a.locator('[data-call="audio"]').evaluate(el => typeof el.setSinkId === 'function');
      let outputSwitched = false;
      if (supportsOutput) {
        const alternateOutput = actual.find(item => item.kind === 'audiooutput' && item.deviceId && item.deviceId !== 'default');
        if (alternateOutput) {
          await output.locator('.uni-call-device-trigger').click();
          await output.getByRole('button', { name: alternateOutput.label, exact: true }).click();
          await a.waitForFunction(id => document.querySelector('[data-call="audio"]').sinkId === id, alternateOutput.deviceId);
          outputSwitched = true;
        }
        await a.locator('[data-call="audio"]').evaluate(el => { el.setSinkId = undefined; });
        await update(inventory);
        await output.waitFor({ state: 'hidden' });
        await a.locator('[data-call="audio"]').evaluate(el => { delete el.setSinkId; });
      }
      const slider = a.getByRole('slider', { name: '通话音量' });
      await slider.press('ArrowRight');
      assert.equal(await slider.getAttribute('aria-valuetext'), '40%');
      assert.equal(await a.locator('[data-call="audio"]').evaluate(el => el.volume), .4);
      await update(null);
      await click(a, 'collapse');
      await settle(a);
      assert.equal(await a.evaluate(() => __callTest.peers.length), 1);
      result.observations.devices = { switched, longLabelTruncated: true, removedChoiceCleared: true, outputCapabilityChecked: supportsOutput, outputSwitched };
    });

    await check('Actual RTT is ranged and the clock and media survive expansion and navigation', async () => {
      await click(a, 'toggle');
      await settle(a);
      await a.waitForFunction(() => /RTT .+ ms/.test(document.querySelector('[data-call="network"]').textContent));
      const label = await a.locator('[data-call="network"]').textContent();
      const samples = await a.evaluate(() => __callTest.rttSamples);
      const bucket = label.match(/RTT (?:<(\d+)|(\d+)–(\d+))/);
      const low = bucket[1] ? 0 : Number(bucket[2]);
      const high = Number(bucket[1] || bucket[3]);
      assert.ok(samples.some(value => value >= Math.max(0, low - 4) && value < high + 4), JSON.stringify({ label, samples }));
      result.observations.network = { label, samples };
      await capture(a, '05-connected-expanded');
      await a.evaluate(() => setThemeMode('dark', false));
      await capture(a, '12-desktop-dark-expanded');
      await a.evaluate(() => setThemeMode('light', false));
      const before = await getStats(a);
      const elapsed = await a.locator('[data-call="time"]').textContent();
      await click(a, 'collapse');
      await a.evaluate(() => openForumPage());
      await a.waitForFunction(() => state.view === 'forum');
      await settle(a);
      await centered(a);
      assert.equal(await island(a).evaluate(el => el.getAnimations({ subtree: true }).length), 0);
      assert.equal(await island(a).getAttribute('data-expanded'), 'false');
      assert.equal(await a.evaluate(() => __callTest.peers.length), 1);
      assert.equal((await getStats(a)).connection, 'connected');
      await capture(a, '07-stationary-island-in-forum');
      result.observations.material = await island(a).evaluate(el => ({
        backdrop: getComputedStyle(el.querySelector('.uni-call-surface')).backdropFilter,
        canvases: el.querySelectorAll('canvas').length,
        requestedWebGLContexts: __callTest.webglRequests
      }));
      assert.equal(result.observations.material.canvases, 0);
      await click(a, 'toggle');
      await settle(a);
      assert.ok((await a.locator('[data-call="time"]').textContent()) >= elapsed);
      assert.ok((await getStats(a)).received > before.received);
    });

    await check('Socket transport close pauses media, re-login restarts ICE in place', async () => {
      const oldIce = await a.evaluate(() => __callTest.peers[0].localDescription.sdp.match(/^a=ice-ufrag:(.+)/m)[1]);
      await a.evaluate(() => socket.io.engine.close());
      await Promise.all([status(a, 'reconnecting'), status(b, 'reconnecting')]);
      assert.equal(await island(a).getAttribute('data-quality'), 'fair');
      assert.ok(await a.getByRole('button', { name: '挂断通话' }).isEnabled());
      assert.equal((await getTracks(a)).at(-1).enabled, false);
      await a.waitForFunction(() => socket.connected && !state.userId);
      await a.evaluate(password => socket.emit('login', { account: 'call_demo_a', password }), password);
      await Promise.all([status(a, 'connected'), status(b, 'connected')]);
      assert.equal(await a.evaluate(() => __callTest.peers.length), 1);
      const newIce = await a.evaluate(() => __callTest.peers[0].localDescription.sdp.match(/^a=ice-ufrag:(.+)/m)[1]);
      assert.notEqual(newIce, oldIce);
      assert.equal((await getTracks(a)).at(-1).enabled, true);
      assert.ok((await getStats(b)).playing);
    });

    await check('Hangup releases media and persists one record in private history', async () => {
      await click(b, 'hangup');
      await Promise.all([status(a, 'ended'), status(b, 'ended')]);
      for (const page of pages) {
        assert.ok(await island(page).isVisible(), 'Media must be closed while the end result is still visible');
        assert.ok((await getTracks(page)).every(track => track.state === 'ended'));
        assert.equal(await page.evaluate(() => __callTest.peers.at(-1).connectionState), 'closed');
        assert.equal(await page.locator('[data-call="audio"]').evaluate(audio => !!audio.srcObject), false);
        await page.waitForFunction(() => __callTest.audioContexts.length && __callTest.audioContexts.every(context => context.state === 'closed'));
      }
      const rows = fixture.db.prepare("SELECT * FROM messages WHERE type='call'").all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].content, 'completed');
      assert.equal(rows[0].user_id, aId);
      await a.evaluate(id => socket.emit('open private chat', id), bId);
      await a.locator('.uni-call-history').getByText(/已结束/).waitFor();
    });

    await check('Microphone denial is visible and never rings the other account', async () => {
      await a.evaluate(() => { __callTest.denied = true; });
      await a.locator('#privateCallOpen').click();
      await status(a, 'ended');
      assert.match(await a.locator('[data-call="status"]').textContent(), /麦克风权限未授予/);
      assert.notEqual(await b.locator('#uniCall').getAttribute('data-phase'), 'incoming');
      assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM messages WHERE type='call'").get().n, 1);
      await a.evaluate(() => { __callTest.denied = false; });
    });

    await check('Incoming and connected panels fit mobile and landscape viewports', async () => {
      await b.setViewportSize({ width: 390, height: 844 });
      await b.evaluate(() => setThemeMode('dark', false));
      await a.locator('#privateCallOpen').click();
      await status(b, 'incoming');
      await settle(b);
      await centered(b);
      await capture(b, '08-mobile-dark-incoming');
      if (!before) {
        const truncation = await b.locator('[data-call="name"]').evaluate(el => {
          const name = el.textContent;
          el.textContent = '超长昵称 · Sonoma 音频体验 / Bluetooth 通话练习'.repeat(5);
          const truncated = el.scrollWidth > el.clientWidth;
          el.textContent = name;
          return truncated;
        });
        assert.equal(truncation, true);
        assert.ok((await b.getByRole('button', { name: '接听来电' }).boundingBox()).width >= 44);
      }
      await click(b, 'accept');
      await Promise.all([status(a, 'connected'), status(b, 'connected')]);
      await click(b, 'toggle');
      await settle(b);
      await click(b, 'settings');
      await settle(b);
      for (const [width, height] of [[390, 844], [768, 844], [844, 390]]) {
        await b.setViewportSize({ width, height });
        await settle(b);
        const bounds = await centered(b);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        const dock = await b.locator('#engagementTools').boundingBox();
        assert.ok(bounds.y >= dock.y + dock.height - 1 || bounds.x + bounds.width <= dock.x + 1);
        const hangup = await b.locator('[data-call="hangup"]').boundingBox();
        assert.ok(hangup.y >= bounds.y && hangup.y + hangup.height <= bounds.y + bounds.height);
        await capture(b, '09-connected-dark-' + width);
      }
      await b.emulateMedia({ reducedMotion: 'reduce' });
      await b.evaluate(() => NapaPresentation.setTransparency('reduced'));
      await b.waitForFunction(() => {
        const island = document.getElementById('uniCall');
        return document.documentElement.dataset.transparency === 'reduced'
          && getComputedStyle(island.querySelector('.uni-call-surface')).backdropFilter === 'none'
          && getComputedStyle(island).animationName === 'none';
      });
      await click(b, 'toggle');
      assert.equal(await island(b).getAttribute('data-expanded'), 'false');
      assert.equal(await island(b).evaluate(el => el.getAnimations({ subtree: true }).length), 0);
      await capture(b, '10-reduced-transparency-motion');
      await click(a, 'hangup');
      await status(b, 'ended');
    });

    await check('Real reject and caller cancellation release pending media', async () => {
      for (const action of ['decline', 'hangup']) {
        await a.locator('#privateCallOpen').click();
        await status(b, 'incoming');
        await click(action === 'decline' ? b : a, action);
        await Promise.all([status(a, 'ended'), status(b, 'ended')]);
        assert.equal((await getTracks(a)).at(-1).state, 'ended');
      }
      const reasons = fixture.db.prepare("SELECT content FROM messages WHERE type='call'").all().map(r => r.content);
      assert.ok(reasons.includes('declined') && reasons.includes('canceled'));
    });

    await check('Crossed dials resolve to one answerable invitation', async () => {
      await b.evaluate(id => socket.emit('open private chat', id), aId);
      await b.locator('#privateCallOpen').waitFor({ state: 'visible' });
      await Promise.all([a, b].map(p => p.locator('#privateCallOpen').click()));
      const incoming = await Promise.race([
        status(a, 'incoming').then(() => a), status(b, 'incoming').then(() => b)
      ]);
      const outgoing = incoming === a ? b : a;
      await status(outgoing, 'outgoing');
      await click(incoming, 'accept');
      await Promise.all([status(a, 'connected'), status(b, 'connected')]);
      await click(incoming, 'hangup');
      await Promise.all([status(a, 'ended'), status(b, 'ended')]);
    });
    await check('No uncaught page script errors', async () => assert.deepEqual(result.errors, []));
  } finally {
    await browser?.close();
    await fixture.close();
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, checks: result.checks, media: result.media, errors: result.errors }));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
