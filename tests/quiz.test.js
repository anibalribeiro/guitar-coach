// Quiz contract: a deterministic question plan, four unique chips per question, one
// judge that serves the board, the chips and (from 03-03) the mic, and the two result
// formatters the by-string plane is built from. Tier 0: `quiz.js` imports nothing; the
// by-string helpers are pure functions of the same question plan, exported by panels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIZ_KINDS, QUIZ_MODES, QUESTION_COUNT, CHIP_COUNT, quizKindsFor, poolLabel,
  buildQuestions, promptText, judge, questionMode, chipsFor,
} from '../app/src/quiz.js';
import { byStringRows, weakestString } from '../app/src/panels.js';
import {
  POOL, NAMES, DEGREES, INTERVALS, INTERVAL_NAMES, KEY_PC, seededRng,
} from './fixtures/quiz.js';

const build = (overrides = {}) => buildQuestions({
  pool: POOL,
  names: NAMES,
  degrees: DEGREES,
  intervals: INTERVALS,
  intervalNames: INTERVAL_NAMES,
  rng: seededRng(4242),
  ...overrides,
});

// A-34 drops one kind x mode pair: an interval cannot be named without a reference note.
const pairs = () => QUIZ_KINDS.flatMap(kind => QUIZ_MODES
  .filter(mode => !(kind === 'interval' && mode === 'name'))
  .map(mode => ({ kind, mode })));

const mod12 = n => ((n % 12) + 12) % 12;

test('the quiz tables are the documented constants', () => {
  assert.deepEqual(QUIZ_KINDS, ['note', 'degree', 'interval']);
  assert.deepEqual(QUIZ_MODES, ['find', 'name']);
  assert.equal(QUESTION_COUNT, 12);
  assert.equal(CHIP_COUNT, 4);
  assert.equal(KEY_PC, 9);
  assert.equal(INTERVAL_NAMES.length, 12);
});

test('quizKindsFor is the single source of the Ask-for list', () => {
  assert.deepEqual(quizKindsFor('name'), ['note', 'degree']);
  assert.deepEqual(quizKindsFor('find'), QUIZ_KINDS);
  assert.deepEqual(quizKindsFor('find'), ['note', 'degree', 'interval']);
  assert.deepEqual(quizKindsFor('anything-else'), QUIZ_KINDS);
  // The list is returned as a copy: a caller cannot mutate the module table.
  quizKindsFor('find').push('chord');
  assert.deepEqual(QUIZ_KINDS, ['note', 'degree', 'interval']);
  assert.deepEqual(quizKindsFor('find'), ['note', 'degree', 'interval']);
});

test('poolLabel reads the position or says Whole neck', () => {
  assert.equal(
    poolLabel({ keyName: 'A', scaleName: 'minor pentatonic', positionName: 'Position 1' }),
    'A minor pentatonic · Position 1',
  );
  assert.equal(
    poolLabel({ keyName: 'A', scaleName: 'minor pentatonic', positionName: 'all' }),
    'A minor pentatonic · Whole neck',
  );
  assert.equal(
    poolLabel({ keyName: 'A', scaleName: 'minor pentatonic' }),
    'A minor pentatonic · Whole neck',
  );
});

test('buildQuestions returns [] for an empty pool and for interval x Name mode', () => {
  assert.deepEqual(buildQuestions(), []);
  assert.deepEqual(build({ pool: [] }), []);
  assert.deepEqual(build({ kind: 'interval', mode: 'name' }), []);
  // A4: an all-open-string pool cannot be lit, so it cannot be asked.
  assert.deepEqual(build({ pool: POOL.filter(n => n.f === 0) }), []);
});

test('the pool filter drops fret 0 and no target cell repeats inside a pass', () => {
  const questions = build();
  assert.equal(questions.length, QUESTION_COUNT);
  for (const question of questions) {
    assert.ok(question.target.f >= 1, 'an open string is never asked');
    assert.ok(question.target.f <= 19);
    assert.ok(question.target.s >= 1 && question.target.s <= 6);
  }
  const keys = questions.map(q => `${q.target.s}:${q.target.f}`);
  assert.equal(new Set(keys).size, keys.length, 'no s:f repeats within a pass');
  assert.deepEqual(questions.map(q => q.index), questions.map((_, i) => i));
});

