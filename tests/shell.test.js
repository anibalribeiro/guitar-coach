// ---------- Phase 6 shell ----------
// The four-view shell: the settings allow-list, the one view painter over both tablists, the one
// switcher in main, the run lock, the Today badge and the view's round-trip through storage.
// No DOM: panels are driven through a stub document, and main is read as source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSettingsStore, VIEWS, SCHEMA_VERSION } from '../app/src/settings.js';
import { createPanels, NAV_VIEWS, CTA_LABEL, MIC_ACTIONS, connectionView } from '../app/src/panels.js';
import { scaleById, chordById, chordPairById, progressionById, songById } from '../app/src/content.js';
import { positionsForScale } from '../app/src/theory.js';
import { createFakeStorage } from './helpers/fakes.js';

const CONTENT = { scaleById, chordById, chordPairById, progressionById, songById, positionsForScale };
const INDEX_PATH = fileURLToPath(new URL('../app/index.html', import.meta.url));
const read = name => fs.readFileSync(fileURLToPath(new URL(`../app/src/${name}`, import.meta.url)), 'utf8');
const html = () => fs.readFileSync(INDEX_PATH, 'utf8');
const PREFIXES = ['pill', 'bar'];

// A minimal element and document, copied from static.test.js rather than imported from it.
function stubElement(id = '') {
  const el = {
    id,
    children: [],
    dataset: {},
    style: {},
    attrs: {},
    classes: new Set(),
    classList: {
      add(...names) { names.forEach(name => el.classes.add(name)); },
      remove(...names) { names.forEach(name => el.classes.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !el.classes.has(name) : !!force;
        if (on) el.classes.add(name);
        else el.classes.delete(name);
        return on;
      },
      contains(name) { return el.classes.has(name); },
    },
    textContent: '',
    value: '',
    hidden: false,
    checked: false,
    disabled: false,
    tabIndex: 0,
    appendChild(child) { el.children.push(child); return child; },
    append(...nodes) { el.children.push(...nodes); },
    replaceChildren(...nodes) { el.children = nodes; },
    insertBefore(node) { el.children.push(node); },
    remove() {},
    setAttribute(name, value) { el.attrs[name] = String(value); },
    removeAttribute(name) { delete el.attrs[name]; },
    getAttribute(name) { return Object.hasOwn(el.attrs, name) ? el.attrs[name] : null; },
    hasAttribute(name) { return Object.hasOwn(el.attrs, name); },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() {},
    cloneNode() { return stubElement(id); },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return el;
}

// `setup` may pre-build stubs before createPanels wires them; `handlers` reach createPanels.
// Listeners added through `addEventListener` (element or document) are recorded per node and type.
function withPanels(run, { setup = () => {}, handlers = {} } = {}) {
  const beatDots = stubElement('beatDots');
  beatDots.children = Array.from({ length: 4 }, () => stubElement());
  const byId = new Map([['beatDots', beatDots]]);
  const listeners = [];
  const record = node => { node.addEventListener = (type, handler) => listeners.push({ node, type, handler }); return node; };
  const fake = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, record(stubElement(id)));
      return byId.get(id);
    },
    createElement: () => stubElement(),
    createTextNode: () => stubElement(),
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  record(fake);
  setup({ byId, get: id => fake.getElementById(id) });
  const saved = globalThis.document;
  globalThis.document = fake;
  try {
    return run({ panels: createPanels(handlers), byId, listeners, doc: fake });
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

// Everything between `id="view-{name}"` and the next view (or the end of main).
function viewSlice(source, name) {
  const start = source.indexOf(`id="view-${name}"`);
  const next = source.indexOf('id="view-', start + 1);
  return source.slice(start, next > start ? next : source.indexOf('</main>'));
}

test('the four views are one closed list in settings and in the panels painter', () => {
  assert.deepEqual(VIEWS, ['today', 'practice', 'progress', 'library']);
  assert.deepEqual(NAV_VIEWS, VIEWS, 'panels may not import settings.js, so the copy is pinned equal');
});

test('settings.view defaults to today, round-trips through storage and rejects anything else', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.load().view, 'today', 'a first launch opens Today');
  store.set({ view: 'progress' });
  assert.equal(createSettingsStore(storage, CONTENT).load().view, 'progress', 'a reload reopens the last view');
  for (const bad of ['admin', 42, null, '', 'Today']) {
    const forged = createFakeStorage();
    forged.setItem('t2coach.v1', JSON.stringify({ schemaVersion: SCHEMA_VERSION, settings: { view: bad } }));
    assert.equal(createSettingsStore(forged, CONTENT).load().view, 'today', `a stored ${JSON.stringify(bad)} opens Today`);
  }
  assert.equal(SCHEMA_VERSION, 2, 'the view is an additive field, never a schema bump');
});

test('setView shows exactly one view and selects its tab in both bars', () => {
  withPanels(({ panels, byId }) => {
    panels.setView('progress');
    for (const v of VIEWS) {
      assert.equal(byId.get(`view-${v}`).hidden, v !== 'progress', `view-${v} visibility`);
      for (const prefix of PREFIXES) {
        const tab = byId.get(`${prefix}-${v}`);
        assert.equal(tab.getAttribute('aria-selected'), v === 'progress' ? 'true' : 'false', `${prefix}-${v} selection`);
        assert.equal(tab.tabIndex, v === 'progress' ? 0 : -1, `${prefix}-${v} roving tabindex`);
      }
    }
    assert.equal(byId.get('skipLink').getAttribute('href'), '#view-progress');
    assert.equal(panels.isProgressOpen(), true);
    assert.equal(panels.isSessionOpen(), false);
    // A name outside the closed list changes nothing.
    panels.setView('nope');
    assert.equal(byId.get('view-progress').hidden, false);
    assert.equal(byId.get('view-today').hidden, true);
    assert.equal(byId.get('skipLink').getAttribute('href'), '#view-progress');
    panels.setView('today');
    assert.equal(panels.isSessionOpen(), true, 'Today on screen is the Session panel open (A-73)');
  });
});

