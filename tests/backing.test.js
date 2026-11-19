// Backing contract: a meter-aware pattern table, one flat beat-stamped event list with a
// meter-correct count-in and a one-bar ending, and no millisecond anywhere in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, patternFor, backingEvents } from '../app/src/backing.js';

// One chord per bar, shaped the way a chart supplies it: a bass root and the pad's voicing.
const chordsFor = (bars, rootMidi = 40) => Array.from({ length: bars }, (_, bar) => ({
  rootMidi: rootMidi + (bar % 4),
  padMidis: [52 + (bar % 4), 55 + (bar % 4), 59 + (bar % 4)],
}));

const typesAt = (events, beat) => events.filter(e => e.beat === beat).map(e => e.type);

test('PATTERNS[4] is the four-four bar: kick on 1 and 3, snare on 2 and 4, hats on the eighths', () => {
  const hits = PATTERNS[4];
  assert.deepEqual(hits.map(h => [h.beat, h.type]), [
    [0, 'kick'], [2, 'kick'], [1, 'snare'], [3, 'snare'],
    [0.5, 'hat'], [1.5, 'hat'], [2.5, 'hat'], [3.5, 'hat'],
    [0, 'bass'], [2, 'bass'], [0, 'pad'],
  ]);
  assert.deepEqual(hits.filter(h => h.accent).map(h => [h.beat, h.type]), [[0, 'kick']], 'only beat 1 is accented');
  // A one-shot transient is dry; only the sustained voices carry a length.
  assert.deepEqual(hits.filter(h => h.durBeats).map(h => [h.type, h.beat, h.durBeats]), [
    ['bass', 0, 2], ['bass', 2, 2], ['pad', 0, 4],
  ]);
  assert.equal(hits.length, 11, 'two kicks, two snares, four hats, two basses and one pad');
});

test('PATTERNS[3] is the three-four bar: kick on 1, snare on 2 and 3, hats on the beats', () => {
  const hits = PATTERNS[3];
  assert.deepEqual(hits.map(h => [h.beat, h.type]), [
    [0, 'kick'], [1, 'snare'], [2, 'snare'],
    [0, 'hat'], [1, 'hat'], [2, 'hat'],
    [0, 'bass'], [0, 'pad'],
  ]);
  assert.deepEqual(hits.filter(h => h.accent).map(h => [h.beat, h.type]), [[0, 'kick']]);
  assert.deepEqual(hits.filter(h => h.durBeats).map(h => [h.type, h.durBeats]), [
    ['bass', 3], ['pad', 3],
  ], 'a three-beat bar holds its bass and its pad for the whole bar');
  assert.equal(hits.length, 8);
});

test('patternFor returns the meter table and falls back to four-four for an unknown meter', () => {
  assert.equal(patternFor(3), PATTERNS[3]);
  assert.equal(patternFor(4), PATTERNS[4]);
  assert.equal(patternFor(6), PATTERNS[4], 'an unknown meter falls back rather than playing an empty bar');
  assert.equal(patternFor(undefined), PATTERNS[4]);
});

test('a one-bar four-four pass is 26 events and the bar line carries click, kick, bass and pad', () => {
  const events = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 1, chords: chordsFor(1) });
  assert.equal(events.length, 26, '4 count-in clicks + 4 bar clicks + 11 hits + an ending bar of 7');

  const barLine = events.filter(e => e.beat === 4);
  assert.deepEqual(barLine.map(e => [e.type, e.accent === true]), [
    ['click', true], ['kick', true], ['bass', false], ['pad', false],
  ]);
  assert.equal(barLine.find(e => e.type === 'bass').midi, 40);
  assert.equal(barLine.find(e => e.type === 'bass').durBeats, 2);
  assert.deepEqual(barLine.find(e => e.type === 'pad').midis, [52, 55, 59]);
  assert.equal(barLine.find(e => e.type === 'pad').durBeats, 4);

  // Without a count-in the first four events are the bar-line chord itself.
  const immediate = backingEvents({ beatsPerBar: 4, countInBeats: 0, bars: 1, chords: chordsFor(1) });
  assert.equal(immediate.length, 22);
  assert.deepEqual(immediate.slice(0, 4).map(e => [e.beat, e.type]), [
    [0, 'click'], [0, 'kick'], [0, 'bass'], [0, 'pad'],
  ]);
});