test('a small pool stops early at the number of distinct cells it can supply', () => {
  const tiny = POOL.filter(n => n.s === 3 && (n.f === 1 || n.f === 3));
  const questions = build({ pool: tiny, count: 12 });
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map(q => q.target.f).sort((a, b) => a - b), [1, 3]);
});

test('every question offers four unique chips that contain the correct answer', () => {
  for (const { kind, mode } of pairs()) {
    const questions = build({ kind, mode, count: 4 });
    assert.ok(questions.length > 0, `${kind}/${mode} produced no question`);
    for (const question of questions) {
      assert.equal(question.kind, kind);
      assert.equal(question.mode, mode);
      assert.equal(question.chips.length, CHIP_COUNT);
      const values = question.chips.map(chip => String(chip.value));
      assert.equal(new Set(values).size, CHIP_COUNT, `${kind}/${mode} chips are not unique`);
      const correct = question.chips.filter(chip => chip.label === question.answerChip);
      assert.equal(correct.length, 1, `${kind}/${mode} answerChip is not one of the chips`);
      if (mode === 'find') {
        assert.equal(Number(correct[0].value), question.target.f);
        for (const chip of question.chips) {
          assert.ok(Number.isInteger(chip.value) && chip.value >= 1 && chip.value <= 19);
          assert.equal(chip.label, `Fret ${chip.value}`);
        }
      } else if (kind === 'degree') {
        assert.ok(DEGREES.includes(question.answerChip));
      } else {
        assert.ok(NAMES.includes(question.answerChip));
        assert.equal(question.answerChip, question.noteName);
      }
    }
  }
});

test('findChips are always four fret candidates containing the target fret', () => {
  for (const { kind, mode } of pairs()) {
    for (const question of build({ kind, mode, count: 4 })) {
      assert.equal(question.findChips.length, CHIP_COUNT, `${kind}/${mode} findChips`);
      const values = question.findChips.map(chip => chip.value);
      assert.equal(new Set(values).size, CHIP_COUNT);
      assert.ok(values.includes(question.target.f), 'the answer is always a candidate');
      for (const chip of question.findChips) {
        assert.ok(Number.isInteger(chip.value) && chip.value >= 1 && chip.value <= 19);
        assert.equal(chip.label, `Fret ${chip.value}`);
      }
    }
  }
});

test('a fixed seed fixes the targets and the chip order', () => {
  const first = build({ kind: 'note', mode: 'find' });
  const second = build({ kind: 'note', mode: 'find' });
  assert.deepEqual(first.map(q => q.target), second.map(q => q.target));
  assert.deepEqual(first.map(q => q.chips), second.map(q => q.chips));
  assert.deepEqual(first.map(q => q.prompt), second.map(q => q.prompt));

  const other = build({ kind: 'note', mode: 'find', rng: seededRng(999) });
  assert.notDeepEqual(other.map(q => q.target), first.map(q => q.target));
});

test('the generator consumes the injected rng and never reaches for Math.random', () => {
  let calls = 0;
  const source = seededRng(7);
  const questions = build({ count: 3, rng: () => { calls += 1; return source(); } });
  assert.equal(questions.length, 3);
  assert.ok(calls > 0, 'the injected rng was never called');
});

test('promptText writes one sentence for every kind x mode', () => {
  const note = build({ kind: 'note', mode: 'find', count: 1 })[0];
  assert.equal(note.prompt, `Find ${note.noteName} on string ${note.target.s}`);

  const degree = build({ kind: 'degree', mode: 'find', count: 1 })[0];
  assert.equal(degree.prompt, `Find the ${degree.degreeLabel} on string ${degree.target.s}`);

  const interval = build({ kind: 'interval', mode: 'find', count: 1 })[0];
  assert.equal(
    interval.prompt,
    `Find the ${interval.intervalName} above ${interval.rootName} on string ${interval.target.s}`,
  );
  assert.ok(INTERVAL_NAMES.includes(interval.intervalName));
  assert.equal(interval.intervalName, INTERVAL_NAMES[interval.target.iv]);

  assert.equal(build({ kind: 'note', mode: 'name', count: 1 })[0].prompt, 'Which note is lit?');
  assert.equal(build({ kind: 'degree', mode: 'name', count: 1 })[0].prompt, 'Which degree is lit?');

  for (const { kind } of pairs()) {
    const question = build({ kind, mode: 'find', count: 1 })[0];
    assert.equal(promptText(question, 'find'), question.prompt);
    assert.equal(
      promptText(question, 'name'),
      kind === 'degree' ? 'Which degree is lit?' : 'Which note is lit?',
    );
  }
  assert.equal(promptText(null, 'find'), '');
});

