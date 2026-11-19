import test from 'node:test';
import assert from 'node:assert/strict';
import { createFretboard, STRING_NAMES, nextCell, cellLabel, labelFor, classNameFor } from '../app/src/fretboard.js';

// ---------- Stub DOM (copied from shell.test.js, extended for listeners and rects) ----------
function stubEl(tag = 'div') {
  const el = {
    tag,
    children: [],
    style: { setProperty(name, value) { el.style[name] = value; } },
    attrs: {},
    classes: new Set(),
    listeners: {},
    rect: null,
    parentElement: null,
    tabIndex: 0,
    focused: 0,
    get className() { return [...el.classes].join(' '); },
    set className(value) { el.classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    classList: {
      add(...names) { names.forEach(name => el.classes.add(name)); },
      remove(...names) { names.forEach(name => el.classes.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !el.classes.has(name) : !!force;
        if (on) el.classes.add(name); else el.classes.delete(name);
        return on;
      },
      contains(name) { return el.classes.has(name); },
    },
    textContent: '',
    appendChild(child) { el.children.push(child); child.parentElement = el; return child; },
    remove() { const p = el.parentElement; if (p) p.children = p.children.filter(c => c !== el); el.parentElement = null; },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(el.attrs, name) ? el.attrs[name] : null; },
    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
    dispatch(type, event = {}) { for (const fn of el.listeners[type] || []) fn(event); },
    focus() { el.focused += 1; el.dispatch('focus'); },
    getBoundingClientRect() { return el.rect || { top: 0, left: 0, height: 36, width: 40 }; },
  };
  return el;
}

function setup({ onAudition = null, clientHeight = 500 } = {}) {
  globalThis.document = { createElement: tag => stubEl(tag) };
  const wrap = stubEl();
  wrap.scrollTop = 0;
  wrap.clientHeight = clientHeight;
  wrap.rect = { top: 100, left: 0, height: clientHeight, width: 300 };
  wrap.scrolls = [];
  wrap.scrollTo = arg => { wrap.scrolls.push(arg); if (Object.hasOwn(arg, 'top')) wrap.scrollTop = arg.top; };
  const board = stubEl();
  wrap.appendChild(board);
  const fb = createFretboard({ board, onAudition });
  return { wrap, board, fb };
}

// Place a cell's row at `top` (page pixels), 36px tall.
const placeAt = (cell, top) => { cell.rect = { top, left: 0, height: 36, width: 40 }; };

test('NECK-01: build() emits a header row then one row per fret, low E left', () => {
  const { board, fb } = setup();
  assert.equal(board.children.length, 147);
  const head = board.children.slice(0, 7);
  for (const h of head) { assert.equal(h.className, 'num head'); assert.equal(h.getAttribute('aria-hidden'), 'true'); }
  assert.equal(head[0].textContent, '');
  assert.deepEqual(head.slice(1).map(h => h.textContent), ['E', 'A', 'D', 'G', 'B', 'E']);
  assert.deepEqual([6, 5, 4, 3, 2, 1].map(s => STRING_NAMES[s]), ['E', 'A', 'D', 'G', 'B', 'E']);
  for (let f = 0; f <= 19; f++) {
    const row = board.children.slice(7 + f * 7, 14 + f * 7);
    const num = row[0];
    assert.ok(num.classList.contains('num') && !num.classList.contains('head'), `fret ${f} number`);
    assert.equal(num.getAttribute('aria-hidden'), 'true');
    assert.equal(String(num.textContent), f === 0 ? '' : String(f));
    assert.equal(num.classList.contains('mk'), [3, 5, 7, 9, 12, 15, 17, 19].includes(f), `mk at ${f}`);
    [6, 5, 4, 3, 2, 1].forEach((s, i) => assert.equal(row[i + 1], fb.cells[s + ':' + f], `cell ${s}:${f} in order`));
  }
});

test('NECK-01: the cells map, roles, open and marker classes', () => {
  const { board, fb } = setup();
  assert.equal(Object.keys(fb.cells).length, 120);
  for (let s = 1; s <= 6; s++) for (let f = 0; f <= 19; f++) {
    const c = fb.cells[s + ':' + f];
    assert.equal(c.getAttribute('role'), 'button');
    assert.equal(c.classList.contains('open'), f === 0);
    const marker = (s === 3 && [3, 5, 7, 9, 15, 17, 19].includes(f)) || ((s === 2 || s === 4) && f === 12);
    assert.equal(c.classList.contains('marker'), marker, `marker ${s}:${f}`);
  }
  assert.ok(!Object.keys(board.style).some(k => /template/i.test(k)), 'no inline column template');
});

test('NECK-01: a target outside the visible band scrolls the box vertically, once', () => {
  const { wrap, fb } = setup();
  const cell = fb.cells['3:15'];
  placeAt(cell, 100 + 700); // far below the 500px band
  fb.render([{ s: 3, f: 15, text: 'D', target: true }]);
  assert.equal(wrap.scrolls.length, 1);
  assert.ok(Object.hasOwn(wrap.scrolls[0], 'top'));
  assert.ok(!Object.hasOwn(wrap.scrolls[0], 'left'));
  assert.equal(wrap.scrolls[0].top, 0 + 700 - 250);
  fb.render([{ s: 3, f: 15, text: 'D', target: true }]);
  assert.equal(wrap.scrolls.length, 1, 'same target does not scroll again');
});

test('WR-04: a target rendered while the neck is hidden still scrolls into view once shown', () => {
  const { wrap, fb } = setup();
  // Hidden view: the box and every cell measure zero.
  wrap.clientHeight = 0;
  wrap.rect = { top: 0, left: 0, height: 0, width: 0 };
  fb.cells['3:15'].rect = { top: 0, left: 0, height: 0, width: 0 };
  fb.render([{ s: 3, f: 15, text: 'D', target: true }]);
  assert.equal(wrap.scrolls.length, 0, 'nothing to measure while hidden');
  // Shown again with the same target (a paused drill, the result frame).
  wrap.clientHeight = 500;
  wrap.rect = { top: 100, left: 0, height: 500, width: 300 };
  placeAt(fb.cells['3:15'], 100 + 700);
  fb.render([{ s: 3, f: 15, text: 'D', target: true }]);
  assert.equal(wrap.scrolls.length, 1, 'the same target scrolls once the neck has a size');
  fb.render([{ s: 3, f: 15, text: 'D', target: true }]);
  assert.equal(wrap.scrolls.length, 1, 'and only once');
});

test('NECK-01: a target already inside the band does not scroll', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['4:5'], 100 + 200);
  fb.render([{ s: 4, f: 5, text: 'G', target: true }]);
  assert.equal(wrap.scrolls.length, 0);
});