test('the count-in is one bar of clicks with only beat 1 accented, in either meter', () => {
  const four = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 1, chords: chordsFor(1) });
  assert.deepEqual(four.filter(e => e.beat < 4).map(e => [e.beat, e.type, e.accent]), [
    [0, 'click', true], [1, 'click', false], [2, 'click', false], [3, 'click', false],
  ]);

  const three = backingEvents({ beatsPerBar: 3, countInBeats: 3, bars: 1, chords: chordsFor(1) });
  assert.deepEqual(three.filter(e => e.beat < 3).map(e => [e.beat, e.type, e.accent]), [
    [0, 'click', true], [1, 'click', false], [2, 'click', false],
  ]);

  // Without an explicit count-in the meter supplies it: one bar of the chart's own beats.
  const defaulted = backingEvents({ beatsPerBar: 3, bars: 1, chords: chordsFor(1) });
  assert.deepEqual(defaulted.filter(e => e.beat < 3 && e.type === 'click').map(e => [e.beat, e.accent]), [
    [0, true], [1, false], [2, false],
  ]);
  assert.equal(defaulted.filter(e => e.beat < 3).length, 3, 'a three-four pass counts in three beats, not four');
});

test('the ending bar fires one accented kick, one bass, one pad and a full bar of clicks', () => {
  const events = backingEvents({ beatsPerBar: 3, countInBeats: 3, bars: 2, chords: chordsFor(2, 45) });
  const base = 3 + 2 * 3;
  assert.equal(Math.max(...events.map(e => e.beat)), base + 2, 'the pass stops at the end of the ending bar');

  const ending = events.filter(e => e.beat >= base);
  assert.deepEqual(typesAt(events, base), ['kick', 'bass', 'pad', 'click']);
  assert.equal(ending.find(e => e.type === 'kick').accent, true);
  assert.equal(ending.find(e => e.type === 'bass').midi, chordsFor(2, 45)[1].rootMidi, 'the ending holds the last chord');
  assert.equal(ending.find(e => e.type === 'bass').durBeats, 3);
  assert.deepEqual(ending.find(e => e.type === 'pad').midis, chordsFor(2, 45)[1].padMidis);
  assert.equal(ending.find(e => e.type === 'pad').durBeats, 3);
  assert.deepEqual(ending.filter(e => e.type === 'click').map(e => [e.beat, e.accent]), [
    [base, true], [base + 1, false], [base + 2, false],
  ]);
});

test('every event is beat-stamped and carries no millisecond, time or date key', () => {
  const events = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 12, chords: chordsFor(12) });
  for (const event of events) {
    assert.ok(Number.isFinite(event.beat), `beat ${event.beat} must be a finite number of beats`);
    assert.equal(typeof event.type, 'string');
    for (const banned of ['ms', 'time', 'when', 'date']) {
      assert.ok(!(banned in event), `${event.type} at beat ${event.beat} carries a ${banned}`);
    }
  }
  const beats = events.map(e => e.beat);
  assert.deepEqual(beats, [...beats].sort((a, b) => a - b), 'the list is sorted by beat');
});

