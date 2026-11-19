// Optional browser regression check. Run a static app server first, then provide an
// existing Playwright installation via PLAYWRIGHT_MODULE; no app dependency is added.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), 'guitar-coach-ui-'));
  const failures = [];
  try {
    for (const name of ['keyboard', 'mobile', 'escape', 'path', 'recall', 'tunerCancel', 'offline']) {
      const page = await browser.newPage({ viewport: { width: name === 'mobile' ? 390 : 1440, height: 960 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        if (name === 'tunerCancel') await page.addInitScript(() => {
          const request = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
            window.grantTestMic = async () => { window.testStream = await request({ audio: true }); resolve(window.testStream); };
          });
        });
        await page.goto(process.env.T2_URL || 'http://localhost:8765');
        await page.waitForSelector('#appShell:not([hidden])');
        if (name === 'keyboard') {
          await page.locator('#board [tabindex="0"]').focus();
          await page.keyboard.press('ArrowRight');
          assert.match(await page.locator('#board :focus').getAttribute('aria-label'), /fret 1/i);
          await page.keyboard.press('Enter');
          await page.click('#headerMore > summary');
          await page.click('#stageBtn');
          assert.ok((await page.locator('#board [role=button]').evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label')))).every(label => /^String [1-6], (open|fret [0-9]+)$/.test(label)), 'Stage mode hides accessible note labels too');
        }
        if (name === 'mobile') {
          const y = await page.locator('#startDrill').evaluate(element => element.getBoundingClientRect().top);
          assert.ok(y < 650, `Start is at ${y}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        if (name === 'escape') {
          await page.click('#familyLearn');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#lessonPanel').isVisible(), false);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'familyLearn');
        }
        if (name === 'path') assert.match(await page.locator('#workspaceStep').innerText(), /Explore/);
        if (name === 'recall') {
          await page.evaluate(() => {
            window.testPlucks = 0;
            const create = AudioContext.prototype.createBufferSource;
            AudioContext.prototype.createBufferSource = function () {
              const source = create.call(this);
              const start = source.start;
              source.start = function (...args) {
                if (this.buffer && Math.abs(this.buffer.duration - 1.8) < 0.01) window.testPlucks++;
                return start.apply(this, args);
              };
              return source;
            };
          });
          await page.fill('#bpm', '240');
          await page.locator('#bpm').press('Enter');
          await page.click('#checkRecall');
          await page.waitForFunction(() => document.getElementById('countInOverlay').hidden);
          await page.waitForTimeout(400); // Observe an active note, after the one-second count-in.
          assert.match(await page.locator('#hintLevelName').innerText(), /No lights/);
          assert.equal(await page.evaluate(() => window.testPlucks), 0);
          assert.equal(await page.locator('#board .note').count(), 0);
          assert.ok((await page.locator('#board [role=button]').evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label')))).every(label => /^String [1-6], (open|fret [0-9]+)$/.test(label)));
          await page.click('#stopDrill');
        }
        if (name === 'tunerCancel') {
          await page.click('#tunerBtn');
          await page.waitForFunction(() => !!window.grantTestMic);
          await page.click('#tunerClose');
          await page.evaluate(() => window.grantTestMic());
          await page.waitForFunction(() => window.testStream.getTracks().every(track => track.readyState === 'ended'));
          assert.equal(await page.locator('#tunerCard').isVisible(), false);
        }
        if (name === 'offline') {
          await page.evaluate(async () => { await navigator.serviceWorker.ready; });
          await page.reload();
          await page.waitForSelector('#appShell:not([hidden])');
          await page.context().setOffline(true);
          await page.reload();
          await page.waitForSelector('#appShell:not([hidden])');
          await page.click('#familyLearn');
          assert.equal(await page.locator('#lessonPanel').isVisible(), true);
        }
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(captures, name + '.png'), fullPage: true });
        process.stdout.write('PASS ' + name + '\n');
      } catch (error) {
        process.stderr.write('FAIL ' + name + ': ' + error.message + '\n' + JSON.stringify({ errors, boot: await page.locator('#bootError').innerText().catch(() => '') }) + '\n');
        await page.screenshot({ path: path.join(captures, name + '-failed.png'), fullPage: true }).catch(() => {});
        failures.push(name);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  process.stdout.write('Captures: ' + captures + '\n');
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
