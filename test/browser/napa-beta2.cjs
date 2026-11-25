/* Beta 2 material-only verification. Existing Playwright and browser required.
   The preview uses an isolated browser context, synthetic transport and static assets only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UNI_PLAYWRIGHT_MODULE || 'playwright');

const beforeDir = path.resolve(process.env.NAPA_BEFORE_DIR ||
  '/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2/before');
process.env.NAPA_BEFORE_DIR = beforeDir;
const { server } = require('../../scripts/preview-napa.cjs');
const out = path.resolve(process.env.UNI_VISUAL_OUTPUT || '/tmp/uni-napa-beta2');
const report = path.join(out, 'beta2-validation.json');
const resume = process.env.UNI_VISUAL_RESUME === '1';
const result = {
  scope: 'Beta 2 versus saved Beta 1; synthetic Chromium only, not Safari, real soft-keyboard or hardware performance certification',
  beforeDir,
  checks: [], screenshots: [], errors: [], measurements: {},
  resume: { enabled: resume, carriedPassedChecks: [], executedChecks: [] }
};

(async () => {
  let browser;
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const rel of ['public/index.html', 'public/scripts/napa-optics.js',
      'public/styles/napa-optics.css', 'public/styles/napa-transparency.css']) {
      assert.ok(fs.existsSync(path.join(beforeDir, rel)), `Missing Beta 1 snapshot: ${rel}`);
    }
    if (resume) {
      const previous = JSON.parse(fs.readFileSync(report, 'utf8'));
      assert.equal(previous.beforeDir, beforeDir, 'Resume must use the same Beta 1 snapshot');
      result.checks = previous.checks.filter(check => check.pass);
      result.screenshots = [...new Set(previous.screenshots || [])];
      result.measurements = previous.measurements || {};
      result.resume.carriedPassedChecks = result.checks.map(check => check.name);
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({
      ...(process.env.UNI_BROWSER_EXECUTABLE ? { executablePath: process.env.UNI_BROWSER_EXECUTABLE } : {}),
      headless: true
    });
    result.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => result.errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;

    async function settled() {
      await page.waitForFunction(() => document.getElementById('appLaunch').hidden);
      await page.waitForTimeout(700);
    }
    async function go(scene, before = false, theme = 'light', width = 1440) {
      await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference', forcedColors: 'none' });
      await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
      await page.mouse.move(2, 2);
      await page.goto(base + '/?capture=1&scene=' + scene + '&stageb=' + (before ? '1' : '0') + '&theme=' + theme);
      await settled();
    }
    async function check(name, fn) {
      if (resume && result.checks.some(check => check.name === name && check.pass)) return;
      result.resume.executedChecks.push(name);
      try {
        await fn();
        assert.deepEqual(result.errors, [], 'No browser page errors in executed checks');
        result.checks.push({ name, pass: true });
      } catch (error) {
        result.checks.push({ name, pass: false, error: error.message });
        throw error;
      } finally {
        fs.writeFileSync(report, JSON.stringify(result, null, 2));
      }
    }
    async function shot(name, selector) {
      const target = selector ? page.locator(selector) : page;
      await target.screenshot({ path: path.join(out, name + '.png') });
      if (!result.screenshots.includes(name + '.png')) result.screenshots.push(name + '.png');
    }
    function equalBounds(actual, expected, label, tolerance = 1) {
      assert.ok(actual && expected, `${label} must be visible in both versions`);
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance,
          `${label} ${key}: Beta 2 ${actual[key]} != Beta 1 ${expected[key]}`);
      }
    }

    // Each check owns its scene and setup: resume skips only passed checks, never a failed layout capture.
    for (const scene of ['home', 'chat', 'login']) {
      for (const theme of ['light', 'dark']) {
        await check(`Unchanged ${scene}/${theme} layout bounds`, async () => {
          const selector = scene === 'home' ? '.home-shell' : scene === 'chat' ? '.shell' : '.login-panel';
          const suffix = scene + (theme === 'dark' ? '-dark' : '');
          await go(scene, true, theme);
          await shot('before-' + suffix);
          const before = await page.locator(selector).boundingBox();
          assert.equal(await page.locator('script[src^="/__stage-b/"]').count(), 1,
            'Before route must actually load the saved Beta 1 optics script');
          await go(scene, false, theme);
          await shot('after-' + suffix);
          const after = await page.locator(selector).boundingBox();
          equalBounds(after, before, `${scene}/${theme}`, 2);
          result.measurements.layout ||= {};
          result.measurements.layout[`${scene}/${theme}`] = { before, after };
        });
      }
    }

    for (const width of [1440, 390]) {
      for (const theme of ['light', 'dark']) {
        await check(`Toolbar labels and every button geometry match Beta 1 ${width}px/${theme}`, async () => {
          const capture = () => page.locator('.home-toolbar').evaluate(toolbar => ({
            buttons: [...toolbar.querySelectorAll(':scope > button')].map((button, index) => {
              const rect = button.getBoundingClientRect();
              return {
                index, id: button.id, label: button.getAttribute('aria-label'),
                hidden: button.hidden, display: getComputedStyle(button).display,
                bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
              };
            }),
            settings: (() => {
              const button = toolbar.querySelector('.settings-toggle-btn');
              const pseudo = getComputedStyle(button, '::after');
              return {
                content: pseudo.content, width: pseudo.width, display: pseudo.display,
                position: pseudo.position, padding: pseudo.padding, title: button.title,
                compact: button.hasAttribute('data-napa-compact')
              };
            })()
          }));
          await go('home', true, theme, width);
          const before = await capture();
          await shot(`before-toolbar-${width}-${theme}`, '.home-toolbar');
          await go('home', false, theme, width);
          const after = await capture();
          await shot(`after-toolbar-${width}-${theme}`, '.home-toolbar');
          result.measurements.toolbar ||= {};
          result.measurements.toolbar[`${width}/${theme}`] = { before, after };
          assert.equal(after.buttons.length, before.buttons.length);
          for (let index = 0; index < before.buttons.length; index++) {
            const a = after.buttons[index], b = before.buttons[index];
            for (const key of ['id', 'label', 'hidden', 'display']) assert.equal(a[key], b[key]);
            equalBounds(a.bounds, b.bounds, `toolbar button ${index} (${a.label})`);
          }
          for (const key of ['content', 'width', 'display', 'position', 'padding', 'title']) {
            assert.equal(after.settings[key], before.settings[key], `settings ::after ${key}`);
          }
          assert.equal(after.settings.compact, false, 'The settings label pseudo-element must retain ownership');
          if (width === 1440) assert.ok(after.settings.content.includes(after.settings.title));
        });
      }
    }

    await check('Original wallpaper, unfiltered wallpaper and no white viewport wash', async () => {
      await go('home');
      const values = await page.evaluate(() => ({
        image: getComputedStyle(document.body, '::before').backgroundImage,
        filter: getComputedStyle(document.body, '::before').filter,
        overlay: getComputedStyle(document.body, '::after').backgroundImage
      }));
      assert.ok(values.image.includes('sonoma.jpg'));
      assert.equal(values.filter, 'none');
      assert.ok(!values.overlay.includes('255, 255, 255'));
      result.measurements.wallpaper = values;
    });

    await check('Structural, content and control materials have distinct diffusion budgets', async () => {
      await go('chat');
      const materials = await page.evaluate(() => Object.fromEntries([
        ['structural', '.shell'], ['content', '.home-card'], ['control', '.composer']
      ].map(([role, selector]) => {
        const el = document.querySelector(selector), style = getComputedStyle(el);
        return [role, {
          role: el.dataset.napaMaterial,
          weight: Number(style.getPropertyValue('--napa-core-weight')),
          feather: style.getPropertyValue('--napa-feather').trim(),
          blur: getComputedStyle(el.querySelector(':scope > .napa-material-core')).backdropFilter,
          parentBlur: style.backdropFilter
        }];
      })));
      for (const [role, material] of Object.entries(materials)) {
        assert.equal(material.role, role);
        assert.equal(material.parentBlur, 'none');
        assert.ok(material.blur.startsWith('blur('));
      }
      const blur = role => parseFloat(materials[role].blur.slice(5));
      assert.ok(blur('structural') < blur('control'));
      assert.ok(blur('control') < blur('content'));
      assert.ok(materials.structural.weight < materials.content.weight);
      assert.notEqual(materials.content.weight, materials.control.weight);
      assert.equal(new Set(Object.values(materials).map(material => material.feather)).size, 3);
      result.measurements.materialRoles = materials;
    });

    await check('Clear edge and frosted core are separate, masked and inert; text opacity remains one', async () => {
      await go('home');
      const values = await page.locator('.home-card').first().evaluate(el => {
        const core = el.querySelector(':scope > .napa-material-core');
        const style = getComputedStyle(el), inner = getComputedStyle(core);
        return {
          background: style.backgroundColor, opacity: style.opacity, core: inner.backgroundImage,
          mask: inner.maskImage, blur: inner.backdropFilter, radius: style.borderRadius,
          pointer: inner.pointerEvents, hidden: core.getAttribute('aria-hidden'),
          fontOpacity: getComputedStyle(el.querySelector('h3')).opacity, parentBlur: style.backdropFilter
        };
      });
      assert.equal(values.opacity, '1');
      assert.equal(values.fontOpacity, '1');
      assert.equal(values.pointer, 'none');
      assert.equal(values.hidden, 'true');
      assert.ok(values.mask.includes('gradient'));
      assert.ok(values.blur.includes('blur'));
      assert.equal(values.parentBlur, 'none');
      assert.ok(parseFloat(values.radius) >= 34);
      result.measurements.card = values;
    });

    await check('Compact controls borrow diffusion without per-button filters or duplicate core layers', async () => {
      await go('chat');
      const values = await page.evaluate(() => [...document.querySelectorAll('.napa-glass')].map(el => ({
        id: el.id, classes: el.className, compact: el.hasAttribute('data-napa-compact'),
        coreCount: el.querySelectorAll(':scope > .napa-material-core').length,
        transitionCount: el.querySelectorAll(':scope > .napa-material-transition').length,
        filters: [getComputedStyle(el).backdropFilter, getComputedStyle(el, '::before').backdropFilter,
          getComputedStyle(el, '::after').backdropFilter],
        inertLayers: [...el.querySelectorAll(':scope > .napa-material-core,:scope > .napa-material-transition')]
          .every(layer => layer.getAttribute('aria-hidden') === 'true' && getComputedStyle(layer).pointerEvents === 'none')
      })));
      assert.ok(values.some(el => el.compact), 'Expected actual compact controls');
      for (const el of values) {
        assert.equal(el.coreCount, el.compact ? 0 : 1, `${el.id || el.classes} core count`);
        assert.equal(el.transitionCount, el.compact ? 0 : 1, `${el.id || el.classes} transition count`);
        assert.equal(el.inertLayers, true);
        if (el.compact) assert.deepEqual(el.filters, ['none', 'none', 'none'], `${el.id || el.classes} filter budget`);
      }
      result.measurements.materialLayerCounts = {
        surfaces: values.length, compactControls: values.filter(el => el.compact).length,
        coreLayers: values.reduce((sum, el) => sum + el.coreCount, 0)
      };
    });

    await check('Actual backdrop diffusion survives the page compositing context', async () => {
      await go('home');
      const stripe = await page.addStyleTag({
        content: 'body::before{background:repeating-linear-gradient(90deg,#405d7b 0 12px,#b7c9db 12px 24px)!important}'
      });
      const card = page.locator('.home-card').first();
      let none;
      try {
        async function energy() {
          const data = (await card.screenshot()).toString('base64');
          return page.evaluate(async data => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + data;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const y = Math.floor(image.height * .42), x = Math.floor(image.width * .36);
            const n = Math.floor(image.width * .28), pixels = ctx.getImageData(x, y, n, 1).data;
            let sum = 0;
            for (let i = 4; i < pixels.length; i += 4) sum += Math.abs(pixels[i + 1] - pixels[i - 3]);
            return sum / (n - 1);
          }, data);
        }
        const blurred = await energy();
        await shot('calibration-frosted-core');
        none = await page.addStyleTag({
          content: '.napa-material-core,.napa-material-transition{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}'
        });
        const unblurred = await energy();
        await shot('calibration-unblurred-core');
        result.measurements.diffusion = { blurred, unblurred, ratio: blurred / unblurred };
        assert.ok(unblurred > .1, 'Calibration pattern must produce measurable unblurred contrast');
        assert.ok(blurred < unblurred * .65, 'The rendered core must soften the pattern, not only advertise CSS blur');
      } finally {
        if (none) await none.evaluate(el => el.remove());
        await stripe.evaluate(el => el.remove());
      }
    });

    await check('Inactive rear chat is not an extra wash; login retains spatial transform and Tab isolation', async () => {
      await go('home');
      assert.equal(await page.locator('.app').evaluate(el => getComputedStyle(el).visibility), 'hidden');
      await go('login');
      assert.equal(await page.locator('.app').evaluate(el => el.inert), true);
      assert.notEqual(await page.locator('.app').evaluate(el => getComputedStyle(el).transform), 'none');
      await page.locator('#accountInput').focus();
      for (let index = 0; index < 14; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.app'))), false);
      }
    });

    await check('Home cards retain real keyboard navigation listeners', async () => {
      await go('home');
      await page.locator('#homeChatOpen').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => state.view === 'lobby');
      assert.equal(await page.evaluate(() => state.view), 'lobby');
    });

    await check('0/50/100 glass control changes opacity and blur without resetting preference', async () => {
      await go('chat');
      const values = await page.evaluate(() => {
        const initial = readGlassIntensity();
        const sample = value => {
          applyGlassIntensity(value, false);
          return {
            alpha: getComputedStyle(document.documentElement).getPropertyValue('--napa-core-alpha'),
            blur: getComputedStyle(document.querySelector('.composer > .napa-material-core')).backdropFilter
          };
        };
        const zero = sample(0), half = sample(50), full = sample(100);
        sample(initial);
        return { initial, zero, half, full, stored: localStorage.getItem(GLASS_KEY) };
      });
      assert.equal(values.initial, 50);
      assert.ok(+values.zero.alpha < +values.half.alpha && +values.half.alpha < +values.full.alpha);
      assert.notEqual(values.zero.blur, values.full.blur);
      assert.equal(values.stored, null, 'Non-persisting material sampling must not change user preference');
      result.measurements.intensity = values;
    });

    await check('Saved 0 intensity survives reload, theme changes and reopening settings', async () => {
      await go('home');
      try {
        await page.locator('.home-toolbar .settings-toggle-btn').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !settingsModal.hidden);
        await page.locator('#glassRange').focus();
        await page.keyboard.press('Home');
        assert.equal(await page.locator('#glassRange').inputValue(), '0');
        assert.equal(await page.evaluate(() => localStorage.getItem(GLASS_KEY)), '0');
        await page.reload();
        await settled();
        assert.equal(await page.evaluate(() => readGlassIntensity()), 0);
        await page.evaluate(() => setThemeMode('dark', false));
        await page.locator('.home-toolbar .settings-toggle-btn').click();
        await page.waitForFunction(() => !settingsModal.hidden);
        assert.equal(await page.locator('#glassRange').inputValue(), '0');
        assert.equal(await page.evaluate(() => readGlassIntensity()), 0);
        assert.equal(await page.evaluate(() => localStorage.getItem(GLASS_KEY)), '0');
        result.measurements.savedZero = await page.evaluate(() => ({
          stored: localStorage.getItem(GLASS_KEY), read: readGlassIntensity(), slider: glassRange.value,
          alpha: getComputedStyle(document.documentElement).getPropertyValue('--napa-core-alpha'),
          theme: document.documentElement.dataset.theme
        }));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => settingsModal.hidden);
      } finally {
        await page.evaluate(() => { localStorage.removeItem(GLASS_KEY); applyGlassIntensity(50, false); });
      }
    });

    await check('Edge light follows smoothly, returns to ambient and stops', async () => {
      await go('chat');
      const rect = await page.locator('#composer').boundingBox();
      await page.mouse.move(rect.x + 24, rect.y + 5);
      await page.waitForTimeout(850);
      await shot('highlight-left', '#composer');
      const left = await page.locator('#composer').getAttribute('style');
      await page.mouse.move(rect.x + rect.width - 24, rect.y + 5);
      await page.waitForTimeout(60);
      const moving = await page.locator('#composer').getAttribute('style');
      await page.waitForTimeout(850);
      await shot('highlight-right', '#composer');
      const right = await page.locator('#composer').getAttribute('style');
      assert.notEqual(left, right); assert.notEqual(moving, right);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(60);
      assert.ok((await page.locator('#composer').getAttribute('style')).includes('--napa-light-x'));
      await page.waitForTimeout(900);
      assert.equal(await page.locator('#composer').evaluate(el => el.style.getPropertyValue('--napa-light-x')), '');
      assert.equal(await page.locator('[style*="--napa-light-x"]').count(), 0);
      await shot('highlight-rest', '#composer');
    });

    await check('Highlight follows the rounded corner and stays within a 4px masked rim', async () => {
      await go('chat');
      const rect = await page.locator('#composer').boundingBox();
      const radius = await page.locator('#composer').evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      const corner = radius * (1 - Math.SQRT1_2) + 2;
      await page.mouse.move(rect.x + corner, rect.y + corner);
      await page.waitForTimeout(900);
      const values = await page.locator('#composer').evaluate(el => ({
        x: parseFloat(el.style.getPropertyValue('--napa-light-x')),
        y: parseFloat(el.style.getPropertyValue('--napa-light-y')),
        mask: getComputedStyle(el, '::after').maskComposite,
        band: getComputedStyle(el, '::after').paddingTop
      }));
      assert.ok(values.x > 0 && values.y > 0);
      assert.ok(Math.abs(Math.hypot(values.x - radius, values.y - radius) - radius) < 1);
      assert.ok(values.mask.split(',').every(value => value.trim() === 'exclude'));
      assert.equal(values.band, '4px');
      result.measurements.curvedLight = { ...values, radius };
      await shot('highlight-corner', '#composer');
    });

    await check('Send-button press narrows its highlight then releases without moving the window', async () => {
      await go('chat');
      await page.locator('#input').fill('合成按压反馈');
      const before = await page.locator('.shell').boundingBox();
      await page.locator('.send-btn').hover();
      await page.mouse.down();
      try {
        assert.equal(await page.locator('.send-btn').evaluate(el => el.classList.contains('napa-pressed')), true);
        assert.equal(await page.locator('#composer').evaluate(el => el.classList.contains('napa-pressed')), false);
        assert.ok(await page.locator('.send-btn').evaluate(el =>
          Number(getComputedStyle(el).getPropertyValue('--napa-light-compression')) < 1));
        equalBounds(await page.locator('.shell').boundingBox(), before, 'pressed shell');
      } finally {
        await page.mouse.up();
      }
      assert.equal(await page.locator('.send-btn').evaluate(el => el.classList.contains('napa-pressed')), false);
    });

    await check('IME composition and normal Enter preserve send behavior', async () => {
      await go('chat');
      const count = await page.evaluate(() => __previewEvents.filter(event => event === 'chat message').length);
      await page.locator('#input').fill('合成中文');
      await page.locator('#input').evaluate(el => {
        el.dispatchEvent(new CompositionEvent('compositionstart'));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      });
      assert.equal(await page.evaluate(() => __previewEvents.filter(event => event === 'chat message').length), count);
      await page.locator('#input').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend')));
      await page.waitForTimeout(80);
      await page.locator('#input').press('Shift+Enter');
      assert.ok((await page.locator('#input').inputValue()).includes('\n'));
      await page.locator('#input').press('Enter');
      assert.equal(await page.evaluate(() => __previewEvents.filter(event => event === 'chat message').length), count + 1);
    });

    for (const width of [390, 430, 768, 1366]) {
      await check(`U19 bounds and nav access ${width}px`, async () => {
        await go('chat', false, 'light', width);
        const values = await page.evaluate(() => {
          const composerRect = composer.getBoundingClientRect(), navRect = mobileNav.getBoundingClientRect();
          const messageRect = messagesDiv.getBoundingClientRect();
          return {
            bottom: composerRect.bottom, top: composerRect.top, msg: messageRect.bottom,
            navTop: navRect.top, nav: getComputedStyle(mobileNav).display !== 'none',
            h: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1
          };
        });
        assert.equal(values.overflow, false);
        assert.ok(values.bottom <= values.h + 1);
        assert.ok(values.msg <= values.top + 1);
        if (values.nav) assert.ok(values.bottom <= values.navTop + 1);
        result.measurements.u19 ||= {};
        result.measurements.u19[width] = values;
        if (width === 390) await shot('after-mobile-chat');
      });
    }

    await check('Mobile materials use one backdrop sample and compact controls use none', async () => {
      await go('home', false, 'light', 390);
      const values = await page.evaluate(() => ({
        transitions: [...document.querySelectorAll('.napa-material-transition')].map(el => getComputedStyle(el).display),
        cards: [...document.querySelectorAll('.home-card > .napa-material-core')].map(el => getComputedStyle(el).backdropFilter),
        window: getComputedStyle(document.querySelector('.home-shell > .napa-material-core')).backdropFilter
      }));
      assert.ok(values.transitions.length > 0 && values.transitions.every(display => display === 'none'));
      assert.ok(values.cards.length > 0 && values.cards.every(filter => filter === 'none'));
      assert.ok(values.window.startsWith('blur('));
      result.measurements.mobileMaterialBudget = values;
    });

    await check('Mobile keyboard navigation keeps the lens, drafts and ordinary-user permissions', async () => {
      await go('chat', false, 'light', 390);
      await page.locator('#input').fill('保留的合成草稿');
      const lensX = await page.locator('#mobileNav').evaluate(el => el.style.getPropertyValue('--napa-lens-x'));
      await page.locator('[data-mobile-nav="chat"]').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.mobileNav), 'forum');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => state.view === 'forum');
      await page.waitForTimeout(700);
      assert.equal(await page.locator('[data-mobile-nav="forum"]').getAttribute('aria-current'), 'page');
      assert.notEqual(await page.locator('#mobileNav').evaluate(el => el.style.getPropertyValue('--napa-lens-x')), lensX);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.mobileNav), 'chat');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => state.view === 'chat');
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#input').inputValue(), '保留的合成草稿');
      assert.equal(await page.locator('.napa-nav-lens').count(), 1);
      assert.equal(await page.locator('[data-mobile-nav="chat"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.evaluate(() => state.isAdmin), false);
      assert.equal(await page.locator('[data-admin-entry]:visible').count(), 0);
      assert.equal(await page.locator('[data-admin-entry]').evaluateAll(elements => elements.every(el => el.hidden)), true);
    });

    await check('Soft-keyboard simulation retains multiline input and navigation recovers', async () => {
      await go('chat', false, 'light', 390);
      try {
        await page.evaluate(() => {
          window.__vv = visualViewport; input.focus();
          Object.defineProperty(window, 'visualViewport', {
            configurable: true, value: { height: 410, offsetTop: 20, scale: 1 }
          });
          syncMobileViewport();
        });
        await page.locator('#input').fill('多行\n'.repeat(8));
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#mobileNav').isVisible(), false);
        assert.ok(await page.locator('#composer').evaluate(el => el.getBoundingClientRect().bottom <= 431));
      } finally {
        await page.evaluate(() => {
          input.blur();
          Object.defineProperty(window, 'visualViewport', { configurable: true, value: window.__vv });
          syncMobileViewport();
        });
      }
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#mobileNav').isVisible(), true);
    });

    await check('Reduced motion and high contrast have graceful fallback', async () => {
      await go('chat');
      await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
      await page.locator('#composer').hover();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#composer').evaluate(el => el.style.getPropertyValue('--napa-light-x')), '');
      assert.equal(await page.locator('#composer').evaluate(el => getComputedStyle(el, '::after').display), 'none');
      assert.equal(await page.locator('#input').isEnabled(), true);
      assert.equal(await page.locator('.napa-nav-lens').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    });

    await check('Headless frame timing is recorded without claiming device performance', async () => {
      await go('chat');
      result.measurements.frameIntervals = await page.evaluate(() => new Promise(resolve => {
        const intervals = []; let previous = performance.now();
        function frame(now) {
          intervals.push(now - previous); previous = now;
          if (intervals.length < 30) requestAnimationFrame(frame);
          else {
            intervals.sort((a, b) => a - b);
            resolve({ medianMs: intervals[15], p95Ms: intervals[28], samples: 30,
              note: 'headless timing only, not real-device FPS' });
          }
        }
        requestAnimationFrame(frame);
      }));
    });
    assert.deepEqual(result.errors, [], 'No browser page errors in executed checks');
    result.completed = true;
    console.log(JSON.stringify({
      passed: result.checks.filter(check => check.pass).length,
      executed: result.resume.executedChecks.length, carried: result.resume.carriedPassedChecks.length,
      errors: result.errors, screenshots: result.screenshots.length, report
    }));
  } catch (error) {
    result.failure = error.message;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})();
