// ---------- Phase 6 shell ----------
// The four-view shell: the settings allow-list, the one view painter over both tablists, the one
// switcher in main, the run lock, the Today badge and the view's round-trip through storage.
// No DOM: panels are driven through a stub document, and main is read as source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSettingsStore, VIEWS, SCHEMA_VERSION } from '../app/src/settings.js';
import { createPanels, NAV_VIEWS, CTA_LABEL, MIC_ACTIONS, connectionView, reportPendingOf } from '../app/src/panels.js';
import {
  scaleById, chordById, chordPairById, progressionById, songById, SONGS, SCALES, CHORD_PAIRS, CHORD_FAMILIES, PROGRESSIONS,
} from '../app/src/content.js';
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
  assert.match(body, /if \(name === 'today'\) enterToday\(\{ announce \}\);/);
  // IN-03: the boot restore is not a view entry, so it never voices the coach line.
  assert.match(main, /switchView\(settings\.view, \{ scroll: false, persist: false, announce: false \}\);/);
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
  assert.match(library, /<section id="tabpanel" role="tabpanel" aria-labelledby="tab-songs" class="library-card" tabindex="0">/);
  // 10-02: the Library opens on Songs, so the CTA names the song it opens.
  assert.match(library, /<button type="button" class="cta" id="libraryCta">Open this song<\/button>/);
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
  // 09-01: the v1 "Start at the top." sentence became the coach thread and its one Continue.
  assert.ok(!today.includes('Start at the top'), 'the old greeting paragraph is gone');
  const greeting = today.slice(today.indexOf('today-greeting'), today.indexOf('id="sessionPanel"'));
  assert.match(greeting, /<ol class="coach-thread" id="coachThread"><\/ol>/);
  assert.match(greeting, /<button type="button" class="cta" id="coachContinue" hidden>Continue<\/button>/);
  assert.match(greeting, /<span class="coach-avatar" aria-hidden="true">/);
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
  // 10-02: Change in Library opens the Library tab of the loaded item, so it has its own callback.
  assert.match(panels, /if \(\$\('changeInLibrary'\)\) \$\('changeInLibrary'\)\.addEventListener\('click', \(\) => onChangeInLibrary\(\)\);/);
});

test('the CTA label follows the family tab, written with textContent', () => {
  // 10-02, 10 IN-06: songs, progressions and chords open their browse subject, not a drill, so their CTA says Open.
  assert.deepEqual(CTA_LABEL, {
    scales: 'Practise this scale', chords: 'Open this chord',
    progressions: 'Open this progression', songs: 'Open this song',
  });
  withPanels(({ panels, byId }) => {
    panels.select('chords', false, false);
    assert.equal(byId.get('libraryCta').textContent, 'Open this chord');
    panels.select('songs', false, false);
    assert.equal(byId.get('libraryCta').textContent, 'Open this song');
  });
  assert.match(read('panels.js'), /\$\('libraryCta'\)\.textContent = CTA_LABEL\[tab\]/);
});

// ---------- NAV-04: the More sheet (06-03) ----------
// WR-04: a run-guarded picker in Library is disabled while a pass plays, never silently ignored.
test('WR-04: every Key select and the selection pickers are disabled while a pass plays', () => {
  withPanels(({ panels, byId }) => {
    const ids = ['key', 'scale', 'position', 'direction', 'progressionKey', 'songKey', 'playKey'];
    // 10-02: every Library card is disabled too, while the four content tabs stay browsable.
    const cards = ['songCards', 'scaleCards', 'chordCards', 'progressionCards'].flatMap(list => cardsIn(byId, list));
    const tabs = ['tab-songs', 'tab-scales', 'tab-chords', 'tab-progressions'];
    assert.ok(cards.length > 0);
    panels.setDrill({ phase: 'active' });
    for (const id of ids) assert.equal(byId.get(id).disabled, true, `${id} is locked during a pass`);
    for (const card of cards) assert.equal(card.disabled, true, `${card.dataset.id} card is locked during a pass`);
    for (const id of tabs) assert.equal(byId.get(id).disabled, false, `${id} stays usable during a pass`);
    // 10-03: every search result row locks with the cards; the search field stays usable.
    const rows = ['searchSongs', 'searchScales', 'searchChords', 'searchProgressions'].flatMap(list => findAll(byId.get(list), 'search-row'));
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(row.disabled, true, `${row.dataset.id} result is locked during a pass`);
    assert.equal(byId.get('librarySearch').disabled, false, 'the search field stays usable during a pass');
    panels.setDrill({ phase: 'idle' });
    for (const id of ids) assert.equal(byId.get(id).disabled, false, `${id} is live again at idle`);
    for (const card of cards) assert.equal(card.disabled, false, `${card.dataset.id} card is live again at idle`);
    for (const row of rows) assert.equal(row.disabled, false, `${row.dataset.id} result is live again at idle`);
  });
});

// 10 CR-01: every Library picker or button that can move the run's subject locks while the stage
// is owned. Labels only repaint the shown pass and the power-chord Learn button opens reading
// material, so those two stay live; anything else added under #controls-* must lock.
test('10 CR-01: every subject picker and button under #controls-* is disabled while a pass owns the stage', () => {
  const source = html();
  const ids = [];
  for (const tab of ['scales', 'chords', 'progressions', 'songs']) {
    const start = source.indexOf(`id="controls-${tab}"`);
    assert.ok(start > 0, `controls-${tab} exists`);
    const next = source.indexOf('id="controls-', start + 1);
    const block = source.slice(start, next > start ? next : source.indexOf('id="libraryCta"', start));
    for (const m of block.matchAll(/<(?:select|button)\b[^>]*\bid="([^"]+)"/g)) ids.push(m[1]);
  }
  const live = ['labels', 'powerChordLearn'];
  const locked = ids.filter(id => !live.includes(id));
  for (const id of ['song', 'songKey', 'playSong', 'progression', 'progressionKey', 'playProgression', 'chord', 'voicing']) {
    assert.ok(locked.includes(id), `${id} is a Library picker`);
  }
  withPanels(({ panels, byId }) => {
    for (const phase of ['countIn', 'active', 'paused', 'passReview']) {
      panels.setDrill({ phase: 'idle' });
      panels.setDrill({ phase, streaks: {} });
      for (const id of locked) assert.equal(byId.get(id).disabled, true, `${id} is locked at ${phase}`);
    }
    panels.setDrill({ phase: 'result' });
    for (const id of locked) assert.equal(byId.get(id).disabled, false, `${id} is live again at the result`);
  });
  // Defence in depth: the DOM disabled state is not the authority, applyChange refuses too.
  assert.match(read('main.js'),
    /if \(stageOwned\(\) && \['songId', 'progressionId', 'chordId', 'voicingId'\]\.includes\(field\)\) return;/);
});