test('a chart with fewer chords than bars drops the bass and pad for the bars with no pitch', () => {
  const one = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 2, chords: chordsFor(1) });
  assert.equal(one.filter(e => e.type === 'bass').length, 2, 'only the voiced bar gets its two bass hits');
  assert.equal(one.filter(e => e.type === 'pad').length, 1, 'only the voiced bar gets its pad');
  assert.deepEqual(one.filter(e => e.type === 'bass').map(e => e.midi), [40, 40]);
  for (const pad of one.filter(e => e.type === 'pad')) assert.ok(Array.isArray(pad.midis) && pad.midis.length);
  // The drums and the clicks keep playing through the unvoiced bar.
  assert.equal(one.filter(e => e.type === 'kick').length, 5, 'two kicks per bar plus the ending');
  assert.equal(one.filter(e => e.type === 'snare').length, 4);
  assert.equal(one.filter(e => e.type === 'hat').length, 8);
  assert.equal(one.filter(e => e.type === 'click').length, 16, 'count-in, two bars and the ending');

  const none = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 2, chords: [] });
  assert.equal(none.filter(e => e.type === 'bass').length, 0);
  assert.equal(none.filter(e => e.type === 'pad').length, 0);
  assert.equal(none.filter(e => e.type === 'kick').length, 5, 'a voiceless chart is still a drum bar');
  for (const event of none) {
    if (event.type === 'bass') assert.ok(Number.isFinite(event.midi));
    if (event.type === 'pad') assert.ok(Array.isArray(event.midis) && event.midis.length);
  }
});

test('a pad voicing is copied, so a caller cannot mutate an event through its chord', () => {
  const chords = chordsFor(1);
  const events = backingEvents({ beatsPerBar: 4, countInBeats: 0, bars: 1, chords });
  const pad = events.find(e => e.type === 'pad' && e.beat === 0);
  assert.notEqual(pad.midis, chords[0].padMidis);
  pad.midis[0] = 99;
  assert.equal(chords[0].padMidis[0], 52);
});

test('bars: 0 yields only the count-in, and a hostile bar count is bounded, not trusted', () => {
  const onlyCountIn = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 0, chords: chordsFor(4) });
  assert.deepEqual(onlyCountIn.map(e => [e.beat, e.type, e.accent]), [
    [0, 'click', true], [1, 'click', false], [2, 'click', false], [3, 'click', false],
  ]);
  for (const bars of [-3, 2.5, NaN, Infinity, '4', null]) {
    const events = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars, chords: chordsFor(4) });
    assert.equal(events.length, 4, `bars ${bars} must not generate chart bars`);
  }
  // IN-02: the ceiling is what makes the claim a bound rather than an absence. A crafted
  // `1e9` is clamped to 64 bars — it cannot spin the scheduler — and a crafted count-in is
  // clamped to 32 clicks.
  const huge = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 1e9, chords: [] });
  assert.ok(huge.length > 64 * 11, 'the clamped chart still schedules its 64 bars');
  assert.ok(huge.length < 64 * 15 + 8, `a hostile bar count stays bounded, got ${huge.length}`);
  assert.equal(huge[huge.length - 1].beat, 4 + 64 * 4 + 3, 'the last event is the ending bar\'s last click');
  const hugeCountIn = backingEvents({ beatsPerBar: 4, countInBeats: 1e9, bars: 1, chords: [] });
  assert.equal(hugeCountIn.filter(e => e.type === 'click' && e.beat < 32).length, 32);
  assert.equal(hugeCountIn.filter(e => e.type === 'kick').length, 3, 'two kicks in bar 1 and the ending hit');
});

test('a sixteen-bar four-four chart stays under the 400-event bound', () => {
  const events = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 16, chords: chordsFor(16) });
  assert.equal(events.length, 251, '4 count-in + 16 bars x 15 + an ending bar of 7');
  assert.ok(events.length < 400, 'the crafted chart cannot flood the scheduler (T-04-01)');
});

test('an unknown meter falls back to four-four rather than producing an empty bar', () => {
  const events = backingEvents({ beatsPerBar: 7, countInBeats: 7, bars: 1, chords: chordsFor(1) });
  assert.deepEqual(typesAt(events, 7), ['click', 'kick', 'bass', 'pad']);
  assert.equal(events.filter(e => e.beat < 7 && e.type === 'click').length, 7);
});