test('the shell has four tabpanel views, two Main navs with Views tablists and a skip link before the header', () => {
  const source = html();
  for (const [v, label] of [['today', 'Today'], ['practice', 'Practice'], ['progress', 'Progress'], ['library', 'Library']]) {
    assert.match(source, new RegExp(`<section id="view-${v}" role="tabpanel" aria-label="${label}" hidden>`));
    // Practice's heading is its lead title (06-02); the other three keep an sr-only h2.
    if (v === 'practice') assert.match(viewSlice(source, v), /<h2 class="workspace-title lead" id="workspaceTitle" tabindex="-1">/);
    else assert.match(viewSlice(source, v), new RegExp(`<h2 class="sr-only">${label}</h2>`));
  }
  assert.equal((source.match(/data-view="/g) || []).length, 8, 'eight nav tabs');
  // IN-05: the nav landmark is named Main; its tablist is named Views so no name is doubled inside it.
  assert.equal((source.match(/role="tablist" aria-label="Views"/g) || []).length, 2, 'two Views tablists');
  assert.ok(!/role="tablist" aria-label="Main"/.test(source), 'no tablist repeats the nav name');
  for (const prefix of PREFIXES) {
    for (const v of VIEWS) {
      assert.match(source, new RegExp(`<button type="button" role="tab" id="${prefix}-${v}" data-view="${v}" aria-controls="view-${v}" aria-selected="false" tabindex="-1">`));
    }
  }
  assert.match(source, /<nav class="pills" aria-label="Main">/);
  assert.match(source, /<nav class="tabbar" aria-label="Main">/);
  assert.ok(source.indexOf('id="skipLink"') < source.indexOf('<header'), 'the skip link is the first focusable element');
  assert.match(source, /<a class="skip-link" id="skipLink" href="#view-today">Skip to content<\/a>/);
  assert.ok(viewSlice(source, 'today').includes('id="sessionPanel"'));
  assert.ok(viewSlice(source, 'progress').includes('id="progressPanel"'));
  assert.ok(viewSlice(source, 'practice').includes('id="board"'));
  // The one live region stays outside every view, so hiding a view never silences it.
  const announcer = source.indexOf('id="announcer"');
  assert.ok(announcer > source.indexOf('<main>') && announcer < source.indexOf('id="view-'));
  assert.equal((source.match(/aria-live=/g) || []).length, 1);
  // The phone bar and the desktop pills never show together.
  assert.match(source, /@media \(min-width: 1024px\) \{\s*\.tabbar \{ display: none; \}\s*\.pills \{ display: flex; \}/);
});

test('main owns the single view switcher, persists the change and restores it at boot', () => {
  const main = read('main.js');
  assert.match(main, /import \{[^}]*\bVIEWS\b[^}]*\} from '\.\/settings\.js';/);
  assert.equal((main.match(/function switchView\(/g) || []).length, 1);
  const body = main.slice(main.indexOf('function switchView('), main.indexOf('function switchView(') + 1600);
  assert.match(body, /if \(!VIEWS\.includes\(name\)\) return false;/);
  assert.match(body, /if \(persist && settings\.view !== name\) save\(\{ view: name \}\);/);
  assert.match(body, /panels\.setView\(name\);/);
  assert.match(body, /if \(name === 'today'\) enterToday\(\);/);
  assert.match(main, /switchView\(settings\.view, \{ scroll: false, persist: false \}\);/);
  assert.match(main, /onView: name => switchView\(name\)/);
  // Nothing but the switcher paints the view.
  assert.equal((main.match(/panels\.setView\(/g) || []).length, 1);
});

test('the run lock refuses Today and Progress with the UI-SPEC line, spoken and shown', () => {
  const main = read('main.js');
  assert.match(main, /const RUN_LOCK_FEEDBACK = 'Stop the drill or finish this pass to open Today or Progress\.';/);
  const body = main.slice(main.indexOf('function switchView('), main.indexOf('function switchView(') + 1600);
  assert.match(body, /if \(\(name === 'today' \|\| name === 'progress'\) && stageOwned\(\)\) \{\s*(\/\/[^\n]*\n\s*)*panels\.setFeedback\(RUN_LOCK_FEEDBACK\);\s*panels\.announce\(RUN_LOCK_FEEDBACK\);\s*return false;/);
  assert.match(main, /const stageOwned = \(\) => isRunning\(\) \|\| !!\(run && run\.phase === 'passReview'\);/);
});

test('the nav keyboard moves focus with roving tabindex and never fires the lock on focus alone', () => {
  const panels = read('panels.js');
  assert.match(panels, /tab\.addEventListener\('click', \(\) => onView\(NAV_VIEWS\[i\]\)\);/);
  assert.match(panels, /\$\(`\$\{prefix\}List`\)\.addEventListener\('keydown'/);
  assert.match(panels, /if \(target\.getAttribute\('aria-disabled'\) !== 'true'\) onView\(NAV_VIEWS\[next\]\);/);
  assert.ok(!/from '\.\/settings\.js'/.test(panels), 'panels never imports settings.js');
});

test('the Today badge shows the due count or the running block, in both bars, with the count in the name', () => {
  withPanels(({ panels, byId }) => {
    panels.setSessionButton({ dueCount: 3 });
    for (const prefix of PREFIXES) {
      assert.equal(byId.get(`${prefix}TodayBadge`).textContent, '3');
      assert.equal(byId.get(`${prefix}TodayBadge`).hidden, false);
      assert.equal(byId.get(`${prefix}-today`).getAttribute('aria-label'), 'Today, 3 due');
    }
    panels.setSessionButton({ dueCount: 0 });
    for (const prefix of PREFIXES) {
      assert.equal(byId.get(`${prefix}TodayBadge`).hidden, true, 'hidden at 0');
      assert.equal(byId.get(`${prefix}-today`).getAttribute('aria-label'), 'Today');
    }
    panels.setSessionButton({ dueCount: 120 });
    assert.equal(byId.get('barTodayBadge').textContent, '99+');
    assert.equal(byId.get('pillTodayBadge').textContent, '99+');
    assert.equal(byId.get('bar-today').getAttribute('aria-label'), 'Today, 120 due');
    panels.setSessionButton({ dueCount: 0, running: true, index: 1, total: 5 });
    assert.equal(byId.get('barTodayBadge').textContent, '2 / 5');
    assert.equal(byId.get('barTodayBadge').hidden, false, 'a running session always shows its block');
    assert.equal(byId.get('pill-today').getAttribute('aria-label'), 'Today, block 2 of 5');
  });
  for (const id of ['pillTodayBadge', 'barTodayBadge']) {
    assert.match(html(), new RegExp(`<span class="tab-badge" id="${id}" aria-hidden="true" hidden>`));
  }
});

test('setNavLocked marks only the Today and Progress tabs aria-disabled, and clears them again', () => {
  withPanels(({ panels, byId }) => {
    panels.setNavLocked(true);
    for (const prefix of PREFIXES) {
      for (const v of VIEWS) {
        const expected = v === 'today' || v === 'progress' ? 'true' : null;
        assert.equal(byId.get(`${prefix}-${v}`).getAttribute('aria-disabled'), expected, `${prefix}-${v}`);
        assert.equal(byId.get(`${prefix}-${v}`).disabled, false, 'never disabled, so the tab stays focusable');
      }
    }
    panels.setNavLocked(false);
    for (const prefix of PREFIXES) {
      for (const v of VIEWS) assert.equal(byId.get(`${prefix}-${v}`).getAttribute('aria-disabled'), null);
    }
  });
  // The drill paints the lock from the same predicate main's run lock uses, and a drill start
  // still disarms a pending import (WR-11, Pitfall 4).
  const panels = read('panels.js');
  assert.match(panels, /const lockedForProgress = playing \|\| passReview;\s*setNavLocked\(lockedForProgress\);/);
  assert.match(panels, /if \(lockedForProgress && !wasLocked\) \{\s*showImportConfirm\(false\);\s*onImportReset\(\);\s*(\/\/[^\n]*\n\s*)*closeMore\(\);\s*\}\s*wasLocked = lockedForProgress;/);
});

// CR-01: a live pass repaints on every beat, so only the idle -> locked transition closes More.
test('CR-01: repeated locked setDrill paints never close an open More sheet; the drill start does', () => {
  let resets = 0;
  withPanels(({ panels, byId }) => {
    const sheet = byId.get('moreSheet');
    panels.openMore();
    assert.equal(sheet.open, true);
    panels.setDrill({ phase: 'active' });
    assert.equal(sheet.open, false, 'the drill start closes the sheet');
    assert.equal(resets, 1, 'and disarms a pending import once');
    panels.openMore();
    for (const phase of ['active', 'active', 'paused', 'active', 'countIn']) {
      panels.setDrill({ phase });
      assert.equal(sheet.open, true, `a locked ${phase} paint leaves More open`);
    }
    assert.equal(resets, 1, 'no import reset on a beat');
    panels.setDrill({ phase: 'idle' });
    panels.setDrill({ phase: 'countIn' });
    assert.equal(sheet.open, false, 'the next drill start closes it again');
    assert.equal(resets, 2);
  }, {
    handlers: { onImportReset: () => { resets++; } },
    setup: ({ get }) => {
      let all = [];
      const sheet = stubDialog(get, () => all);
      sheet.addEventListener = (type, handler) => all.push({ node: sheet, type, handler });
      get('announcer').parentNode = get('main');
    },
  });
  // More stays open during a pass, so main refuses an import until the stage is free (WR-10).
  const main = read('main.js');
  assert.match(fnBody(main, 'importFile'), /if \(stageOwned\(\)\) \{ setBackup\(IMPORT_MESSAGE\.running, 'danger'\); return; \}/);
  assert.match(fnBody(main, 'confirmImport'), /if \(!pendingImport \|\| stageOwned\(\)\) return;/);
});

test('the header Session and Progress buttons and the two Hide buttons are gone', () => {
  const source = html();
  for (const id of ['sessionBtn', 'sessionBadge', 'progressBtn', 'hideSession', 'hideProgress']) {
    assert.ok(!source.includes(`id="${id}"`), `#${id} is removed`);
  }
  const panels = read('panels.js');
  const main = read('main.js');
  for (const name of ['focusSessionToggle', 'focusProgressToggle', 'onProgressOpen', 'onProgressClose']) {
    assert.ok(!panels.includes(name), `panels has no ${name}`);
    assert.ok(!main.includes(name), `main has no ${name}`);
  }
  assert.ok(!/function closeProgress/.test(main), 'there is no Progress panel to close');
  // The summary's Done still closes the finished session through the reducer, then repaints Today.
  const closeSession = main.slice(main.indexOf('function closeSession'), main.indexOf('function startSession'));
  assert.match(closeSession, /sessionReduce\(session, \{ type: 'CLOSE' \}\)/);
  assert.match(closeSession, /enterToday\(\);\s*panels\.focusSessionHead\(\);/);
  assert.equal((main.match(/panels\.setSessionButton\(/g) || []).length, 1, 'one badge writer');
});

// ---------- 06-02: Library chooses, Practice plays ----------
// The body of a named function in main.js, up to the next top-level function.
function fnBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const ends = ['\nfunction ', '\nasync function '].map(token => source.indexOf(token, start + 1)).filter(at => at > start);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('Library holds the family tabs, the picker card and the Practise CTA', () => {
  const library = viewSlice(html(), 'library');
  for (const needle of ['id="tabs"', 'id="tabpanel"', 'id="key"', 'id="scale"', 'id="position"', 'id="labels"', 'id="libraryCta"']) {
    assert.ok(library.includes(needle), `${needle} sits in view-library`);
  }
  assert.match(library, /<section id="tabpanel" role="tabpanel" aria-labelledby="tab-scales" class="library-card" tabindex="0">/);
  assert.match(library, /<button type="button" class="cta" id="libraryCta">Practise this scale<\/button>/);
  assert.ok(library.indexOf('id="tabpanel"') < library.indexOf('id="libraryCta"'), 'the CTA follows the card');
  assert.ok(!html().includes('id="workspaceSetup"'), 'the setup details wrapper is gone');
});

test('Practice keeps title, neck, controls, coach and outcomes in reading order, with no picker row', () => {
  const practice = viewSlice(html(), 'practice');
  const order = ['class="p-head"', 'id="lessonPanel"', 'class="p-neck"', 'class="p-ctl"', 'class="p-coach"', 'class="p-out"']
    .map(needle => practice.indexOf(needle));
  for (const at of order) assert.ok(at > 0, 'a Practice area is missing');
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'the Practice areas are out of order');
  assert.ok(!practice.includes('id="key"'), 'no key picker in Practice');
  assert.ok(!practice.includes('id="tabs"'), 'no family tabs in Practice');
  assert.match(practice, /<button type="button" class="text-button" id="changeInLibrary">Change in Library<\/button>/);
  const coach = practice.slice(practice.indexOf('class="p-coach"'), practice.indexOf('class="p-out"'));
  for (const id of ['microcopy', 'feedback', 'startHere', 'familyLearn', 'pathMaterials']) {
    assert.ok(coach.includes(`id="${id}"`), `#${id} sits in the coach area`);
  }
});

test('Today shows the greeting, the v1 session plan and the learning path', () => {
  const source = html();
  const today = viewSlice(source, 'today');
  assert.match(today, /<h2 class="lead" id="todayGreeting">Today's practice<\/h2>/);
  assert.match(today, /<p>Here's your plan\. Each block says why it was chosen\. Start at the top\.<\/p>/);
  const greet = today.indexOf('id="todayGreeting"');
  const session = today.indexOf('id="sessionPanel"');
  const path = today.indexOf('id="learningPath"');
  assert.ok(greet > 0 && session > greet && path > session, 'greeting, plan, then the path');
  assert.ok(!source.includes('id="pathSession"'), 'no Open session button');
  // The tuner moved into the More sheet, reachable from every view (06-03).
  const sheet = source.slice(source.indexOf('id="moreSheet"'), source.indexOf('</dialog>'));
  assert.ok(sheet.includes('id="tunerBtn"') && sheet.includes('id="tunerCard"'));
});

test('every seed switches to Practice before it focuses or scrolls, and Play never starts', () => {
  const main = read('main.js');
  assert.match(fnBody(main, 'closeAllPanels'), /switchView\('practice'/);
  const seed = fnBody(main, 'seedBlock');
  assert.ok(seed.indexOf("switchView('practice'") >= 0 && seed.indexOf("switchView('practice'") < seed.indexOf('await startDrill('),
    'seedBlock switches synchronously before awaiting the start');
  const focus = fnBody(main, 'focusDrillStage');
  assert.match(focus, /switchView\('practice'/);
  assert.ok(!/type: 'START'/.test(focus) && !/startDrill\(/.test(focus), 'Play never dispatches a START');
  const select = fnBody(main, 'practiseSelection');
  assert.ok(select.indexOf("switchView('practice')") >= 0 && select.indexOf("switchView('practice')") < select.indexOf("$('startDrill').focus()"));
  // WR-02: a running pass hides Start drill, so focus then lands on the Practice title.
  assert.match(select, /if \(!\$\('transportBar'\)\.hidden && !start\.hidden && !start\.disabled\) \$\('startDrill'\)\.focus\(\);\s*else \$\('workspaceTitle'\)\.focus\(\);/);
  for (const name of ['openPathStep', 'startHere', 'openLessonSection', 'openPowerChordLesson', 'startGuidedLesson']) {
    assert.match(fnBody(main, name), /switchView\('practice'/, `${name} lands on Practice`);
  }
  assert.match(fnBody(main, 'openSessionSummary'), /switchView\('today'/);
  assert.match(main, /onPractiseSelection: practiseSelection,/);
  const panels = read('panels.js');
  assert.match(panels, /if \(\$\('libraryCta'\)\) \$\('libraryCta'\)\.addEventListener\('click', \(\) => onPractiseSelection\(\)\);/);
  assert.match(panels, /if \(\$\('changeInLibrary'\)\) \$\('changeInLibrary'\)\.addEventListener\('click', \(\) => onView\('library'\)\);/);
});

test('the CTA label follows the family tab, written with textContent', () => {
  assert.deepEqual(CTA_LABEL, {
    scales: 'Practise this scale', chords: 'Practise this chord',
    progressions: 'Practise this progression', songs: 'Practise this song',
  });
  withPanels(({ panels, byId }) => {
    panels.select('chords', false, false);
    assert.equal(byId.get('libraryCta').textContent, 'Practise this chord');
    panels.select('songs', false, false);
    assert.equal(byId.get('libraryCta').textContent, 'Practise this song');
  });
  assert.match(read('panels.js'), /\$\('libraryCta'\)\.textContent = CTA_LABEL\[tab\]/);
});

// ---------- NAV-04: the More sheet (06-03) ----------
// WR-04: a run-guarded picker in Library is disabled while a pass plays, never silently ignored.
test('WR-04: every Key select and the selection pickers are disabled while a pass plays', () => {
  withPanels(({ panels, byId }) => {
    const ids = ['key', 'scale', 'position', 'direction', 'progressionKey', 'songKey', 'playKey'];
    panels.setDrill({ phase: 'active' });
    for (const id of ids) assert.equal(byId.get(id).disabled, true, `${id} is locked during a pass`);
    panels.setDrill({ phase: 'idle' });
    for (const id of ids) assert.equal(byId.get(id).disabled, false, `${id} is live again at idle`);
  });
});

// WR-01: a lesson opened from Today or Library returns focus to a rendered node, not the hidden opener.
test('WR-01: closing a lesson whose opener sits in a hidden view focuses Learn, or the title when Learn is locked', () => {
  const focused = [];
  withPanels(({ panels, byId, listeners }) => {
    const opener = byId.get('powerChordLearn');
    opener.getClientRects = () => [];
    const click = listeners.find(l => l.node === opener && l.type === 'click');
    click.handler({ target: opener });
    panels.setLessonOpen(true);
    panels.setLessonOpen(false);
    assert.deepEqual(focused, ['familyLearn']);
    byId.get('familyLearn').disabled = true;
    panels.setLessonOpen(true);
    panels.setLessonOpen(false);
    assert.deepEqual(focused, ['familyLearn', 'workspaceTitle']);
  }, {
    setup: ({ get }) => {
      get('lessonPanel').hidden = true;
      for (const id of ['powerChordLearn', 'familyLearn', 'workspaceTitle']) get(id).focus = () => focused.push(id);
    },
  });
});

const sheetSlice = source => source.slice(source.indexOf('id="moreSheet"'), source.indexOf('</dialog>'));

// A stub dialog: `showModal` opens it, `close` shuts it and fires the recorded close listeners.
function stubDialog(get, listeners) {
  const sheet = get('moreSheet');
  sheet.open = false;
  sheet.showModal = () => { sheet.open = true; };
  sheet.close = () => {
    sheet.open = false;
    for (const l of listeners()) if (l.node === sheet && l.type === 'close') l.handler({ target: sheet });
  };
  return sheet;
}

test('NAV-04: one More dialog holds Tuner, Microphone, Backup and Settings in order', () => {
  const source = html();
  assert.equal((source.match(/<dialog id="moreSheet"/g) || []).length, 1);
  assert.match(source, /<dialog id="moreSheet" aria-labelledby="moreTitle">/);
  const sheet = sheetSlice(source);
  let at = -1;
  for (const id of ['tunerBtn', 'tunerCard', 'micToggle', 'micCalibrate', 'exportBtn', 'importBtn', 'importConfirm', 'lightsBtn', 'stageBtn']) {
    const next = sheet.indexOf(`id="${id}"`);
    assert.ok(next > at, `${id} sits in the sheet, in order`);
    at = next;
  }
  for (const label of ['Tuner', 'Microphone', 'Backup', 'Settings']) {
    assert.match(sheet, new RegExp(`<h3 class="more-eyebrow" id="[^"]+">${label}</h3>`));
  }
  assert.match(sheet, /<button type="button" id="closeMore" aria-label="Close menu">Close<\/button>/);
  assert.match(source, /<button type="button" class="more-btn" id="moreBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="moreSheet">/);
  assert.ok(!source.includes('headerMore') && !read('main.js').includes('headerMore'), 'the header details menu is gone');
  assert.ok(!viewSlice(source, 'progress').includes('id="backupSection"'), 'backup left the Progress view');
  assert.equal((source.match(/aria-live=/g) || []).length, 1, 'still exactly one live region');
});

test('NAV-04: closing the sheet stops the tuner, closes calibration and disarms the import', () => {
  const main = read('main.js');
  const body = fnBody(main, 'onMoreClose');
  assert.match(body, /stopTuner\(\)/);
  assert.match(body, /closeCalibration\(\{[^}]*focus: false[^}]*\}\)/);
  assert.match(body, /cancelImport\(\)/);
  assert.match(main, /onMoreClose,/);
  assert.match(fnBody(main, 'closeAllPanels'), /panels\.closeMore\(\);/);
  const tune = fnBody(main, 'openPathStep');
  assert.ok(tune.indexOf('panels.openMore();') >= 0 && tune.indexOf('panels.openMore();') < tune.indexOf("$('tunerBtn').focus();"),
    'the Tune step opens More, then focuses Start tuner');
});

test('NAV-04: openMore moves the one announcer into the sheet and close moves it home and refocuses More', () => {
  let closed = 0;
  let focused = null;
  withPanels(({ panels, byId }) => {
    const sheet = byId.get('moreSheet');
    const announcer = byId.get('announcer');
    announcer.textContent = 'stale';
    assert.equal(panels.isMoreOpen(), false);
    assert.equal(panels.openMore(), true);
    assert.equal(sheet.open, true);
    assert.ok(sheet.children.includes(announcer), 'the live region rides into the modal');
    assert.equal(announcer.textContent, '', 'and starts empty');
    assert.equal(byId.get('moreBtn').getAttribute('aria-expanded'), 'true');
    assert.equal(panels.isMoreOpen(), true);
    assert.equal(panels.openMore(), false, 'a second open is a no-op');
    panels.closeMore();
    assert.equal(sheet.open, false);
    assert.equal(closed, 1, 'onMoreClose ran once');
    assert.ok(byId.get('main').children.includes(announcer), 'the live region is home again');
    assert.equal(byId.get('moreBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(focused, 'moreBtn');
  }, {
    handlers: { onMoreClose: () => { closed++; } },
    setup: ({ get }) => {
      let all = [];
      const sheet = stubDialog(get, () => all);
      sheet.addEventListener = (type, handler) => all.push({ node: sheet, type, handler });
      const home = get('main');
      get('announcer').parentNode = home;
      get('moreBtn').focus = () => { focused = 'moreBtn'; };
    },
  });
});

// IN-02: only a press that both starts and ends on the backdrop closes the sheet.
test('IN-02: a press released on the backdrop closes the sheet only if it started there', () => {
  withPanels(({ panels, byId, listeners }) => {
    const sheet = byId.get('moreSheet');
    const fire = (type, target) => { for (const l of listeners.filter(l => l.node === sheet && l.type === type)) l.handler({ target }); };
    const body = byId.get('moreBody');
    panels.openMore();
    fire('pointerdown', body); fire('click', sheet);
    assert.equal(sheet.open, true, 'a drag from the body onto the backdrop keeps the sheet open');
    fire('pointerdown', sheet); fire('click', sheet);
    assert.equal(sheet.open, false, 'a press on the backdrop closes it');
  }, {
    setup: ({ get }) => { stubDialog(get, () => []); get('announcer').parentNode = get('main'); },
  });
});

test('NAV-04: without a dialog API openMore is a silent no-op', () => {
  withPanels(({ panels, byId }) => {
    assert.doesNotThrow(() => panels.openMore());
    assert.equal(panels.openMore(), false);
    assert.equal(byId.get('moreBtn').getAttribute('aria-expanded'), null);
    assert.doesNotThrow(() => panels.closeMore());
    assert.equal(panels.isMoreOpen(), false);
  });
});

test('NAV-04: calibration swaps in for the sheet list and Close calibration brings the list back', () => {
  const source = html();
  const sheet = sheetSlice(source);
  assert.ok(sheet.indexOf('id="calibrationPanel"') > sheet.indexOf('id="moreList"'), 'calibration sits in the sheet, after the list');
  assert.match(sheet, /<button type="button" id="closeCalibration">Close calibration<\/button>/);
  assert.match(sheet, /<button type="button" id="micCalibrate">Calibrate timing<\/button>/);
  assert.equal(MIC_ACTIONS.calibrate, 'Calibrate timing');
  withPanels(({ panels, byId }) => {
    panels.setCalibrationOpen(true);
    assert.equal(byId.get('moreSheet').open, true, 'opening calibration with the sheet closed opens it first');
    assert.equal(byId.get('calibrationPanel').hidden, false);
    assert.equal(byId.get('moreList').hidden, true);
    panels.setCalibrationOpen(false);
    assert.equal(byId.get('calibrationPanel').hidden, true);
    assert.equal(byId.get('moreList').hidden, false);
  }, { setup: ({ get }) => { stubDialog(get, () => []); } });
});

test('NAV-04: one Esc owner - no calibration Escape listener, and the lesson one yields to the sheet', () => {
  const panels = read('panels.js');
  const wire = panels.slice(panels.indexOf('  function wire() {'), panels.indexOf('  fillStaticOptions();'));
  const escapes = wire.split("document.addEventListener('keydown'").slice(1);
  assert.equal(escapes.filter(chunk => /isCalibrationOpen\(\)/.test(chunk.slice(0, 200))).length, 0, 'no calibration Escape listener');
  const lesson = escapes.find(chunk => /isLessonOpen\(\)/.test(chunk.slice(0, 200)));
  assert.ok(lesson, 'the lesson Escape listener remains');
  const guard = lesson.indexOf('if (isMoreOpen()) return;');
  assert.ok(guard >= 0 && guard < lesson.indexOf('e.preventDefault()'), 'the sheet guard runs before preventDefault');

  const run = (sheetOpen, { practiceHidden = false, menuOpen = false } = {}) => {
    let closed = 0;
    let prevented = false;
    withPanels(({ listeners }) => {
      const keydowns = listeners.filter(l => l.node === globalThis.document && l.type === 'keydown');
      const event = { key: 'Escape', preventDefault() { prevented = true; } };
      for (const l of keydowns) l.handler(event);
    }, {
      handlers: { onLessonClose: () => { closed++; } },
      setup: ({ get }) => {
        get('lessonPanel').hidden = false;
        get('moreSheet').open = sheetOpen;
        get('view-practice').hidden = practiceHidden;
        get('connMenu').matches = selector => menuOpen && selector === ':popover-open';
      },
    });
    return { closed, prevented };
  };
  assert.deepEqual(run(true), { closed: 0, prevented: false }, 'Esc over the open sheet leaves the lesson and the dialog alone');
  assert.deepEqual(run(false), { closed: 1, prevented: true }, 'with the sheet closed Esc still closes the lesson');
  // IN-01: a lesson in a hidden Practice view, or behind an open guitar menu, keeps its Esc.
  assert.deepEqual(run(false, { practiceHidden: true }), { closed: 0, prevented: false }, 'Esc on another view leaves the hidden lesson alone');
  assert.deepEqual(run(false, { menuOpen: true }), { closed: 0, prevented: false }, 'Esc closes the guitar menu, not the lesson behind it');
});

test('KEEP-03: an import keeps the current view and leaves focus inside the sheet', () => {
  const main = read('main.js');
  const body = fnBody(main, 'confirmImport');
  assert.match(body, /const viewBefore = settings\.view;\s*settings = store\.replaceAll\(pendingImport\);/);
  assert.match(body, /if \(settings\.view !== viewBefore\) save\(\{ view: viewBefore \}\);/);
  assert.match(body, /panels\.focusBackupStatus\(\);/);
  assert.ok(!/focusProgressHead/.test(body), 'the Progress heading sits behind the modal');
  assert.ok(!/switchView\(|panels\.setView\(/.test(body), 'the view is never switched');
  assert.match(html(), /<p class="backup-status" id="backupStatus" tabindex="-1"><\/p>/);
});

// ---------- NAV-03: the connection pill and the guitar menu (06-03) ----------
test('NAV-03: the pill holds its label, and the guitar menu is a popover with the status and Disconnect', () => {
  const source = html();
  const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'));
  assert.match(header, /<button type="button" id="connectBtn" class="conn-disconnected" aria-label="Connect guitar"><span class="pill-dot" aria-hidden="true"><\/span><span id="connLabel">Connect guitar<\/span><\/button>/);
  assert.ok(!/class="dot"/.test(source), 'the old header dot is gone');
  const menu = source.slice(source.indexOf('id="connMenu"'), source.indexOf('</div>', source.indexOf('id="connMenu"')));
  assert.match(source, /<div id="connMenu" popover="auto"/);
  assert.match(menu, /<p id="status">Guitar not connected<\/p>/);
  assert.match(menu, /<button type="button" id="disconnectBtn" hidden>Disconnect guitar<\/button>/);
  assert.ok(!menu.includes('id="capabilities"'), 'the capability line is not in the menu');
  assert.ok(sheetSlice(source).includes('id="capabilities"'), 'it heads More › Settings in every connection state');
});

test('NAV-03: main paints the pill through setConnection and opens the menu after a failed connect', () => {
  const main = read('main.js');
  assert.ok(!/\$\('connectBtn'\)\.textContent/.test(main), 'main never writes the pill text');
  assert.ok(!main.includes("'Disconnect'"));
  assert.match(main, /panels\.setConnection\(\{ state: connectionState\(\), battery \}\);/);
  const wire = fnBody(main, 'wireGuitar');
  const handler = wire.slice(wire.indexOf("$('connectBtn').addEventListener('click'"), wire.indexOf("$('disconnectBtn')"));
  assert.match(handler, /if \(guitar\.writeChar\) \{\s*panels\.openConnMenu\(\);\s*return;\s*\}/);
  // IN-03: a second press on the connected pill closes the menu; light dismiss already ran, so
  // the open state is the one read at pointerdown.
  assert.match(wire, /\$\('connectBtn'\)\.addEventListener\('pointerdown', \(\) => \{ connMenuOpenAtPress = panels\.isConnMenuOpen\(\); \}\);/);
  assert.match(handler, /const menuWasOpen = e && e\.detail > 0 \? connMenuOpenAtPress : panels\.isConnMenuOpen\(\);\s*connMenuOpenAtPress = false;\s*if \(guitar\.writeChar && menuWasOpen\) \{ panels\.closeConnMenu\(\); return; \}/);
  assert.match(handler, /let failed = false;\s*try \{/);
  assert.match(handler, /\} catch \(e\) \{\s*failed = true;/);
  assert.match(handler, /\} finally \{\s*paintConnection\(\);\s*if \(failed\) panels\.openConnMenu\(\);\s*(\/\/[^\n]*\n\s*)*else if \(!document\.activeElement \|\| document\.activeElement === document\.body\) \$\('connectBtn'\)\.focus\(\);\s*\}/);
  assert.match(wire, /\$\('disconnectBtn'\)\.addEventListener\('click', \(\) => \{\s*guitar\.disconnect\(\);\s*panels\.closeConnMenu\(\);/);
  // main never reads the Bluetooth global: No Bluetooth comes from the boot preflight.
  assert.match(main, /capabilities\.bluetooth === 'unsupported'/);
});

test('NAV-03: setConnection writes the five UI-SPEC rows and never renders a battery string', () => {
  const rows = [
    [{ state: 'disconnected' }, 'Connect guitar', 'Connect guitar'],
    [{ state: 'connecting' }, 'Connecting…', 'Connecting to guitar'],
    [{ state: 'connected', battery: 82 }, 'T2 · 82%', 'Guitar connected, battery 82%. Open guitar menu'],
    [{ state: 'connected', battery: null }, 'T2 · —%', 'Guitar connected, battery unknown. Open guitar menu'],
    [{ state: 'unsupported' }, 'No Bluetooth', 'Bluetooth unavailable. Open guitar menu'],
  ];
  withPanels(({ panels, byId }) => {
    for (const [input, label, name] of rows) {
      panels.setConnection(input);
      assert.equal(byId.get('connLabel').textContent, label);
      assert.equal(byId.get('connectBtn').getAttribute('aria-label'), name);
      assert.ok(byId.get('connectBtn').classes.has(`conn-${input.state}`));
      assert.equal(byId.get('connectBtn').disabled, input.state === 'connecting');
      assert.equal(byId.get('disconnectBtn').hidden, input.state !== 'connected');
      assert.equal(byId.get('connectBtn').classes.has('on'), input.state === 'connected');
    }
    panels.setConnection({ state: 'connected', battery: '<img src=x onerror=alert(1)>' });
    assert.equal(byId.get('connLabel').textContent, 'T2 · —%', 'a markup string is never shown');
  });
  assert.equal(connectionView({ state: 'bogus' }).label, 'Connect guitar');
  assert.equal(connectionView({ state: 'connected', battery: '57' }).label, 'T2 · 57%');
});

test('NAV-03: openConnMenu shows the popover and focuses Disconnect or the menu itself', () => {
  let focused = null;
  withPanels(({ panels, byId }) => {
    const menu = byId.get('connMenu');
    panels.setConnection({ state: 'disconnected' });
    assert.equal(panels.openConnMenu(), true);
    assert.equal(menu.isOpen, true);
    assert.equal(focused, 'connMenu', 'Disconnect is hidden, so the menu takes focus');
    panels.closeConnMenu();
    assert.equal(menu.isOpen, false);
    panels.setConnection({ state: 'connected', battery: 40 });
    panels.openConnMenu();
    assert.equal(focused, 'disconnectBtn');
  }, {
    setup: ({ get }) => {
      const menu = get('connMenu');
      menu.isOpen = false;
      menu.showPopover = () => { menu.isOpen = true; };
      menu.hidePopover = () => { menu.isOpen = false; };
      menu.matches = selector => selector === ':popover-open' && menu.isOpen;
      menu.focus = () => { focused = 'connMenu'; };
      get('disconnectBtn').focus = () => { focused = 'disconnectBtn'; };
    },
  });
  withPanels(({ panels }) => {
    assert.equal(panels.openConnMenu(), false, 'no popover API: a silent no-op');
    assert.doesNotThrow(() => panels.closeConnMenu());
  });
});

// ---------- LOOK-02: light only ----------
test('LOOK-02: the shell is light only and nothing reads or applies a theme', () => {
  const source = html();
  assert.ok(!source.includes('id="theme"'), 'no theme select');
  assert.ok(!/data-theme|prefers-color-scheme|--dark-/.test(source), 'no dark CSS');
  assert.match(source, /<meta name="color-scheme" content="light">/);
  assert.match(source, /<meta name="theme-color" content="#f4f8fc">/);
  const bootstrap = fs.readFileSync(fileURLToPath(new URL('../app/bootstrap.js', import.meta.url)), 'utf8');
  assert.ok(!/dataset\.theme|localStorage/.test(bootstrap), 'the boot shim neither reads storage nor sets a theme');
  for (const name of ['main.js', 'panels.js', 'settings.js']) {
    const text = read(name);
    assert.ok(!/THEMES|applyTheme|\$\('theme'\)/.test(text), `${name} has no theme plumbing`);
  }
  assert.ok(!Object.hasOwn(createSettingsStore(createFakeStorage(), CONTENT).get(), 'theme'));
  assert.equal(SCHEMA_VERSION, 2);
});

// ---------- LOOK-01: Daylight tokens, board states, the Practice stage (06-04) ----------
const style = () => { const source = html(); return source.slice(source.indexOf('<style>'), source.indexOf('</style>')); };
const rule = (css, selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `rule ${selector} exists`);
  return css.slice(at, css.indexOf('}', at) + 1);
};
const DAYLIGHT = [
  ['bg', '#f4f8fc'], ['sky', '#e3eefb'], ['surface', '#ffffff'], ['line', '#d6e1ee'], ['line-2', '#b7c7da'],
  ['ink', '#13233a'], ['ink-2', '#2c3e57'], ['muted', '#52637a'], ['cobalt', '#2a53c4'], ['cobalt-soft', '#dfe7fb'],
  ['marigold', '#ffb12e'], ['marigold-edge', '#a86a00'], ['marigold-soft', '#ffeac2'], ['rasp', '#bf2d60'],
  ['mint', '#1d7f55'], ['mint-ink', '#17694a'], ['mint-soft', '#d9f1e5'], ['danger', '#b3261e'],
  ['wood', '#f6efe4'], ['fret', '#c5b598'], ['string', '#7a6a52'], ['nut', '#13233a'], ['marker', '#e6dccb'],
];
const LEGACY = ['panel', 'text', 'border', 'accent', 'accent-text', 'note', 'note-text', 'ok', 'ok-text', 'danger-text', 'serif'];

test('LOOK-01: one :root declares every Daylight token with its exact hex', () => {
  const css = style();
  assert.equal((css.match(/:root \{/g) || []).length, 1, 'exactly one :root');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const [name, hex] of DAYLIGHT) assert.ok(root.includes(`--${name}: ${hex};`), `--${name}: ${hex}`);
  assert.match(root, /--geo: Futura, /, 'the geometric stack starts with Futura');
  for (const name of ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-12', 'space-16', 'r-sm', 'r-md', 'r-lg', 'r-pill', 'shadow-1', 'shadow-2', 'shadow-bar']) {
    assert.ok(root.includes(`--${name}:`), `--${name} declared`);
  }
});

test('LOOK-01: no legacy token, serif stack or web font remains, and body uses the geometric sans', () => {
  const source = html();
  for (const name of LEGACY) {
    assert.ok(!new RegExp(`--${name}\\s*:`).test(source), `--${name} is not declared`);
    assert.ok(!source.includes(`var(--${name})`), `var(--${name}) is not referenced`);
  }
  assert.ok(!/@font-face/.test(source), 'no @font-face');
  assert.ok(!/url\([^)]*\.(woff2?|ttf|otf)/.test(source), 'no font url');
  assert.match(style(), /\nbody \{ background: var\(--bg\); color: var\(--ink\); font: 500 16px\/1\.5 var\(--geo\);/);
  assert.ok(!/\n(html|body)[^{]*\{[^}]*overflow-x/.test(style()), 'no overflow-x on html or body');
});

test('LOOK-03: board states differ by shape or stroke, not colour alone', () => {
  const css = style();
  const dim = rule(css, '.note.dim');
  assert.match(dim, /dashed/);
  assert.ok(!/opacity/.test(dim), 'unlit notes are not faded');
  assert.match(rule(css, '.note.target'), /outline: 3px solid var\(--cobalt\); outline-offset: 3px;/);
  assert.match(rule(css, '.note.root'), /box-shadow: 0 0 0 2px var\(--surface\), 0 0 0 4px var\(--rasp\)/);
  assert.match(rule(css, '.note.open'), /border: 2px solid var\(--cobalt\)/);
  assert.match(rule(css, '.note'), /border: 1\.5px solid var\(--marigold-edge\)/);
  assert.match(css, /#board\.pulse-on \.note\.target \{ transform: translate\(-50%, -50%\) scale\(1\.18\); \}/, 'the beat pulse is kept');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #board\.pulse-on \.note\.target \{ transform: translate\(-50%, -50%\); \} \}/);
  assert.match(rule(css, '.cell:focus-visible'), /outline: 3px solid var\(--cobalt\); outline-offset: -4px;/);
});

test('LOOK-03: a legend under the neck names the four states with the real note classes', () => {
  const source = html();
  const start = source.indexOf('<div class="p-neck">');
  const neck = source.slice(start, source.indexOf('<div class="p-ctl">', start));
  assert.ok(neck.indexOf('class="board-legend"') > neck.indexOf('class="board-stage"'), 'the legend follows the board');
  const at0 = neck.indexOf('class="board-legend"');
  const legend = neck.slice(at0, neck.indexOf('</p>', at0));
  let at = -1;
  for (const label of ['Lit on guitar', 'Root', 'Not lit', 'Open string (no LED)']) {
    const next = legend.indexOf(label);
    assert.ok(next > at, `${label} in order`);
    at = next;
  }
  for (const cls of ['note legend-dot', 'note root legend-dot', 'note dim legend-dot', 'note open legend-dot']) {
    assert.ok(legend.includes(`<span class="${cls}" aria-hidden="true"></span>`), cls);
  }
});

test('NAV-02: Practice is one column below 1024px and a centred named-grid stage at 1024px+', () => {
  const css = style();
  assert.match(css, /\n#view-practice \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--space-6\); \}/);
  const media = [...css.matchAll(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).find(body => body.includes('grid-template-areas'));
  assert.ok(media, 'a 1024px rule holds the stage');
  assert.ok(media.includes('grid-template-areas: "head head" "lesson lesson" "neck neck" "coach ctl" "out out";'));
  assert.ok(media.includes('max-width: 1120px; margin: 0 auto;'));
  assert.ok(media.includes('grid-template-columns: minmax(0, 360px) minmax(0, 1fr);'));
  for (const [selector, area] of [['.p-head', 'head'], ['#lessonPanel', 'lesson'], ['.p-neck', 'neck'], ['.p-ctl', 'ctl'], ['.p-coach', 'coach'], ['.p-out', 'out']]) {
    assert.ok(media.includes(`${selector} { grid-area: ${area}; }`), `${selector} -> ${area}`);
  }
});

// ---------- LOOK-01: the type scale and the lesson diagrams (06-04) ----------
test('LOOK-01 type scale: only 12/16/20/40px and weights 500/700, shorthands and SVG text included', () => {
  const source = html();
  const css = style();
  const sizes = new Set([
    ...[...css.matchAll(/font-size: (\d+)px/g)].map(m => +m[1]),
    ...[...css.matchAll(/font: (?:\d+ )?(\d+)px\//g)].map(m => +m[1]),
  ]);
  for (const size of sizes) assert.ok([12, 16, 20, 40].includes(size), `font size ${size}px is off the scale`);
  assert.deepEqual([...sizes].sort((a, b) => a - b), [12, 16, 20, 40], 'all four sizes are in use');
  const weights = new Set([
    ...[...css.matchAll(/font-weight: (\d+)/g)].map(m => +m[1]),
    ...[...css.matchAll(/font: (\d+) \d+px\//g)].map(m => +m[1]),
    ...[...source.matchAll(/font-weight="(\d+)"/g)].map(m => +m[1]),
  ]);
  for (const weight of weights) assert.ok([500, 700].includes(weight), `font weight ${weight} is off the scale`);
});

test('LOOK-01 lesson diagrams: every figure is large enough for its 12px label', () => {
  const css = style();
  const px = (text, prop) => { const m = text.match(new RegExp(`(?:^|[ ;{])${prop}: (\\d+)px`)); assert.ok(m, `${prop} in ${text}`); return +m[1]; };
  const dot = rule(css, '.lesson-chord-dot');
  assert.ok(px(dot, 'width') >= 20 && px(dot, 'height') >= 20, 'chord dots are at least 20px');
  const badge = rule(css, '.lesson-scale-note i');
  assert.ok(px(badge, 'width') >= 18 && px(badge, 'height') >= 18, 'finger badges are at least 18px');
  for (const selector of ['.lesson-chord-open', '.lesson-chord-grid']) {
    const m = rule(css, selector).match(/repeat\(6, (\d+)px\)/);
    assert.ok(m && +m[1] >= 24, `${selector} columns are at least 24px`);
  }
  assert.ok(+rule(css, '.lesson-chord-grid').match(/grid-template-rows: repeat\(5, (\d+)px\)/)[1] >= 24, 'chord rows are at least 24px');
  for (const selector of ['.lesson-scale-row', '.lesson-scale-frets']) {
    const m = rule(css, selector).match(/grid-template-columns: (\d+)px /);
    assert.ok(m && +m[1] >= 24, `${selector} label column is at least 24px`);
  }
  assert.ok(!html().includes('#e7a26c'), 'no stray orange in the path current step');
});

// ---------- LOOK-01 controls and the navigation chrome (06-05) ----------
const mediaBodies = (css, query) => [...css.matchAll(new RegExp(`@media \\(${query.replace(/[()]/g, '\\$&')}\\) \\{([\\s\\S]*?)\\n\\}`, 'g'))].map(m => m[1]);

test('LOOK-01 controls: form fields ring in --muted, buttons in --line-2, .cta and .danger-fill share the 48px box', () => {
  const css = style();
  const field = rule(css, 'select, input[type=number]');
  assert.match(field, /box-shadow: inset 0 0 0 1\.5px var\(--muted\);/, 'form-field ring is --muted [D:inputborder]');
  assert.ok(!/--line-2/.test(field), 'never the 1.72:1 --line-2 on a form field');
  assert.match(field, /min-height: 44px;/);
  assert.match(field, /border-radius: 8px;/);
  const button = rule(css, 'button');
  assert.match(button, /box-shadow: inset 0 0 0 1\.5px var\(--line-2\);/);
  assert.match(button, /border-radius: 16px;/);
  assert.match(button, /font-weight: 700;/);
  for (const selector of ['.cta', '.danger-fill']) {
    const box = rule(css, selector);
    assert.match(box, /min-height: 48px; padding: 0 var\(--space-6\); border-radius: 16px;/, `${selector} box`);
    assert.match(box, /box-shadow: none;/, `${selector} has no ring`);
  }
  assert.match(rule(css, '.cta'), /background: var\(--cobalt\); color: var\(--surface\);/);
  assert.match(rule(css, '.text-button'), /text-underline-offset: 4px;/);
  assert.match(rule(css, 'input[type=checkbox]'), /accent-color: var\(--cobalt\);/);
  assert.match(css, /\nbutton:disabled, select:disabled, input:disabled \{ opacity: \.45; cursor: default; \}/);
  // Segmented controls select in ink with white text, never the cobalt action fill.
  assert.match(css, /\n\.tabs \[role=tab\]\[aria-selected="true"\], \.family-picker \[role=radio\]\[aria-checked="true"\] \{ background: var\(--ink\); color: var\(--surface\); box-shadow: none; \}/);
  const banner = rule(css, '.pause-banner');
  assert.match(banner, /background: var\(--sky\);/);
  assert.match(banner, /border-left: 4px solid var\(--muted\);/);
  assert.match(banner, /border-radius: 16px;/);
});

test('LOOK-01 controls: a 3px focus ring everywhere, white on the ink tab bar, and 44px coarse targets', () => {
  const css = style();
  assert.match(css, /\n:focus-visible \{ outline: 3px solid var\(--cobalt\); outline-offset: 2px; \}/);
  assert.match(css, /\n\.tabbar :focus-visible \{ outline: 3px solid #fff; outline-offset: 2px; \}/);
  assert.ok(!/:focus-visible[^{]*\{[^}]*outline: [12]px/.test(css), 'no thinner focus ring is left');
  const coarse = mediaBodies(css, 'pointer: coarse').find(body => body.includes('#moreBtn'));
  assert.ok(coarse, 'a coarse-pointer floor rule exists');
  assert.match(coarse, /button, select, input\[type=number\], \[role=tab\][^{]*#connectBtn, #moreBtn \{ min-height: 44px; \}/);
  assert.match(coarse, /#moreBtn, #closeMore \{ min-width: 44px; \}/);
  // The floor is the last rule in the stylesheet, so no earlier box can undercut it.
  assert.ok(css.lastIndexOf('@media (pointer: coarse)') > css.lastIndexOf('@media (min-width: 1024px)'));
});

test('LOOK-01 nav chrome: sticky blurred appbar with the logo, ink tab bar, ink pills, pill label sizes', () => {
  const source = html();
  const css = style();
  const appbar = rule(css, 'header.appbar');
  assert.match(appbar, /position: sticky; top: 0; z-index: 20;/);
  assert.match(appbar, /background: rgba\(244,248,252,\.94\); backdrop-filter: blur\(8px\);/);
  assert.match(source, /<header class="appbar">\s*<h1 class="logo"><svg width="28" height="28"[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span class="wordmark">Guitar Coach<\/span><\/h1>/);
  const narrow = mediaBodies(css, 'max-width: 479px').find(body => body.includes('.wordmark'));
  assert.ok(narrow && /clip: rect\(0,0,0,0\)/.test(narrow) && !/display: none/.test(narrow), 'the wordmark is clipped, not removed, below 480px');
  const desk = mediaBodies(css, 'min-width: 1024px').find(body => body.includes('header.appbar'));
  assert.ok(desk && desk.includes('header.appbar { padding: var(--space-4) var(--space-8); }'));
  assert.ok(desk.includes('nav.pills { position: absolute; left: 50%;'), 'pills are centred');
  assert.match(rule(css, '.tabbar [role=tablist]'), /background: var\(--ink\); border-radius: 24px; box-shadow: var\(--shadow-bar\);/);
  assert.match(rule(css, '.tabbar [role=tab]'), /min-height: 56px;[^}]*color: #b9c6da;/);
  assert.match(css, /\n\.tabbar \[role=tab\]\[aria-selected="true"\] \{ background: var\(--surface\); color: var\(--ink\); \}/);
  assert.match(css, /\n\.pills \[role=tab\]\[aria-selected="true"\] \{ background: var\(--ink\); color: var\(--surface\); \}/);
  assert.match(rule(css, '.pills [role=tablist]'), /box-shadow: inset 0 0 0 1\.5px var\(--line\);/);
  assert.match(rule(css, '#connectBtn'), /box-shadow: inset 0 0 0 1\.5px var\(--line-2\);/);
  assert.match(css, /\n#connLabel \{ font-size: 12px; font-weight: 700; \}/);
  assert.match(css, /@media \(min-width: 1024px\) \{ #connLabel \{ font-size: 16px; \} \}/);
});

test('LOOK-01 More sheet: slides up 200ms on phone, never under reduced motion, no slide on desktop', () => {
  const css = style();
  assert.match(css, /\n#moreSheet\[open\] \{ animation: sheet-up 200ms ease-out; \}/);
  assert.match(css, /@keyframes sheet-up \{ from \{ transform: translateY\(100%\); \} to \{ transform: none; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #moreSheet\[open\] \{ animation: none; \} \}/);
  const desk = mediaBodies(css, 'min-width: 1024px').find(body => body.includes('#moreSheet {'));
  assert.ok(desk && desk.includes('#moreSheet[open] { animation: none; }'), 'the desktop panel does not slide');
  assert.match(rule(css, '.more-body'), /calc\(var\(--space-6\) \+ env\(safe-area-inset-bottom\)\)/);
});

// ---------- Views: Today, Progress, Library and the Progress empty state (06-05) ----------
test('views: an empty Progress offers Open Today, routed through the one switcher', () => {
  const source = html();
  const progress = viewSlice(source, 'progress');
  const empty = progress.slice(progress.indexOf('id="progressEmpty"'), progress.indexOf('</div>', progress.indexOf('id="progressEmpty"')));
  assert.match(empty, /<h3>Nothing recorded yet<\/h3>/);
  assert.ok(empty.includes('<p>Finish a drill and your minutes, streak and mastery appear here. Everything stays in this browser.</p>'), 'the UI-SPEC body sentence');
  assert.ok(empty.includes('<button type="button" class="text-button" id="openToday">Open Today</button>'));
  assert.ok(empty.indexOf('id="openToday"') > empty.indexOf('Everything stays in this browser.'), 'the action follows the body');
  const panels = read('panels.js');
  assert.match(panels, /\$\('openToday'\)\.addEventListener\('click', \(\) => onView\('today'\)\)/);
  const seen = [];
  withPanels(({ listeners, byId }) => {
    const clicks = listeners.filter(l => l.node === byId.get('openToday') && l.type === 'click');
    assert.equal(clicks.length, 1, 'one click listener on Open Today');
    clicks[0].handler({});
  }, { handlers: { onView: name => seen.push(name) } });
  assert.deepEqual(seen, ['today']);
});

test('views: Today, Progress and Library are centred at 640/768/640px from 1024px, and no page-level overflow-x', () => {
  const css = style();
  const desk = mediaBodies(css, 'min-width: 1024px').find(body => body.includes('#view-progress { max-width'));
  assert.ok(desk, 'a 1024px rule holds the view widths');
  for (const [view, width] of [['today', 640], ['progress', 768], ['library', 640]]) {
    assert.ok(desk.includes(`#view-${view} { max-width: ${width}px; }`), `#view-${view} max-width ${width}`);
  }
  assert.ok(desk.includes('.progress-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }'), 'four tiles across at 1024px+');
  assert.match(css, /\n#view-today, #view-progress, #view-library \{ width: 100%; margin: 0 auto; \}/);
  assert.match(css, /\n\.progress-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/, '2 x 2 tiles below 1024px');
  assert.match(rule(css, '.progress-tiles > div'), /border-radius: 16px; box-shadow: var\(--shadow-1\);/);
  assert.ok(!/(^|\n)\s*(html|body)[^{]*\{[^}]*overflow-x/.test(css), 'no overflow-x on html or body');
});

test('views: Library card fields stack on phone and pair at 640px; long titles wrap; block chips follow state', () => {
  const css = style();
  assert.match(rule(css, '.library-card .controls'), /grid-template-columns: minmax\(0, 1fr\);/);
  const wide = mediaBodies(css, 'min-width: 640px').find(body => body.includes('.library-card'));
  assert.ok(wide && wide.includes('.library-card .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }'));
  assert.ok(wide.includes('#libraryCta { width: auto;'), 'the CTA is auto width at 640px+');
  assert.match(css, /\n#libraryCta \{ width: 100%; \}/, 'the CTA is full width on phone');
  for (const selector of ['.workspace-title', '.session-block-name', '.session-block-reason', '.library-card .controls label']) {
    assert.match(rule(css, selector), /overflow-wrap: anywhere;/, `${selector} wraps`);
  }
  assert.match(css, /\n\.session-block-state\[data-state="now"\] \{ background: var\(--cobalt\); color: var\(--surface\); \}/);
  assert.match(css, /\n\.session-block-state\[data-state="done"\] \{ background: var\(--mint-soft\); color: var\(--mint-ink\); \}/);
  assert.match(read('panels.js'), /if \(label\) state\.dataset\.state = source\.state;/);
});

// ---------- LOOK-03 contrast: WCAG 2.x ratios computed from the :root hexes (06-05) ----------
const rootTokens = () => {
  const css = style();
  const block = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/gi)].map(m => [m[1], m[2].toLowerCase()]));
};
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('LOOK-03 contrast: the luminance formula matches the WCAG reference points', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01, '#767676 on white is the classic 4.54:1');
});

test('LOOK-03 contrast: every text pair the UI uses meets 4.5:1', () => {
  const t = rootTokens();
  const hex = name => (name.startsWith('#') ? name : t[name]);
  const TEXT = [
    ['ink', 'bg'], ['ink', 'surface'], ['ink-2', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'sky'],
    ['surface', 'cobalt'], ['cobalt', 'surface'], ['cobalt', 'sky'], ['cobalt', 'cobalt-soft'], ['surface', 'rasp'],
    ['ink', 'marigold'], ['mint', 'surface'], ['mint-ink', 'mint-soft'], ['surface', 'danger'], ['danger', 'surface'],
    ['#b9c6da', 'ink'],
  ];
  for (const [fg, bg] of TEXT) {
    assert.ok(hex(fg) && hex(bg), `${fg} and ${bg} are declared`);
    const ratio = contrast(hex(fg), hex(bg));
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test('LOOK-03 contrast: every non-text pair meets 3:1 (board marks on wood, field ring, banner edge)', () => {
  const t = rootTokens();
  const NON_TEXT = [
    ['marigold-edge', 'wood'], ['muted', 'wood'], ['cobalt', 'wood'], ['rasp', 'wood'],
    ['muted', 'surface'], ['muted', 'sky'],
  ];
  for (const [fg, bg] of NON_TEXT) {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= 3, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 3:1`);
  }
  // Why form fields ring in --muted: --line-2 on surface fails the 3:1 non-text floor [D:inputborder].
  assert.ok(contrast(t['line-2'], t.surface) < 3, '--line-2 is decorative only');
});

test('LOOK-03 contrast: the forbidden pairs never appear in a rule', () => {
  const t = rootTokens();
  const css = style();
  assert.ok(contrast(t.mint, t['mint-soft']) < 4.5, 'mint on mint-soft is below 4.5:1, so it is never text');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }));
  for (const { selector, body } of rules) {
    if (/background: var\(--mint-soft\)/.test(body)) {
      assert.ok(!/(^|[ ;])color: var\(--mint\)/.test(body), `${selector} sets mint text on mint-soft`);
    }
    if (/(^|[\s,])\.note\b/.test(selector)) {
      assert.ok(!body.includes('var(--line-2)'), `${selector} uses the 1.72:1 --line-2 on the board`);
    }
  }
});

test('KEEP-04: the offline release is v25, bumped once after the final shell change', () => {
  const sw = fs.readFileSync(fileURLToPath(new URL('../app/sw.js', import.meta.url)), 'utf8');
  assert.match(sw, /const CACHE = CACHE_PREFIX \+ 'v25';/);
  assert.ok(!sw.includes("CACHE_PREFIX + 'v24'"), 'the v24 release is gone');
});