// 10 IN-07: a completed recall still waiting for its self-report keeps its result. Cards, search
// rows and the two Play buttons lock (they would close the result); the pickers and the CTA stay
// live, and main refuses the opens and keeps the CTA to a view switch.
test('10 IN-07: a pending recall self-report locks Library opens, never the pickers', () => {
  const recall = report => ({ attempted: true, completed: true, selfReport: report, bpm: 80 });
  assert.equal(reportPendingOf({ recall: recall(null) }), true);
  for (const done of ['clean', 'shaky']) assert.equal(reportPendingOf({ recall: recall(done) }), false);
  assert.equal(reportPendingOf({ recall: { attempted: true, completed: false, selfReport: null } }), false, 'a guided recall never waits');
  assert.equal(reportPendingOf(null), false);
  withPanels(({ panels, byId }) => {
    const cards = ['songCards', 'scaleCards', 'chordCards', 'progressionCards'].flatMap(list => cardsIn(byId, list));
    const rows = ['searchSongs', 'searchScales', 'searchChords', 'searchProgressions'].flatMap(list => findAll(byId.get(list), 'search-row'));
    const summary = report => ({ startLevel: 3, passes: [], recall: recall(report), withHints: { passes: [], clean: 0, endedAtLevel: 3 } });
    panels.setDrill({ phase: 'result', summary: summary(null) });
    for (const node of [...cards, ...rows]) assert.equal(node.disabled, true, `${node.dataset.id} is locked while the report waits`);
    for (const id of ['playSong', 'playProgression']) assert.equal(byId.get(id).disabled, true, `${id} is locked while the report waits`);
    for (const id of ['song', 'progression', 'chord', 'key']) assert.equal(byId.get(id).disabled, false, `${id} only picks, so it stays live`);
    assert.equal(byId.get('libraryCta').disabled, false, 'the CTA stays live: it only switches view');
    panels.setDrill({ phase: 'result', summary: summary('clean') });
    for (const node of [...cards, ...rows]) assert.equal(node.disabled, false, `${node.dataset.id} opens again once reported`);
    for (const id of ['playSong', 'playProgression']) assert.equal(byId.get(id).disabled, false);
  });
  const main = read('main.js');
  assert.match(main, /const reportPending = \(\) => !!\(run && run\.phase === 'result'\) && reportPendingOf\(run\);/);
  assert.match(fnBody(main, 'openItem'), /if \(stageOwned\(\) \|\| reportPending\(\)\) return;/);
  assert.match(fnBody(main, 'playFromLibrary'), /^function playFromLibrary\(family, id\) \{\n  if \(reportPending\(\)\) return;/);
  assert.match(fnBody(main, 'practiseSelection'), /if \(!stageOwned\(\) && !reportPending\(\)\) \{/);
});

// v2.0 WARN-2: the IN-07 lock covered Library only. Every other path that would replace or close
// a recall result still waiting for its Clean/Shaky report refuses through one guard, with the
// reason on the feedback line and the one live region. Giving the report releases it; the result
// screen's own Repeat and Back stay live (they are the explicit choice on the result itself).
test('v2.0 WARN-2: a pending recall self-report refuses Today, Progress, the session and every seed', () => {
  const main = read('main.js');
  assert.match(main, /const REPORT_LOCK_FEEDBACK = 'Rate the no-light pass first: Clean or Shaky\.';/);
  const lock = fnBody(main, 'reportLocked');
  assert.match(lock, /if \(!reportPending\(\)\) return false;\s*panels\.setFeedback\(REPORT_LOCK_FEEDBACK\);\s*panels\.announce\(REPORT_LOCK_FEEDBACK\);\s*return true;/);
  assert.match(fnBody(main, 'switchView'),
    /if \(\(name === 'today' \|\| name === 'progress'\) && reportLocked\(\)\) return false;/);
  const guarded = ['startSession', 'startSessionAt', 'sessionPick', 'practiseSkill', 'seedPair', 'seedFamily',
    'seedNextItem', 'seedPlayAlong', 'startGuidedLesson'];
  for (const name of guarded) {
    const whole = fnBody(main, name);
    const body = whole.slice(whole.indexOf('{'));
    const at = body.indexOf('reportLocked()');
    assert.ok(at > 0, `${name} refuses while a recall report waits`);
    for (const closer of ['backToBrowse()', 'startDrill(', 'sessionReduce(', 'dispatchSession(', 'startSessionAt(', 'save(']) {
      const call = body.indexOf(closer);
      if (call >= 0) assert.ok(at < call, `${name} checks the lock before ${closer}`);
    }
  }
  // Every remaining backToBrowse/startDrill caller is either guarded above, a result-screen control
  // (onTransport: Repeat, Back) or reachable only after the guard (openItem, seedBlock via the session).
  const callers = new Set();
  for (const fn of main.matchAll(/\n(?:async )?function (\w+)\(/g)) {
    const body = fnBody(main, fn[1]);
    const code = body.slice(body.indexOf('{')).replace(/\/\/[^\n]*/g, '');
    if (/backToBrowse\(\)|startDrill\(/.test(code)) callers.add(fn[1]);
  }
  callers.delete('backToBrowse');
  callers.delete('startDrill');
  const allowed = new Set([...guarded, 'openItem', 'seedBlock', 'onTransport']);
  for (const name of callers) assert.ok(allowed.has(name), `${name} closes or replaces a result: guard it or list it`);
  // The lock releases on the report itself: the predicate reads the recall's own selfReport.
  const recall = report => ({ phase: 'result', recall: { attempted: true, completed: true, selfReport: report, bpm: 80 } });
  assert.equal(reportPendingOf(recall(null)), true);
  assert.equal(reportPendingOf(recall('clean')), false);
  assert.equal(reportPendingOf(recall('shaky')), false);
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

test('NECK-01: the vertical board CSS', () => {
  const css = style();
  const board = rule(css, '#board');
  assert.ok(board.includes('grid-template-columns: 32px repeat(6, minmax(0, 1fr))'), 'seven columns: fret numbers + six strings');
  assert.ok(board.includes('grid-auto-rows: var(--fret-row)'), 'one row per fret');
  assert.ok(!board.includes('max-content'), 'the board shrinks to fit its column');
  assert.ok(!css.includes('repeat(19'), 'no 19-column override remains');
  const wrap = rule(css, '.board-wrap');
  assert.ok(wrap.includes('overflow: auto'));
  assert.ok(wrap.includes('max-height: calc(28px + var(--fret-row) * 13.5)'), 'frets 0-12 fit the box');
  const coarse = [...css.matchAll(/@media \(pointer: coarse\) \{([^@]*)/g)].map(m => m[1]).join('\n');
  assert.ok(coarse.includes('--fret-row: 44px'), 'coarse pointers get 44px rows');
  assert.ok(rule(css, '.num.head').includes('position: sticky'));
  assert.ok(rule(css, '.cell').includes('border-bottom: 3px solid var(--fret)'));
});

test('WR-03: focus-driven scrolling reserves the sticky string header so a focused cell is never under it', () => {
  const css = style();
  const head = rule(css, '.num.head').match(/height: (\d+)px/);
  assert.ok(head, 'the sticky header has a fixed height');
  const wrap = rule(css, '.board-wrap');
  assert.ok(wrap.includes(`scroll-padding-top: ${head[1]}px`), 'scroll-padding-top equals the header height');
  assert.ok(wrap.includes('scroll-padding-bottom:'), 'a bottom margin for focus moving down the neck');
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

test('NAV-02: Practice is one column below 1024px and coach | vertical neck | controls at 1024px+', () => {
  const css = style();
  assert.match(css, /\n#view-practice \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--space-6\); \}/);
  const media = [...css.matchAll(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).find(body => body.includes('grid-template-areas'));
  assert.ok(media, 'a 1024px rule holds the stage');
  assert.ok(media.includes('grid-template-areas: "head head head" "lesson lesson lesson" "coach neck ctl" "out out out";'));
  assert.ok(media.includes('max-width: 1120px; margin: 0 auto;'));
  assert.ok(media.includes('grid-template-columns: minmax(0, 1fr) minmax(320px, 380px) minmax(0, 1fr);'));
  for (const [selector, area] of [['.p-head', 'head'], ['#lessonPanel', 'lesson'], ['.p-neck', 'neck'], ['.p-ctl', 'ctl'], ['.p-coach', 'coach'], ['.p-out', 'out']]) {
    assert.ok(media.includes(`${selector} { grid-area: ${area}; }`), `${selector} -> ${area}`);
  }
  // The desktop neck box grows toward the viewport height; the 13.5-row box stays the floor.
  assert.match(media, /\.p-neck \.board-wrap \{ max-height: max\([^;]*100dvh[^;]*\); \}/);
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
    // 08-03: the dimmer readout sits on --sky (numbers ink, passes-left and the where line ink-2).
    ['ink', 'sky'], ['ink-2', 'sky'],
    // 09-03: the owned-neck legend labels and family count lines sit beside the shades, on
    // --surface, never on a shade.
    ['ink-2', 'surface'], ['ink', 'surface'],
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
    // 08-03: the lit lamp's stroke carries the 3:1 edge that marigold alone (1.81:1) cannot.
    ['marigold-edge', 'surface'],
    // 09-03: owned-neck cells carry a --muted edge (pinned above as muted on wood) and the
    // No lights fill must read against the bare wood on its own.
    ['mint', 'wood'],
  ];
  for (const [fg, bg] of NON_TEXT) {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= 3, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 3:1`);
  }
  // Why form fields ring in --muted: --line-2 on surface fails the 3:1 non-text floor [D:inputborder].
  assert.ok(contrast(t['line-2'], t.surface) < 3, '--line-2 is decorative only');
});

// WR-05: the owned neck's four shades. Each fill reads 3:1+ against the bare wood, and the light
// dots (wood-coloured) read 3:1+ on every fill. Colour alone cannot also put 3:1 between each
// adjacent level, so any adjacent pair below 3:1 must differ in its dot count.
test('WR-05 contrast: owned-neck shades read against the wood and adjacent levels differ by a non-colour cue', () => {
  const t = rootTokens();
  const css = style();
  const dotsOf = level => {
    const rule = css.match(new RegExp(`\\.own-swatch\\[data-level="${level}"\\] \\{([^}]*)\\}`));
    assert.ok(rule, `level ${level} rule`);
    assert.match(rule[1], new RegExp(`background-color: var\\(--own-${level}\\);`));
    return (rule[1].match(/radial-gradient\([^)]*var\(--wood\)[^)]*\)/g) || []).length;
  };
  const dots = [0, 1, 2, 3].map(dotsOf);
  assert.deepEqual(dots, [3, 2, 1, 0], 'lights left = dots: Full pattern 3, Anchors 2, Hint 1, No lights none');
  for (let level = 0; level <= 3; level += 1) {
    const fill = t[`own-${level}`];
    assert.ok(fill, `--own-${level} is a :root token`);
    const ratio = contrast(fill, t.wood);
    assert.ok(ratio >= 3, `--own-${level} on wood is ${ratio.toFixed(2)}:1, below 3:1`);
  }
  for (let level = 0; level < 3; level += 1) {
    const ratio = contrast(t[`own-${level}`], t[`own-${level + 1}`]);
    assert.ok(ratio >= 3 || dots[level] !== dots[level + 1], `levels ${level} and ${level + 1} need 3:1 or a different dot count`);
  }
  // The levels darken monotonically, so greyscale still orders them.
  for (let level = 0; level < 3; level += 1) {
    assert.ok(luminance(t[`own-${level}`]) > luminance(t[`own-${level + 1}`]), `--own-${level} is lighter than --own-${level + 1}`);
  }
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

test('KEEP-04: the offline release is v34, bumped for the v2.0 audit fixes', () => {
  const sw = fs.readFileSync(fileURLToPath(new URL('../app/sw.js', import.meta.url)), 'utf8');
  assert.match(sw, /const CACHE = CACHE_PREFIX \+ 'v34';/);
  assert.ok(!sw.includes("CACHE_PREFIX + 'v33'"), 'the v33 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v32'"), 'the v32 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v31'"), 'the v31 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v30'"), 'the v30 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v29'"), 'the v29 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v28'"), 'the v28 release is gone');
  assert.ok(!sw.includes("CACHE_PREFIX + 'v27'"), 'the v27 release is gone');
});

// ---------- 08-03: thumb row styling (FADE-07/10) ----------
const THUMB_BANNER = '/* ---------- Thumb row (08-03) ---------- */';
const thumbBlock = () => {
  const css = style();
  const at = css.indexOf(THUMB_BANNER);
  assert.ok(at >= 0, 'the Thumb row (08-03) block exists');
  const end = css.indexOf('/* ----------', at + THUMB_BANNER.length);
  return end > at ? css.slice(at, end) : css.slice(at);
};
// The one rule for a selector inside the block (IN-03 merged the 08-02 layout into the 08-03 look).
const blockRule = (block, selector) => {
  const at = block.lastIndexOf(`\n${selector} {`);
  assert.ok(at >= 0, `08-03 rule ${selector} exists`);
  return block.slice(at, block.indexOf('}', at) + 1);
};

test('IN-03: every thumb-row selector is declared once, layout and look in one rule', () => {
  const css = style();
  for (const selector of ['.thumb-row', '.thumb', '.thumb > *', '.dimmer-caption', '.dimmer-lamps', '.dimmer-lamp',
    '.dimmer-readout', '.dimbtn', '.dimbtn.dark', '.dimbtn[aria-disabled="true"]', '.start-ring']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = css.match(new RegExp(`\\n${escaped} \\{`, 'g')) || [];
    assert.equal(rules.length, 1, `${selector} has ${rules.length} top-level rules`);
  }
  const lamp = blockRule(thumbBlock(), '.dimmer-lamp');
  assert.match(lamp, /display: grid;[^}]*flex: 0 1 62px;/, 'layout and look share the rule');
});

test('FADE-07 thumb row: Brighter and Darker are push buttons at least 44px tall', () => {
  const dimbtn = blockRule(thumbBlock(), '.dimbtn');
  const height = dimbtn.match(/min-height: (\d+)px/);
  assert.ok(height, '.dimbtn declares a px min-height');
  assert.ok(Number(height[1]) >= 44, `.dimbtn min-height ${height[1]}px is below the 44px target`);
  assert.match(dimbtn, /border-radius: 24px;/);
  assert.match(blockRule(thumbBlock(), '.dimbtn.dark'), /background: var\(--ink\); color: var\(--surface\);/);
  assert.match(blockRule(thumbBlock(), '.dimbtn[aria-disabled="true"]'), /opacity: \.45;/);
});

test('FADE-07 thumb row: the Start ring is a square whose buttons are circles, below session-open', () => {
  const block = thumbBlock();
  const ring = blockRule(block, '.start-ring');
  const width = ring.match(/width: (\d+)px/); const height = ring.match(/height: (\d+)px/);
  assert.ok(width && height && width[1] === height[1], '.start-ring width equals height');
  // Every resized ring (media rules in the block) stays square too.
  for (const m of block.matchAll(/\.start-ring \{ width: (\d+)px; height: (\d+)px;/g)) assert.equal(m[1], m[2]);
  const buttons = blockRule(block, '.start-ring > button');
  assert.match(buttons, /border-radius: 50%;/);
  assert.match(buttons, /width: 100%; height: 100%;/);
  // (0,1,1) never outranks the accent-rule-3 neutral Start at (2,1,0).
  assert.match(style(), /#appShell\.session-open #startDrill \{ background: var\(--surface\);/);
});

test('FADE-07 thumb row: spacing is token-only and radii stay on the 8/16/24/50% scale', () => {
  const block = thumbBlock().replace(/\/\*[^]*?\*\//g, '');
  const spacing = [...block.matchAll(/(?:^|[ ;{])((?:gap|margin|padding)(?:-[a-z]+)?): ([^;}]+)/g)];
  assert.ok(spacing.length >= 5, 'the block sets its own spacing');
  for (const [, prop, value] of spacing) {
    for (const part of value.trim().split(/\s+/)) {
      assert.ok(/^var\(--space-\d+\)$/.test(part) || part === '0', `${prop}: ${value} uses a raw value`);
    }
  }
  const radii = [...block.matchAll(/border-radius: ([^;}]+)/g)].map(m => m[1].trim());
  assert.ok(radii.length >= 3);
  for (const radius of radii) assert.ok(['8px', '16px', '24px', '50%'].includes(radius), `border-radius ${radius} is off the scale`);
  assert.ok(!html().includes('overflow-x: hidden'), 'no horizontal clipping on html or body');
});

test('FADE-07 lamps: unlit outlined --muted, lit marigold with a --marigold-edge stroke, current named in ink', () => {
  const block = thumbBlock();
  assert.match(block, /\n\.lamp-glow \{ fill: none; \} \.lamp-bulb \{ fill: var\(--surface\); stroke: var\(--muted\);/);
  assert.match(block, /\.dimmer-lamp\.lit \.lamp-bulb \{ fill: var\(--marigold\); stroke: var\(--marigold-edge\);/);
  assert.match(blockRule(block, '.dimmer-lamp.current .dimmer-lamp-name'), /font-size: 12px; font-weight: 700; color: var\(--ink\);/);
  assert.ok(!/stroke: var\(--ink\)/.test(block.match(/\.dimmer-lamp\.lit \.lamp-bulb \{[^}]*\}/)[0]), 'the 08-02 ink stroke is replaced');
});

test('FADE-10 readout: 40px ink numbers, 12px muted labels, 16px passes left, never marigold-edge text', () => {
  const block = thumbBlock();
  const num = blockRule(block, '.dimmer-num');
  assert.match(num, /font-size: 40px; font-weight: 700;/);
  assert.match(num, /color: var\(--ink\);/);
  assert.match(blockRule(block, '.dimmer-unit'), /font-size: 12px; font-weight: 700;[^}]*color: var\(--muted\);/);
  assert.match(blockRule(block, '#passesLeft'), /font-size: 16px;[^}]*color: var\(--ink-2\);/);
  assert.match(blockRule(block, '.dimmer-readout'), /background: var\(--sky\);/);
  assert.ok(!/(^|[ ;])color: var\(--marigold-edge\)/.test(block), 'marigold-edge is 4.44:1 on white, so never text');
});

// ---------- 10-02: songs-first Library (LIB-01, LIB-03) ----------
// Depth-first search through stub children by class token.
function findAll(node, cls, out = []) {
  for (const child of node.children || []) {
    if (typeof child.className === 'string' && child.className.split(' ').includes(cls)) out.push(child);
    findAll(child, cls, out);
  }
  return out;
}
const textOf = node => (node.children && node.children.length ? node.children.map(textOf).join('') : node.textContent);
// A declaration, so the WR-04 test above can use it before this point is evaluated.
function cardsIn(byId, listId) { return findAll(byId.get(listId), 'lib-card'); }
const defaults = () => createSettingsStore(createFakeStorage(), CONTENT).load();

test('10-02: the Library markup opens on Songs, with the song cards inside the tabpanel', () => {
  const source = html();
  const library = viewSlice(source, 'library');
  const tabs = library.slice(library.indexOf('id="tabs"'), library.indexOf('</div>', library.indexOf('id="tabs"')));
  const order = ['tab-songs', 'tab-scales', 'tab-chords', 'tab-progressions'].map(id => tabs.indexOf(`id="${id}"`));
  for (const at of order) assert.ok(at > 0, 'a content tab is missing');
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'the tabs read Songs, Scales, Chords, Progressions');
  assert.match(tabs, /id="tab-songs" aria-controls="tabpanel" aria-selected="true" tabindex="0">Songs<\/button>/);
  assert.match(tabs, /id="tab-scales" aria-controls="tabpanel" aria-selected="false" tabindex="-1">Scales<\/button>/);
  assert.match(library, /<div class="controls" id="controls-songs">/);
  assert.match(library, /<div class="controls" id="controls-scales" hidden>/);
  const panel = library.slice(library.indexOf('id="tabpanel"'), library.indexOf('id="libraryCta"'));
  assert.match(panel, /<ul class="lib-cards" id="songCards"><\/ul>/);
  assert.ok(panel.indexOf('id="songCards"') < panel.indexOf('id="controls-songs"'), 'the cards sit above the picker rows');
  assert.equal((source.match(/aria-live/g) || []).length, 1, 'still exactly one live region');
  assert.match(read('panels.js'), /const TABS = \['songs', 'scales', 'chords', 'progressions'\];/);
});

test('10-02: createPanels prebuilds one song card per song with title, meta, chords, lyric and lamps', () => {
  withPanels(({ byId }) => {
    const cards = cardsIn(byId, 'songCards');
    assert.equal(cards.length, SONGS.length);
    cards.forEach((card, i) => {
      const song = SONGS[i];
      assert.equal(card.dataset.family, 'song');
      assert.equal(card.dataset.id, song.id);
      assert.equal(card.getAttribute('aria-label'), `Open ${song.title} in Practice`);
      assert.equal(findAll(card, 'meta').length, 1);
      assert.equal(findAll(card, 'chordline').length, 1);
      assert.equal(findAll(card, 'verses').length, 1);
      assert.equal(findAll(card, 'lyric').length, song.lyric ? 1 : 0, 'a lyric node only when the song has one');
      if (song.lyric) assert.equal(findAll(card, 'lyric')[0].textContent, song.lyric);
      assert.ok(textOf(card).includes(song.title));
    });
  });
});

// 10 IN-04: the aria-label names the action, so the card's meta (key, meter, BPM), chord line,
// lyric and lamps are all spoken as its description, in reading order.
test('10 IN-04: every card is described by its meta, chord line, lyric and lamps', () => {
  withPanels(({ byId }) => {
    for (const card of cardsIn(byId, 'songCards')) {
      const ids = card.getAttribute('aria-describedby').split(' ');
      const song = SONGS.find(s => s.id === card.dataset.id);
      const expected = [findAll(card, 'meta')[0], findAll(card, 'chordline')[0],
        ...findAll(card, 'lyric'), findAll(card, 'verses')[0]].map(node => node.id);
      assert.deepEqual(ids, expected, `${song.id} description order`);
      assert.equal(ids.length, song.lyric ? 4 : 3);
      assert.ok(ids.every(Boolean) && new Set(ids).size === ids.length, 'every described node has its own id');
    }
    for (const list of ['scaleCards', 'chordCards', 'progressionCards']) {
      for (const card of cardsIn(byId, list)) {
        const ids = card.getAttribute('aria-describedby').split(' ');
        assert.equal(ids[0], findAll(card, 'meta')[0].id, `${card.dataset.id} names its meta first`);
        const verses = findAll(card, 'verses');
        if (verses.length) assert.equal(ids[ids.length - 1], verses[0].id, 'the lamps stay in the description');
      }
    }
  });
});

// 10 WR-01: the lamps are repainted from the plane on Library entry and at every progress write
// a result makes (the result itself and its recall self-report both go through recordResult).
test('10 WR-01: entering Library and every recorded result repaint the Library lamps', () => {
  const main = read('main.js');
  assert.match(fnBody(main, 'switchView'), /else if \(name === 'library'\) panels\.renderLibrary\(libraryModel\(\)\);/);
  const record = fnBody(main, 'recordResult');
  assert.ok(record.indexOf('store.setProgress(progress)') < record.indexOf('panels.renderLibrary(libraryModel());'),
    'the lamps repaint after the write, from the persisted plane');
  // Both progress writes of a result reach the repaint through recordResult.
  assert.ok((main.match(/= recordResult\(\);/g) || []).length >= 2, 'the result and the self-report both record');
  assert.equal((main.match(/applyResult\(/g) || []).length, 1, 'recordResult is the one result write');
});

// 10 WR-03: a scale card's lamp and the skill it opens come from one family rule, so with Find
// the note selected the lamp reads the findNote level the card will open.
test('10 WR-03: the scale card lamp uses the family the card opens', () => {
  const main = read('main.js');
  assert.match(main, /const scaleOpenFamily = \(\) => \(settings\.drillFamily === 'findNote' \? 'findNote' : 'scaleRun'\);/);
  const model = fnBody(main, 'libraryModel');
  assert.match(model, /const family = scaleOpenFamily\(\);/);
  assert.match(model, /chartIdFor\(\{ drillFamily: family, scaleId: scale\.id, keyPc: settings\.keyPc, positionId \}\)/);
  assert.ok(!/drillFamily: 'scaleRun'/.test(model), 'no hard-coded scale-run lamp');
  assert.match(fnBody(main, 'openItem'), /drillFamily: scaleOpenFamily\(\)/);
});

test('10-02: renderLibrary writes chord chips and owned-level lamps, and a repeat call writes nothing', () => {
  const model = {
    songs: [{
      id: 'willTheCircleBeUnbroken', keyPc: 7, meta: 'G · 4/4 · 84 BPM', chords: ['G', 'C', 'G', 'D'],
      sections: [{ id: 'verse', name: 'Verse', repeats: 2, level: 1 }, { id: 'chorus', name: 'Chorus', repeats: 1, level: -1 }],
    }],
  };
  withPanels(({ panels, byId }) => {
    const card = cardsIn(byId, 'songCards').find(c => c.dataset.id === 'willTheCircleBeUnbroken');
    panels.renderLibrary(model);
    assert.equal(findAll(card, 'meta')[0].textContent, 'G · 4/4 · 84 BPM');
    const chordline = findAll(card, 'chordline')[0];
    assert.deepEqual(chordline.children.map(chip => chip.textContent), ['G', 'C', 'G', 'D']);
    const groups = findAll(card, 'vz');
    assert.equal(groups.length, 2);
    const [verse, chorus] = groups;
    assert.equal(findAll(verse, 'own-swatch')[0].getAttribute('data-level'), '1');
    assert.equal(findAll(verse, 'own-swatch')[0].getAttribute('aria-hidden'), 'true');
    assert.equal(textOf(verse), 'Verse ×2 · owned: Anchors');
    assert.equal(findAll(chorus, 'own-swatch')[0].getAttribute('data-level'), null, 'not started carries no level');
    assert.equal(textOf(chorus), 'Chorus · Not started');
    const verses = findAll(card, 'verses')[0];
    const chips = chordline.children;
    const lamps = verses.children;
    panels.renderLibrary(JSON.parse(JSON.stringify(model)));
    assert.equal(chordline.children, chips, 'an unchanged card keeps its chips');
    assert.equal(verses.children, lamps, 'an unchanged card keeps its lamps');
  });
});

test('10-02: the Library tab never follows settings.tab; the Practice subject surfaces do', () => {
  withPanels(({ panels, byId }) => {
    panels.select('scales', false, false);
    assert.equal(byId.get('tab-scales').getAttribute('aria-selected'), 'true');
    panels.render({ ...defaults(), tab: 'chords' }, { libraryTab: 'songs' });
    assert.equal(byId.get('tab-songs').getAttribute('aria-selected'), 'true');
    assert.equal(byId.get('tab-scales').getAttribute('aria-selected'), 'false');
    assert.equal(byId.get('tabpanel').getAttribute('aria-labelledby'), 'tab-songs');
    assert.equal(byId.get('controls-songs').hidden, false);
    assert.equal(byId.get('controls-chords').hidden, true);
    assert.equal(byId.get('songCards').hidden, false);
    assert.equal(byId.get('libraryCta').textContent, 'Open this song');
    assert.equal(byId.get('chordDetail').hidden, false, 'chord detail follows the Practice subject');
    assert.equal(byId.get('chart').hidden, true);
    const chart = { sections: [{ name: 'Verse', repeats: 1, bars: [{ bar: 1, name: 'G', roman: 'I' }] }] };
    panels.render({ ...defaults(), tab: 'songs' }, { libraryTab: 'chords', chart });
    assert.equal(byId.get('chart').hidden, false, 'the bar chart shows for the songs subject');
    assert.equal(byId.get('controls-chords').hidden, false);
    assert.equal(byId.get('songCards').hidden, true);
  });
});

test('10-02: clicking a song card asks main to open that song', () => {
  const opened = [];
  withPanels(({ byId, listeners }) => {
    const card = cardsIn(byId, 'songCards')[0];
    const click = listeners.find(l => l.node === byId.get('songCards') && l.type === 'click');
    assert.ok(click, 'one delegated click listener on the song list');
    click.handler({ target: { closest: sel => (sel === '.lib-card' ? card : null) } });
    click.handler({ target: { closest: () => null } });
    assert.deepEqual(opened, [['song', SONGS[0].id]]);
  }, { handlers: { onOpenItem: (family, id) => opened.push([family, id]) } });
});

test('10-02: libraryTab lives in memory only; a tab click never reaches applyTab', () => {
  const main = read('main.js');
  assert.equal((main.match(/let libraryTab = 'songs';/g) || []).length, 1);
  assert.match(main, /onTab: showLibraryTab,/);
  assert.ok(!/onTab: applyTab/.test(main));
  const show = fnBody(main, 'showLibraryTab');
  assert.ok(!show.includes('applyTab('), 'showLibraryTab never calls applyTab');
  assert.ok(!show.includes('save('), 'showLibraryTab never persists');
  for (const call of main.match(/save\([^;]*\);/g) || []) assert.ok(!call.includes('libraryTab'), `no save mentions libraryTab: ${call}`);
  assert.ok(!read('settings.js').includes('libraryTab'), 'settings.js never learns libraryTab');
  assert.match(fnBody(main, 'renderAll'), /panels\.render\(settings, \{ \.\.\.view, libraryTab, library: libraryModel\(\) \}\);/);
});

// ---------- 10-02: every Library tab opens its item (LIB-03) ----------
test('10-02: every Library tab lists its cards; chord shapes carry no lamp', () => {
  withPanels(({ byId }) => {
    const scales = cardsIn(byId, 'scaleCards');
    assert.deepEqual(scales.map(c => [c.dataset.family, c.dataset.id]), SCALES.map(s => ['scale', s.id]));
    const chords = cardsIn(byId, 'chordCards');
    assert.deepEqual(chords.map(c => [c.dataset.family, c.dataset.id]), [
      ...CHORD_PAIRS.map(p => ['pair', p.id]), ...CHORD_FAMILIES.map(c => ['chord', c.id]),
    ], 'chord pairs first, then the chord shapes');
    for (const card of chords) {
      assert.equal(findAll(card, 'verses').length, card.dataset.family === 'pair' ? 1 : 0, `${card.dataset.id} lamp`);
    }
    for (const card of chords.filter(c => c.dataset.family === 'chord')) {
      assert.ok(findAll(card, 'meta')[0].textContent.length > 0, 'a chord shape card names its shapes');
    }
    const progressions = cardsIn(byId, 'progressionCards');
    assert.deepEqual(progressions.map(c => [c.dataset.family, c.dataset.id]), PROGRESSIONS.map(p => ['progression', p.id]));
    for (const card of [...scales, ...progressions]) assert.equal(findAll(card, 'verses').length, 1);
  });
});

test('10-02: selecting a Library tab shows only its card list and its picker row', () => {
  const lists = { songs: 'songCards', scales: 'scaleCards', chords: 'chordCards', progressions: 'progressionCards' };
  withPanels(({ panels, byId }) => {
    for (const tab of Object.keys(lists)) {
      panels.select(tab, false, false);
      for (const other of Object.keys(lists)) {
        assert.equal(byId.get(lists[other]).hidden, other !== tab, `${lists[other]} with ${tab}`);
        assert.equal(byId.get(`controls-${other}`).hidden, other !== tab, `controls-${other} with ${tab}`);
      }
      assert.equal(byId.get('libraryCta').textContent, CTA_LABEL[tab]);
    }
  });
});

test('10-02: renderLibrary writes scale, pair and progression lamps as owned level or Not started', () => {
  withPanels(({ panels, byId }) => {
    panels.renderLibrary({
      scales: [{ id: SCALES[0].id, meta: 'A · Whole neck', level: 3 }],
      pairs: [{ id: CHORD_PAIRS[0].id, level: -1 }],
      progressions: [{ id: PROGRESSIONS[0].id, meta: 'C · C – F – G', level: 0 }],
    });
    const scale = cardsIn(byId, 'scaleCards')[0];
    assert.equal(findAll(scale, 'meta')[0].textContent, 'A · Whole neck');
    assert.equal(findAll(scale, 'own-swatch')[0].getAttribute('data-level'), '3');
    assert.equal(textOf(findAll(scale, 'vz')[0]), 'owned: No lights');
    const pair = cardsIn(byId, 'chordCards')[0];
    assert.equal(findAll(pair, 'own-swatch')[0].getAttribute('data-level'), null);
    assert.equal(textOf(findAll(pair, 'vz')[0]), 'Not started');
    const prog = cardsIn(byId, 'progressionCards')[0];
    assert.equal(textOf(findAll(prog, 'vz')[0]), 'owned: Full pattern');
  });
});

test('10-02: the Library picker rows read the library model, whatever the Practice subject', () => {
  withPanels(({ panels, byId }) => {
    const voicings = chordById.G.voicings;
    const positions = positionsForScale(0, scaleById.major);
    panels.render({ ...defaults(), tab: 'scales', chordId: 'G', voicingId: voicings[0].id }, {
      positions, voicings: [], library: { positions, voicings },
    });
    assert.equal(byId.get('voicing').children.length, voicings.length, 'voicings of settings.chordId on the scales subject');
    panels.render({ ...defaults(), tab: 'chords', scaleId: 'major', keyPc: 0 }, {
      positions: [], voicings, library: { positions, voicings },
    });
    assert.equal(byId.get('position').children.length, positions.length + 1, 'Whole neck plus the boxes on the chords subject');
  });
});

test('10-02: Change in Library opens the tab of the loaded item', () => {
  const main = read('main.js');
  assert.match(main, /onChangeInLibrary: changeInLibrary,/);
  const tabFor = fnBody(main, 'libraryTabForLoaded');
  assert.match(tabFor, /if \(settings\.tab !== 'scales'\) return settings\.tab;/);
  assert.match(tabFor, /song: 'songs', progression: 'progressions', chordChanges: 'chords'/);
  const change = fnBody(main, 'changeInLibrary');
  assert.ok(change.indexOf('libraryTab = libraryTabForLoaded()') >= 0);
  assert.ok(change.indexOf('libraryTab = libraryTabForLoaded()') < change.indexOf("switchView('library')"), 'tab first, then the view');
  assert.match(change, /panels\.select\(libraryTab, false, false\);/);
});

// ---------- 10-03: Library search (LIB-04) ----------
const SEARCH_LISTS = { songs: 'searchSongs', scales: 'searchScales', chords: 'searchChords', progressions: 'searchProgressions' };
const SEARCH_GROUPS = { songs: 'searchGroupSongs', scales: 'searchGroupScales', chords: 'searchGroupChords', progressions: 'searchGroupProgressions' };
const searchRows = byId => Object.values(SEARCH_LISTS).flatMap(list => findAll(byId.get(list), 'search-row'));
const visibleRows = byId => Object.values(SEARCH_LISTS).flatMap(list => byId.get(list).children)
  .filter(item => !item.hidden).map(item => item.children[0]);
const nodeCount = node => (node.children || []).reduce((sum, child) => sum + 1 + nodeCount(child), 0);
function typeSearch(byId, listeners, value) {
  const input = byId.get('librarySearch');
  const handler = listeners.find(l => l.node === input && l.type === 'input');
  assert.ok(handler, 'one input listener on #librarySearch');
  input.value = value;
  handler.handler({ target: input });
}

test('10-03: createPanels prebuilds one result row per song, scale, chord pair, chord shape and progression', () => {
  withPanels(({ byId }) => {
    const rows = searchRows(byId);
    assert.equal(rows.length, SONGS.length + SCALES.length + CHORD_PAIRS.length + CHORD_FAMILIES.length + PROGRESSIONS.length);
    const ids = list => findAll(byId.get(list), 'search-row').map(row => `${row.dataset.family}:${row.dataset.id}`);
    assert.deepEqual(ids('searchSongs'), SONGS.map(s => `song:${s.id}`));
    assert.deepEqual(ids('searchScales'), SCALES.map(s => `scale:${s.id}`));
    assert.deepEqual(ids('searchChords'), [...CHORD_PAIRS.map(p => `pair:${p.id}`), ...CHORD_FAMILIES.map(c => `chord:${c.id}`)]);
    assert.deepEqual(ids('searchProgressions'), PROGRESSIONS.map(p => `progression:${p.id}`));
    for (const row of rows) assert.equal(row.type, 'button');
    assert.ok(textOf(rows.find(r => r.dataset.id === 'minPent')).includes('Minor pentatonic'));
  });
});

test('10-03: typing shows only the matching rows and groups, replacing the tabs, without creating nodes', () => {
  withPanels(({ byId, listeners }) => {
    const before = Object.values(SEARCH_LISTS).map(list => nodeCount(byId.get(list)));
    typeSearch(byId, listeners, 'pentatonic');
    assert.equal(byId.get('searchResults').hidden, false);
    assert.equal(byId.get('tabs').hidden, true);
    assert.equal(byId.get('tabpanel').hidden, true);
    assert.deepEqual(visibleRows(byId).map(row => row.dataset.id), ['minPent', 'majPent']);
    assert.equal(byId.get(SEARCH_GROUPS.scales).hidden, false);
    for (const group of ['songs', 'chords', 'progressions']) assert.equal(byId.get(SEARCH_GROUPS[group]).hidden, true, `${group} has no hit`);
    assert.equal(byId.get('searchCount').textContent, '2 results');
    typeSearch(byId, listeners, 'blues');
    assert.ok(visibleRows(byId).some(row => row.dataset.id === 'blues'));
    assert.ok(visibleRows(byId).some(row => row.dataset.id === '12-bar-blues'));
    assert.deepEqual(Object.values(SEARCH_LISTS).map(list => nodeCount(byId.get(list))), before, 'typing never adds or removes nodes');
  });
});

test('10-03: clearing the field hides the results and restores the remembered Library tab', () => {
  withPanels(({ panels, byId, listeners }) => {
    panels.select('chords', false, false);
    typeSearch(byId, listeners, 'am');
    assert.equal(byId.get('tabs').hidden, true);
    typeSearch(byId, listeners, '');
    assert.equal(byId.get('searchResults').hidden, true);
    assert.equal(byId.get('searchCount').textContent, '', '10 IN-05: no stale count describes the field');
    assert.equal(byId.get('tabs').hidden, false);
    assert.equal(byId.get('tabpanel').hidden, false);
    assert.equal(byId.get('tab-chords').getAttribute('aria-selected'), 'true');
    assert.equal(byId.get('chordCards').hidden, false);
  });
});

// ---------- 10-03: search empty state, open and lock (LIB-04) ----------
const EMPTY_TEXT = 'No songs, scales, chords or progressions match.';
test('10 IN-05: #searchCount ships empty, so the search field is never described by a stale count', () => {
  assert.match(html(), /<p class="microcopy" id="searchCount"><\/p>/);
});

test('10-03: an empty result shows visible text and announces once per transition into empty', () => {
  const said = [];
  withPanels(({ byId, listeners }) => {
    typeSearch(byId, listeners, 'zzzz');
    assert.equal(byId.get('searchEmpty').hidden, false);
    assert.equal(byId.get('searchEmpty').textContent, EMPTY_TEXT);
    assert.equal(byId.get('searchCount').textContent, '0 results');
    assert.deepEqual(said, [EMPTY_TEXT]);
    typeSearch(byId, listeners, 'zzzzz');
    assert.deepEqual(said, [EMPTY_TEXT], 'a second empty keystroke stays quiet');
    typeSearch(byId, listeners, 'pentatonic');
    assert.equal(byId.get('searchEmpty').hidden, true);
    typeSearch(byId, listeners, 'zzzz');
    assert.deepEqual(said, [EMPTY_TEXT, EMPTY_TEXT], 'a new transition into empty announces again');
    typeSearch(byId, listeners, '');
    typeSearch(byId, listeners, 'qqqq');
    assert.equal(said.length, 3, 'clearing the field then missing again is a new transition');
  }, {
    setup: ({ get }) => {
      const node = get('announcer');
      Object.defineProperty(node, 'textContent', { get: () => said[said.length - 1] || '', set: text => said.push(text) });
    },
  });
});

test('10-03: clicking a result row opens its item exactly as its card does', () => {
  const opened = [];
  withPanels(({ byId, listeners }) => {
    const row = findAll(byId.get('searchScales'), 'search-row').find(r => r.dataset.id === 'minPent');
    const click = listeners.find(l => l.node === byId.get('searchResults') && l.type === 'click');
    assert.ok(click, 'one delegated click listener on #searchResults');
    click.handler({ target: { closest: sel => (sel === '.search-row' ? row : null) } });
    click.handler({ target: { closest: () => null } });
    row.disabled = true;
    click.handler({ target: { closest: sel => (sel === '.search-row' ? row : null) } });
    assert.deepEqual(opened, [['scale', 'minPent']], 'a locked row opens nothing');
  }, { handlers: { onOpenItem: (family, id) => opened.push([family, id]) } });
});

// ---------- 10-04: lesson and title follow the loaded item (KEEP-02) ----------
function workspaceFor(patch) {
  return withPanels(({ panels, byId }) => {
    panels.render({ ...defaults(), ...patch }, {});
    return { title: byId.get('workspaceTitle').textContent, sub: byId.get('workspaceSub').textContent };
  });
}

test('10-04: the Practice title names a loaded song, progression or chord pair', () => {
  const song = workspaceFor({ tab: 'scales', drillFamily: 'song', songId: 'amazingGrace', songSectionId: 'verse' });
  assert.equal(song.title, 'Amazing Grace');
  assert.ok(song.sub.startsWith('Verse'), song.sub);
  assert.ok(song.sub.endsWith('Song'), song.sub);
  const prog = workspaceFor({ tab: 'scales', drillFamily: 'progression', progressionId: 'I-IV-V', keyPc: 7 });
  assert.equal(prog.title, 'I–IV–V in G');
  const pair = workspaceFor({ tab: 'scales', drillFamily: 'chordChanges', chordPairId: 'Am-C' });
  assert.equal(pair.title, 'Am → C');
});

test('10-04: a scale drill keeps its key-and-scale title, and a crafted id falls back without throwing', () => {
  const run = workspaceFor({ tab: 'scales', drillFamily: 'scaleRun', keyPc: 9, scaleId: 'minPent' });
  assert.equal(run.title, 'A Minor pentatonic');
  const find = workspaceFor({ tab: 'scales', drillFamily: 'findNote', keyPc: 9, scaleId: 'minPent' });
  assert.equal(find.title, 'A Minor pentatonic');
  for (const [family, field] of [['song', 'songId'], ['progression', 'progressionId'], ['chordChanges', 'chordPairId']]) {
    for (const id of ['constructor', 'missing']) {
      const out = workspaceFor({ tab: 'scales', drillFamily: family, [field]: id, keyPc: 9, scaleId: 'minPent' });
      assert.equal(out.title, 'A Minor pentatonic', `${family} ${id} falls back`);
    }
  }
});

// 10-04 (orchestrator addition to 10-03's open point): the tab CTA names the hidden tab's item,
// so it hides with the tabs while results show and returns when the query is cleared.
test('10-04: #libraryCta hides while search results show and returns when the query clears', () => {
  withPanels(({ byId, listeners }) => {
    assert.equal(byId.get('libraryCta').hidden, false);
    typeSearch(byId, listeners, 'pentatonic');
    assert.equal(byId.get('libraryCta').hidden, true);
    typeSearch(byId, listeners, 'zzzz');
    assert.equal(byId.get('libraryCta').hidden, true, 'an empty result still hides it');
    typeSearch(byId, listeners, '');
    assert.equal(byId.get('libraryCta').hidden, false);
  });
  const panels = read('panels.js');
  assert.match(fnBody(panels, 'applySearch'), /if \(\$\('libraryCta'\)\) \$\('libraryCta'\)\.hidden = searching;/);
  assert.equal((fs.readFileSync(fileURLToPath(new URL('../app/index.html', import.meta.url)), 'utf8').match(/aria-live/g) || []).length, 1);
});