// ---------- NECK-03 / NECK-04: keyboard and labels ----------
test('NECK-03: nextCell follows the vertical neck', () => {
  assert.deepEqual(nextCell(3, 5, 'ArrowUp'), [3, 4]);
  assert.deepEqual(nextCell(3, 5, 'ArrowDown'), [3, 6]);
  assert.deepEqual(nextCell(3, 5, 'ArrowLeft'), [4, 5], 'left is the lower-pitched string');
  assert.deepEqual(nextCell(3, 5, 'ArrowRight'), [2, 5]);
  assert.deepEqual(nextCell(3, 5, 'Home'), [3, 0]);
  assert.deepEqual(nextCell(3, 5, 'End'), [3, 19]);
  assert.equal(nextCell(3, 5, 'Tab'), null);
  assert.equal(nextCell(3, 5, 'a'), null);
});

test('NECK-03: nextCell clamps at all four edges', () => {
  assert.deepEqual(nextCell(6, 0, 'ArrowUp'), [6, 0]);
  assert.deepEqual(nextCell(1, 19, 'ArrowDown'), [1, 19]);
  assert.deepEqual(nextCell(6, 4, 'ArrowLeft'), [6, 4]);
  assert.deepEqual(nextCell(1, 4, 'ArrowRight'), [1, 4]);
});

test('NECK-04: cellLabel announces open strings as having no LED', () => {
  assert.equal(cellLabel(6, 0), 'String 6, open string, no LED');
  assert.equal(cellLabel(2, 7), 'String 2, fret 7');
  assert.equal(cellLabel(2, 7, 'B'), 'String 2, fret 7, B');
});