test('an interval question puts the root on the same string inside frets 1-19', () => {
  const questions = build({ kind: 'interval', mode: 'find' });
  assert.ok(questions.length > 0);
  for (const question of questions) {
    const rootFret = question.target.f - question.target.iv;
    assert.ok(rootFret >= 1, `root fret ${rootFret} is below the nut`);
    assert.equal(question.rootName, NAMES[mod12(question.target.midi - question.target.iv)]);
  }
});

test('an interval whose root falls outside 1-19 is rejected instead of asked', () => {
  // iv 7 five frets above the nut puts the root at fret -2: no question exists.
  const hostile = [{ s: 6, f: 1, midi: 41, iv: 7 }];
  const options = {
    pool: hostile, names: NAMES, degrees: DEGREES, intervals: INTERVALS,
    intervalNames: INTERVAL_NAMES, kind: 'interval', mode: 'find', rng: seededRng(1),
  };
  assert.deepEqual(buildQuestions(options), []);
  // The same cell asks fine as a plain note, so the rejection is about the root only.
  assert.equal(buildQuestions({ ...options, kind: 'note' }).length, 1);
  // ...and an out-of-range fret is not a question either.
  assert.deepEqual(buildQuestions({ ...options, pool: [{ s: 6, f: 20, midi: 60, iv: 0 }] }), []);
});

test('questionMode hands the level-4 recall to Find form', () => {
  const nameQuestion = build({ kind: 'note', mode: 'name', count: 1 })[0];
  assert.equal(questionMode(nameQuestion, 0), 'name');
  assert.equal(questionMode(nameQuestion, 1), 'name');
  assert.equal(questionMode(nameQuestion, 2), 'name');
  assert.equal(questionMode(nameQuestion, 3), 'find');

  const findQuestion = build({ kind: 'note', mode: 'find', count: 1 })[0];
  assert.equal(questionMode(findQuestion, 3), 'find');
  assert.equal(questionMode(null, 3), 'find');
});

test('the effective mode drives the prompt and the chips, so a recall stays answerable', () => {
  const question = build({ kind: 'note', mode: 'name', count: 1 })[0];
  const findPrompt = promptText(question, 'find');
  assert.equal(findPrompt, `Find ${question.noteName} on string ${question.target.s}`);
  assert.ok(!/Which note is lit/.test(findPrompt), 'the recall names its target');

  assert.deepEqual(chipsFor(question, 'find'), question.findChips);
  assert.deepEqual(chipsFor(question, 'name'), question.chips);
  assert.ok(chipsFor(question, 'find').some(chip => chip.value === question.target.f));

  assert.equal(judge(question, { chip: question.target.f }, 'find'), true);
  assert.equal(judge(question, { chip: question.answerChip }, 'find'), false);
  assert.equal(judge(question, { chip: question.answerChip }, 'name'), true);
  assert.equal(judge(question, { chip: question.target.f }, 'name'), false);
});

test('judge agrees for a cell answer and a chip answer in the question own mode', () => {
  for (const { kind, mode } of pairs()) {
    const question = build({ kind, mode, count: 1 })[0];
    assert.equal(judge(question, { s: question.target.s, f: question.target.f }, mode), true);
    const chip = mode === 'find' ? question.target.f : question.answerChip;
    assert.equal(judge(question, { chip }, mode), true);

    const otherFret = question.target.f === 19 ? 18 : question.target.f + 1;
    assert.equal(judge(question, { s: question.target.s, f: otherFret }, mode), false);
    const otherString = (question.target.s % 6) + 1;
    assert.equal(judge(question, { s: otherString, f: question.target.f }, mode), false);
    const wrongChip = question.chips.find(entry => entry.label !== question.answerChip);
    assert.equal(judge(question, { chip: wrongChip.value }, mode), false);
  }
  assert.equal(judge(null, { s: 1, f: 1 }, 'find'), false);
  assert.equal(judge({}, null, 'find'), false);
});

