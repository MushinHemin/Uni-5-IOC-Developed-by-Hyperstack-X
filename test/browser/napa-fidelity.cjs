/* Targeted presentation checks against the isolated preview; never starts server.js.
   Browser evidence and engineering budgets are not Apple certification. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UNI_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.NAPA_PREVIEW_URL || 'http://127.0.0.1:8864';
const out = path.resolve(process.env.UNI_VISUAL_OUTPUT || '/tmp/uni-napa-fidelity');
const filter = process.env.NAPA_CHECK_FILTER;
const result = { checks: [], errors: [], measurements: {}, limitations: [
  'Chromium with synthetic data; native Safari evidence is recorded separately.',
  'Viewport and timing checks do not measure real iPhone keyboards or GPU energy.'
] };
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.UNI_BROWSER_EXECUTABLE ? { executablePath: process.env.UNI_BROWSER_EXECUTABLE } : {}) });
  result.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(4500);
  page.on('pageerror', e => result.errors.push(e.message));
  const save = () => fs.writeFileSync(path.join(out, 'fidelity-validation' + (filter ? '-targeted' : '') + '.json'), JSON.stringify(result, null, 2));
  const check = async (name, fn) => {
    if (filter && !filter.split('|').some(part => name.includes(part))) return;
    try { await fn(); result.checks.push({ name, pass: true }); }
    catch (e) { result.checks.push({ name, pass: false, error: e.message }); }
    finally {
      // A failed preference/bounds check must not contaminate unrelated checks.
      await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
      await page.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
      await page.evaluate(() => {
        try { localStorage.removeItem('uni-transparency-mode'); if (typeof applyGlassIntensity === 'function') applyGlassIntensity(50, true); } catch {}
      }).catch(() => {});
    }
    save();
  };
  const go = async (query = 'scene=home') => {
    await page.mouse.move(1, 1);
    await page.goto(base + '/?capture=1&' + query);
    await page.waitForFunction(() => document.getElementById('appLaunch').hidden);
    await page.waitForTimeout(650);
  };
  const shot = name => page.screenshot({ path: path.join(out, name + '.png') });
  const homeBounds = () => page.locator('.home-card').evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return { id: el.id, x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const sameBounds = (a, b) => {
    assert.equal(a.length, b.length);
    a.forEach((r, i) => { assert.equal(r.id, b[i].id); for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(r[k] - b[i][k]) < 1.5, r.id + ' ' + k); });
  };
  const contrast = () => page.evaluate(() => {
    const linear = n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
    const lum = c => .2126 * linear(c[0]) + .7152 * linear(c[1]) + .0722 * linear(c[2]);
    return [...document.querySelectorAll('.home-card.crystal-ready')].flatMap(el => {
      const c = el.querySelector('.crystal-sample'), r = c.getBoundingClientRect();
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      return [...el.querySelectorAll('h3,p,.home-card-meta span')].map(t => {
        const range = document.createRange(); range.selectNodeContents(t); const b = range.getBoundingClientRect();
        const style = getComputedStyle(t);
        const ink = lum(style.color.match(/[\d.]+/g).slice(0, 3).map(Number)); let minimum = 100;
        // Composite actual local fills above the canvas; do not accidentally
        // certify canvas contrast when a CSS chip fill changes the final pixel.
        const fills = [];
        for (let node = t; node && node !== el; node = node.parentElement) {
          const css = getComputedStyle(node);
          if (css.backgroundImage !== 'none') throw Error('Contrast sampler needs screenshot validation for gradient text backdrops');
          const rgba = css.backgroundColor.match(/[\d.]+/g)?.map(Number);
          if (rgba && (rgba[3] ?? 1) > 0) fills.unshift(rgba);
        }
        for (let y = b.top; y < b.bottom; y += 3) for (let x = b.left; x < b.right; x += 3) {
          const px = Math.max(0, Math.min(c.width - 1, Math.round((x - r.x) / r.width * c.width)));
          const py = Math.max(0, Math.min(c.height - 1, Math.round((y - r.y) / r.height * c.height)));
          let rgb = Array.from(pixels.slice((py * c.width + px) * 4, (py * c.width + px) * 4 + 3));
          for (const rgba of fills) { const a = rgba[3] ?? 1; rgb = rgb.map((value, k) => rgba[k] * a + value * (1 - a)); }
          const l = lum(rgb);
          minimum = Math.min(minimum, (Math.max(l, ink) + .05) / (Math.min(l, ink) + .05));
        }
        return { card: el.id, tag: t.tagName, minimum: +minimum.toFixed(3) };
      });
    });
  });
  const focusableIds = () => page.locator('#notificationModal').evaluate(el => [...el.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
    .filter(n => n.getClientRects().length && !n.closest('[hidden]')).map((n, i) => { if (!n.id) n.id = 'fidelity-focus-' + i; return n.id; }));
  try {
    for (const theme of ['light', 'dark']) await check('Home geometry and reading contrast / ' + theme, async () => {
      await go('scene=home&theme=' + theme + '&stageb=1'); const before = await homeBounds(); await shot('before-home-' + theme);
      await go('scene=home&theme=' + theme); await page.waitForFunction(() => document.querySelectorAll('.crystal-ready').length === 3);
      sameBounds(before, await homeBounds());
      const values = await contrast(); assert.ok(values.length >= 12); assert.ok(values.every(v => v.minimum >= 4.5), JSON.stringify(values));
      result.measurements['contrast-' + theme] = values;
      result.measurements['renderer-' + theme] = await page.evaluate(() => NapaCrystal.status());
      await shot('after-home-' + theme);
      await page.locator('#notificationOpen').click();
      await page.waitForFunction(() => !document.getElementById('notificationModal').hidden);
      await page.waitForTimeout(270); await shot('after-notification-' + theme);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
    });

    await check('Real notification flow, filters and read-all events', async () => {
      await go();
      // Authentication already fetches notifications. Measure the click's
      // delta, rather than mistaking that initial fetch for a duplicate handler.
      const requestsBeforeOpen = await page.evaluate(() => __previewEvents.filter(n => n === 'get notifications').length);
      await page.locator('#notificationOpen').click();
      await page.waitForFunction(() => document.querySelectorAll('#notificationList .notification-item').length === 3);
      assert.equal(await page.evaluate(() => __previewEvents.filter(n => n === 'get notifications').length), requestsBeforeOpen + 1);
      await page.locator('[data-notification-filter="unread"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#notificationList .notification-item').length > 0 && document.querySelectorAll('#notificationList .notification-item').length < 3);
      await page.locator('#notificationReadAll').click();
      await page.waitForFunction(() => document.querySelectorAll('#notificationList .notification-item').length === 0);
      assert.equal(await page.evaluate(() => __previewEvents.filter(n => n === 'mark all notifications read').length), 1);
      await page.locator('[data-notification-filter="all"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#notificationList .notification-item').length === 3);
      assert.equal(await page.locator('#notificationList .notification-item.is-unread').count(), 0);
      result.measurements.notificationEvents = await page.evaluate(() => __previewEvents.filter(n => n.includes('notification')));
      await page.locator('#notificationClose').click(); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      for (let cycle = 0; cycle < 2; cycle++) {
        const before = await page.evaluate(() => __previewEvents.filter(n => n === 'get notifications').length);
        await page.locator('#notificationOpen').click();
        assert.equal(await page.evaluate(() => __previewEvents.filter(n => n === 'get notifications').length), before + 1);
        await page.locator('#notificationClose').click();
        await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      }
      // The fixture deliberately provides these targets. The assertions verify
      // actual existing routing and modal isolation, not transport persistence.
      for (const type of ['post', 'user']) {
        await go(); await page.locator('#notificationOpen').click();
        const target = await page.evaluate(type => {
          const index = state.notifications.findIndex(item => item.targetType === type);
          return { index, id: state.notifications[index]?.targetId };
        }, type);
        assert.ok(target.index >= 0, 'Synthetic notification fixture missing targetType=' + type);
        await page.locator('#notificationList .notification-item').nth(target.index).click();
        await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
        if (type === 'post') {
          await page.waitForFunction(() => document.body.classList.contains('view-forum'));
          assert.equal(await page.locator('#forumPage').evaluate(el => !!el.closest('[inert]')), false);
          assert.ok(await page.evaluate(() => __previewEvents.includes('get forum post')));
        } else {
          await page.waitForFunction(() => !document.getElementById('userProfileModal').hidden);
          assert.equal(await page.locator('#userProfileModal').evaluate(el => !!el.closest('[inert]')), false);
          await page.keyboard.press('Escape');
        }
      }
    });

    await check('Notification focus containment, Escape and source return', async () => {
      await go(); await page.locator('#notificationOpen').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('notificationModal').contains(document.activeElement));
      const ids = await focusableIds(); assert.ok(ids.length >= 4);
      await page.locator('#' + ids.at(-1)).focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), ids[0]);
      await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), ids.at(-1));
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
      assert.equal(await page.locator('#notificationOpen').getAttribute('aria-expanded'), 'false');
      await page.locator('#notificationOpen').click(); await page.waitForTimeout(270);
      await page.mouse.click(30, 400);
      await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
      // Navigation's resize observer must not release a background chat while
      // the notification dialog still owns focus. Exercise real view + resize.
      await go('scene=chat'); await page.locator('#notificationOpen').click();
      await page.waitForTimeout(270);
      assert.equal(await page.locator('.app').evaluate(el => el.inert), true);
      await page.setViewportSize({ width: 1366, height: 900 }); await page.waitForTimeout(100);
      assert.equal(await page.locator('.app').evaluate(el => el.inert), true);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.locator('.app').evaluate(el => el.inert), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
    });

    await check('Interrupted notification close cannot hide reopened panel', async () => {
      await go(); await page.locator('#notificationOpen').click();
      await page.evaluate(() => { NapaPresentation.closeNotifications({ restoreFocus: false }); NapaPresentation.openNotifications(document.getElementById('notificationOpen')); });
      await page.waitForTimeout(320);
      assert.equal(await page.locator('#notificationModal').getAttribute('hidden'), null);
      assert.ok(await page.evaluate(() => document.getElementById('notificationModal').contains(document.activeElement)));
      await page.locator('#notificationClose').click(); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
    });

    await check('Reduced transparency persists and stops WebGL without losing intensity', async () => {
      await go();
      await page.evaluate(() => { applyGlassIntensity(0, true); NapaPresentation.setTransparency('reduced'); });
      await page.waitForFunction(() => document.documentElement.dataset.transparency === 'reduced' && document.querySelectorAll('.crystal-ready').length === 0);
      const a = await page.evaluate(() => NapaCrystal.status().draws); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => NapaCrystal.status().draws), a);
      await shot('reduced-transparency-home');
      await page.reload(); await page.waitForFunction(() => document.getElementById('appLaunch').hidden);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.transparency), 'reduced');
      assert.equal(await page.evaluate(() => readGlassIntensity()), 0);
      await page.locator('.home-toolbar .settings-toggle-btn').click();
      await page.waitForFunction(() => !document.getElementById('settingsModal').hidden);
      assert.equal(await page.locator('#transparencyMode').inputValue(), 'reduced');
      await page.locator('#transparencyMode').selectOption('auto');
      await page.locator('#settingsClose').click(); await page.waitForFunction(() => document.getElementById('settingsModal').hidden);
      await page.waitForFunction(() => document.querySelectorAll('.crystal-ready').length === 3);
      assert.equal(await page.evaluate(() => readGlassIntensity()), 0);
      await page.evaluate(() => applyGlassIntensity(50, true));
    });

    await check('Reduced motion completes notification state without spatial animation', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); await go();
      await page.locator('#notificationOpen').click(); await page.waitForTimeout(50);
      const animations = await page.locator('#notificationModal').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').map(a => a.effect.getTiming().duration));
      assert.ok(animations.every(duration => Number(duration) <= 1), JSON.stringify(animations));
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await check('Enabling reduced motion during close still completes dismissal', async () => {
      await go(); await page.locator('#notificationOpen').click(); await page.waitForTimeout(270);
      await page.evaluate(() => NapaPresentation.closeNotifications());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.getElementById('notificationModal').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'notificationOpen');
      assert.equal(await page.locator('#notificationOpen').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#homePage').evaluate(el => !!el.closest('[inert]')), false);
    });

    await check('Real wallpaper displacement survives fidelity tuning', async () => {
      await go('scene=home&calibration=1'); await page.waitForFunction(() => document.querySelector('.crystal-ready'));
      await page.evaluate(() => {
        const c = document.querySelector('.crystal-sample'), el = c.parentElement;
        window.__fidelityOn = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        window.__fidelitySaved = ['--crystal-displacement', '--crystal-corner-displacement', '--crystal-dispersion'].map(k => [k, el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]);
        for (const [k] of __fidelitySaved) el.style.setProperty(k, '0');
        NapaCrystal.refresh();
      });
      await page.waitForFunction(() => { const c = NapaCrystal.status().cards[0]; return c && c.straightPeak === 0 && c.cornerPeak === 0 && c.redBluePeak === 0; });
      await shot('calibration-zero');
      const pixels = await page.evaluate(() => {
        const c = document.querySelector('.crystal-sample'), el = c.parentElement, ratio = c.width / el.clientWidth, r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
        const zero = c.getContext('2d').getImageData(0, 0, c.width, c.height); let rim = 0, n = 0, core = 0;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
          const qx = Math.abs((x + .5) / ratio - el.clientWidth / 2) - (el.clientWidth / 2 - r), qy = Math.abs((y + .5) / ratio - el.clientHeight / 2) - (el.clientHeight / 2 - r);
          const d = r - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0), i = (y * c.width + x) * 4;
          const delta = Math.max(...[0, 1, 2].map(k => Math.abs(zero.data[i + k] - __fidelityOn.data[i + k])));
          if (d > 3 && d < 22) { rim += delta; n++; } if (d > 42) core = Math.max(core, delta);
        }
        return { rimMean: rim / n, coreMax: core, samples: n };
      });
      assert.ok(pixels.rimMean > 8, JSON.stringify(pixels)); assert.equal(pixels.coreMax, 0); result.measurements.refraction = pixels;
      await page.evaluate(() => {
        const el = document.querySelector('.crystal-sample').parentElement;
        for (const [k, value, priority] of __fidelitySaved) { if (value) el.style.setProperty(k, value, priority); else el.style.removeProperty(k); }
        NapaCrystal.refresh();
      });
      await page.waitForFunction(() => NapaCrystal.status().cards[0]?.straightPeak > 0); await shot('calibration-refracted');
    });

    await check('Idle WebGL and overlay motion retain bounded rendering', async () => {
      await go(); const a = await page.evaluate(() => NapaCrystal.status());
      await page.waitForTimeout(250); const b = await page.evaluate(() => NapaCrystal.status());
      assert.equal(a.draws, b.draws); assert.ok(b.maxPixels <= 650000); assert.equal(b.canvases, 3);
      await page.locator('#notificationOpen').click(); await page.waitForTimeout(270);
      const c = await page.evaluate(() => NapaCrystal.status()); await page.waitForTimeout(200);
      const d = await page.evaluate(() => NapaCrystal.status()); assert.equal(c.draws, d.draws);
      result.measurements.idle = { before: a, after: b, overlay: d };
    });

    for (const width of [390, 768]) await check('Mobile geometry, dialog bounds and U19 / ' + width, async () => {
      await page.setViewportSize({ width, height: 844 });
      await go('scene=home&stageb=1'); const before = await homeBounds();
      await go(); sameBounds(before, await homeBounds());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await shot('home-' + width);
      await page.locator('#notificationOpen').click(); await page.waitForTimeout(270);
      const r = await page.locator('#notificationModal .confirm-card').boundingBox();
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= 845, JSON.stringify(r));
      await shot('notification-' + width);
      // A short viewport must scroll its list, not let a fixed minimum height
      // spill through the dialog. Portrait bounds alone do not prove this.
      await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(100);
      const short = await page.evaluate(() => {
        const list = document.getElementById('notificationList'), card = list.parentElement;
        const l = list.getBoundingClientRect(), c = card.getBoundingClientRect();
        return { listBottom: l.bottom, cardBottom: c.bottom, listHeight: l.height, viewport: innerHeight };
      });
      assert.ok(short.listHeight > 0 && short.listBottom <= short.cardBottom && short.cardBottom <= short.viewport, JSON.stringify(short));
      await page.locator('#notificationList').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const last = await page.locator('#notificationList .notification-item').last().boundingBox();
      assert.ok(last.y + last.height <= short.cardBottom + 1);
      await shot('notification-landscape-' + width);
      await page.setViewportSize({ width, height: 844 });
      await go('scene=chat');
      const composer = await page.locator('.composer').boundingBox(), nav = await page.locator('#mobileNav').boundingBox();
      assert.ok(composer && nav && composer.y + composer.height <= nav.y + 1);
      await page.setViewportSize({ width: 1440, height: 960 });
    });

    await check('Existing native home destinations remain usable', async () => {
      for (const [id, view] of [['homeChatOpen', 'lobby'], ['homeForumOpen', 'forum'], ['homeSettingsOpen', 'workspace']]) {
        await go(); await page.locator('#' + id).focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(v => document.body.classList.contains('view-' + v), view);
      }
    });

    await check('Before / after notification motion evidence', async () => {
      // Playwright video needs its bundled FFmpeg. Reuse it when present; never install.
      const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
      const hasVideo = process.env.NAPA_RECORD_VIDEO !== '0' && fs.existsSync(cache) && fs.readdirSync(cache).some(n => n.startsWith('ffmpeg-'));
      result.measurements.video = { available: hasVideo, files: [] };
      if (!hasVideo) result.limitations.push('Playwright FFmpeg unavailable: recorded motion keyframes instead of video.');
      for (const variant of ['before', 'after']) {
        let videoContext;
        try {
          videoContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, ...(hasVideo ? { recordVideo: { dir: out, size: { width: 1440, height: 960 } } } : {}) });
          const p = await videoContext.newPage(); p.setDefaultTimeout(4500); p.on('pageerror', e => result.errors.push(e.message));
          await p.goto(base + '/?scene=home&capture=1' + (variant === 'before' ? '&stageb=1' : ''));
          await p.waitForFunction(() => document.getElementById('appLaunch').hidden); await p.waitForTimeout(650);
          await p.screenshot({ path: path.join(out, variant + '-motion-closed.png') });
          await p.locator('#notificationOpen').click(); await p.waitForTimeout(80);
          await p.screenshot({ path: path.join(out, variant + '-motion-enter.png') });
          await p.waitForTimeout(220); await p.screenshot({ path: path.join(out, variant + '-motion-open.png') });
          await p.keyboard.press('Escape'); await p.waitForTimeout(60);
          await p.screenshot({ path: path.join(out, variant + '-motion-exit.png') });
          await p.waitForTimeout(220);
          const video = p.video(); await p.close(); await videoContext.close(); videoContext = null;
          if (video) { const file = path.join(out, variant + '-notification.webm'); await video.saveAs(file); result.measurements.video.files.push(file); }
        } finally { if (videoContext) await videoContext.close(); }
      }
    });
    await check('No page script errors', async () => assert.deepEqual(result.errors, []));
  } finally { save(); await browser.close(); }
  console.log(JSON.stringify({ passed: result.checks.filter(c => c.pass).length, failed: result.checks.filter(c => !c.pass), errors: result.errors }));
  if (result.checks.some(c => !c.pass) || result.errors.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