test('IN-04: modified Arrow, Home, End, Enter and Space presses are left to the browser', () => {
  const calls = [];
  const { fb } = setup({ onAudition: (s, f) => calls.push([s, f]) });
  let prevented = 0;
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ']) {
      fb.cells['3:5'].dispatch('keydown', { key, [mod]: true, preventDefault() { prevented += 1; } });
    }
  }
  assert.equal(prevented, 0);
  assert.deepEqual(calls, []);
  for (const key of ['3:4', '3:6', '4:5', '2:5', '3:0', '3:19']) assert.equal(fb.cells[key].focused, 0, key);
  // Shift alone is not a browser chord here: the plain map still applies.
  fb.cells['3:5'].dispatch('keydown', { key: 'ArrowDown', shiftKey: true, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
});

test('NECK-03: arrow keys move focus, Enter and Space audition', () => {
  const calls = [];
  const { fb } = setup({ onAudition: (s, f) => calls.push([s, f]) });
  let prevented = 0;
  const ev = key => ({ key, preventDefault() { prevented += 1; } });
  fb.cells['3:5'].dispatch('keydown', ev('ArrowLeft'));
  assert.equal(prevented, 1);
  assert.equal(fb.cells['4:5'].focused, 1);
  fb.cells['3:5'].dispatch('keydown', ev('Enter'));
  fb.cells['3:5'].dispatch('keydown', ev(' '));
  assert.deepEqual(calls, [[3, 5], [3, 5]]);
  fb.cells['3:5'].dispatch('keydown', ev('Tab'));
  assert.equal(prevented, 3, 'unmapped keys are left alone');
  fb.setInteractive(false);
  fb.cells['3:5'].dispatch('keydown', ev('Enter'));
  assert.equal(calls.length, 2, 'no audition while disabled');
});

test('NECK-03: roving focus starts top-left at 6:0', () => {
  const { fb } = setup();
  const zero = Object.entries(fb.cells).filter(([, c]) => c.tabIndex === 0).map(([k]) => k);
  assert.deepEqual(zero, ['6:0']);
  fb.cells['2:7'].dispatch('focus');
  assert.equal(fb.cells['2:7'].tabIndex, 0);
  assert.equal(fb.cells['6:0'].tabIndex, -1);
});

test('NECK-04: open cells keep the honest label through render and label hiding', () => {
  const { fb } = setup();
  const c = fb.cells['4:0'];
  assert.equal(c.getAttribute('aria-label'), 'String 4, open string, no LED');
  fb.render([{ s: 4, f: 0, text: 'D', open: true }]);
  assert.equal(c.getAttribute('aria-label'), 'String 4, open string, no LED, D');
  fb.setLabelsVisible(false);
  assert.equal(c.getAttribute('aria-label'), 'String 4, open string, no LED');
  fb.setLabelsVisible(true);
  fb.render([]);
  assert.equal(c.getAttribute('aria-label'), 'String 4, open string, no LED');
});

// ---------- Browse scroll, diff render and v1 label modes (NECK-01, NECK-02) ----------
const shape = frets => frets.map(([s, f]) => ({ s, f, text: 'x' }));

test('NECK-01: a high browse position scrolls its lowest fret into the box, once', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['6:12'], 100 + 28 + 12 * 36);
  fb.render(shape([[6, 12], [6, 15], [5, 12], [4, 14]]));
  assert.equal(wrap.scrolls.length, 1);
  assert.deepEqual(Object.keys(wrap.scrolls[0]), ['top']);
  assert.equal(wrap.scrolls[0].top, 28 + 12 * 36 - 36, 'the lowest fret sits one row below the top');
  fb.render(shape([[6, 12], [6, 15], [5, 12], [4, 14]]));
  assert.equal(wrap.scrolls.length, 1, 'same lowest fret does not scroll again');
});

test('NECK-01: a shape starting at fret 0 scrolls to the top only when the box is not there', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['6:0'], 100 + 28);
  fb.render(shape([[6, 0], [6, 3], [5, 2]]));
  assert.equal(wrap.scrolls.length, 0, 'already at the top');
  fb.render([]);
  wrap.scrollTop = 200;
  placeAt(fb.cells['6:0'], 100 + 28 - 200);
  fb.render(shape([[6, 0], [6, 3], [5, 2]]));
  assert.deepEqual(wrap.scrolls, [{ top: 0 }]);
});

test('NECK-01: a target or an empty render never triggers the browse scroll', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['6:12'], 100 + 460);
  placeAt(fb.cells['5:14'], 100 + 200); // the target is inside the band
  fb.render([...shape([[6, 12], [6, 15]]), { s: 5, f: 14, text: 'x', target: true }]);
  assert.equal(wrap.scrolls.length, 0);
  fb.render([]);
  assert.equal(wrap.scrolls.length, 0);
});