test('a question carries the pool label it was built with', () => {
  const label = poolLabel({ keyName: 'A', scaleName: 'minor pentatonic', positionName: 'Position 1' });
  const question = build({ count: 1, label })[0];
  assert.equal(question.poolLabel, label);
  assert.equal(question.poolLabel, 'A minor pentatonic · Position 1');
  assert.equal(build({ count: 1 })[0].poolLabel, '');
});

// ---------- The by-string result formatters (03-01 Task 3) ----------
// The result panel renders this list; it is a pure function of the summary's byString
// rows, so it is pinned here next to the question plan those rows are counted from.
test('byStringRows is always six rows in string order and says not asked', () => {
  const rows = byStringRows([{ s: 1, asked: 2, correct: 2 }, { s: 3, asked: 3, correct: 1 }]);
  assert.equal(rows.length, 6, 'always six rows');
  assert.deepEqual(rows.map(row => row.s), [1, 2, 3, 4, 5, 6], 'numeric order 1 -> 6');
  assert.deepEqual(rows[0], { s: 1, asked: 2, correct: 2, text: 'String 1', meta: '2 of 2 correct.' });
  assert.deepEqual(rows[2], { s: 3, asked: 3, correct: 1, text: 'String 3', meta: '1 of 3 correct.' });
  // The string with no question says so in words, never "0 of 0" and never a bare dash.
  assert.deepEqual(rows[3], { s: 4, asked: 0, correct: 0, text: 'String 4 · not asked.', meta: '' });
  for (const index of [1, 4, 5]) {
    assert.equal(rows[index].text, `String ${rows[index].s} · not asked.`);
    assert.equal(rows[index].meta, '');
  }
  // A missing, malformed or out-of-range row never changes the count or the order.
  assert.equal(byStringRows().length, 6);
  assert.equal(byStringRows(null).length, 6);
  assert.equal(byStringRows([{ s: 9, asked: 1, correct: 1 }]).filter(row => row.asked > 0).length, 0);
  assert.equal(byStringRows([{ s: 2, asked: 1, correct: 1 }, { s: 2, asked: 4, correct: 0 }])[1].asked, 1, 'the first row for a string wins');
  assert.equal(byStringRows([{ s: 2, asked: -3, correct: 'x' }])[1].asked, 0, 'counts are clamped to whole numbers');
  assert.equal(byStringRows([{ s: 2, asked: -3, correct: 'x' }])[1].correct, 0);
});

test('weakestString is the lowest ratio, ties broken by string, null when nothing was asked', () => {
  assert.equal(weakestString([]), null, 'no rows, no weakest string');
  assert.equal(weakestString([{ s: 1, asked: 0, correct: 0 }]), null, 'an unasked string is never weakest');
  assert.equal(weakestString([{ s: 1, asked: 2, correct: 2 }, { s: 5, asked: 4, correct: 1 }]).s, 5);
  assert.deepEqual(weakestString([{ s: 1, asked: 2, correct: 2 }, { s: 5, asked: 4, correct: 1 }]), { s: 5, asked: 4, correct: 1, text: 'String 5', meta: '1 of 4 correct.' });
  // Equal ratios tie-break on the lowest string number, whatever the input order.
  assert.equal(weakestString([{ s: 5, asked: 2, correct: 1 }, { s: 2, asked: 4, correct: 2 }]).s, 2);
  assert.equal(weakestString([{ s: 2, asked: 4, correct: 2 }, { s: 5, asked: 2, correct: 1 }]).s, 2);
  // An unasked string sitting beside an asked one can never win.
  assert.equal(weakestString([{ s: 1, asked: 2, correct: 2 }, { s: 2, asked: 0, correct: 0 }]).s, 1);
  assert.equal(weakestString([{ s: 6, asked: 1, correct: 0 }]).s, 6, 'zero correct is the weakest there is');
});