test('IN-03: a muted × marker at f 0 never counts as the lowest fret', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['6:0'], 100 + 28);
  placeAt(fb.cells['5:12'], 100 + 28 + 12 * 36);
  // A high voicing with a muted low E: the box follows fret 12, not the × at the nut.
  fb.render([{ s: 6, f: 0, text: '×', muted: true }, ...shape([[5, 12], [4, 14], [3, 14], [2, 13]])]);
  assert.equal(wrap.scrolls.length, 1);
  assert.equal(wrap.scrolls[0].top, 28 + 12 * 36 - 36);
});

test('NECK-01: the box follows a chord-changes bar whose lowest fret changes', () => {
  const { wrap, fb } = setup();
  placeAt(fb.cells['6:0'], 100 + 28);
  placeAt(fb.cells['5:7'], 100 + 28 + 7 * 36);
  fb.render(shape([[6, 0], [5, 2], [4, 2], [3, 1]])); // open E major
  assert.equal(wrap.scrolls.length, 0);
  fb.render(shape([[5, 7], [4, 9], [3, 9], [2, 9]])); // E shape at the 7th fret
  assert.deepEqual(wrap.scrolls, [{ top: 7 * 36 - 8 }]);
});

test('NECK-01: a hidden neck defers the browse scroll until it has a size', () => {
  const { wrap, fb } = setup();
  fb.cells['6:12'].rect = { top: 0, left: 0, height: 0, width: 0 };
  fb.render(shape([[6, 12], [5, 12]]));
  assert.equal(wrap.scrolls.length, 0);
  placeAt(fb.cells['6:12'], 100 + 28 + 12 * 36);
  fb.render(shape([[6, 12], [5, 12]]));
  assert.equal(wrap.scrolls.length, 1, 'scrolls once the box is laid out');
});

test('NECK-02: diff render reuses dots and restores plain labels', () => {
  const { fb } = setup();
  fb.render([{ s: 3, f: 5, text: 'C' }]);
  const dot = fb.cells['3:5'].children[0];
  assert.equal(dot.textContent, 'C');
  fb.render([{ s: 3, f: 5, text: 'D' }, { s: 2, f: 7, text: 'E' }]);
  assert.equal(fb.cells['3:5'].children.length, 1);
  assert.equal(fb.cells['3:5'].children[0], dot, 'same dot element');
  assert.equal(dot.textContent, 'D');
  assert.equal(fb.cells['2:7'].children.length, 1, 'exactly one new dot');
  assert.equal(fb.cells['2:7'].getAttribute('aria-label'), 'String 2, fret 7, E');
  fb.render([]);
  assert.equal(fb.cells['3:5'].children.length, 0);
  assert.equal(fb.cells['2:7'].children.length, 0);
  assert.equal(fb.cells['3:5'].getAttribute('aria-label'), 'String 3, fret 5');
  assert.equal(fb.cells['2:7'].getAttribute('aria-label'), 'String 2, fret 7');
});

test('NECK-02: every v1 label mode and the root/target/open classes survive', () => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const degrees = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  const intervals = ['R', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];
  const note = { s: 5, f: 3, midi: 48, iv: 4, finger: 2 };
  assert.equal(labelFor(note, 'notes', names, degrees, intervals), 'C');
  assert.equal(labelFor(note, 'degrees', names, degrees, intervals), '3');
  assert.equal(labelFor(note, 'intervals', names, degrees, intervals), 'M3');
  assert.equal(labelFor(note, 'fingers', names, degrees, intervals), '2');
  assert.equal(labelFor(note, 'none', names, degrees, intervals), '');
  const cls = classNameFor({ root: true, target: true, open: true }).split(' ');
  for (const token of ['note', 'root', 'target', 'open']) assert.ok(cls.includes(token), token);
});

test('NECK-02: a click auditions the cell; a disabled board does not', () => {
  const calls = [];
  const { fb } = setup({ onAudition: (s, f) => calls.push([s, f]) });
  fb.cells['5:3'].dispatch('click');
  assert.deepEqual(calls, [[5, 3]]);
  fb.setInteractive(false);
  fb.cells['5:3'].dispatch('click');
  assert.equal(calls.length, 1);
});
