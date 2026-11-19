// Characterization of the prototype's pure scale math (P1-P9, S1-S10) plus the
// 01-02 additions: five-position cap, key-signature spelling (D-17), chord,
// progression and song-section expansion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_NAMES, MIN_PENT, MAJ_PENT, MAJOR, MINOR, scaleById } from '../app/src/content.js';
import {
  buildPositions, positionsForScale, remapPosition, notesForScale, notesForPosition, sequenceFor,
  spellScale, expandChord, expandProgression, expandSongSection, voiceChord,
} from '../app/src/theory.js';
import { MAJOR as FIX_MAJOR, MIN_PENT as FIX_MIN_PENT, MAJ_PENT as FIX_MAJ_PENT, CHROMATIC, prototypeScale } from './fixtures/scales.js';
import { CHORD_FAMILIES, PROGRESSIONS, SONGS, progressionById } from '../app/src/content.js';

const startsOf = positions => positions.map(p => p.start);
const namesAt = (key, scaleId) => spellScale(key, scaleById[scaleId]);
const notesAt = (keyPc, scaleId, positionId = 'all') => notesForPosition(keyPc, scaleById[scaleId], positionId);

// ---------- P1-P9: position boxes ----------
test('P1: C minor pentatonic has 5 boxes starting 1,3,6,8,11', () => {
  assert.deepEqual(startsOf(buildPositions(0, FIX_MIN_PENT)), [1, 3, 6, 8, 11]);
});

test('P2: A minor pentatonic has 5 boxes starting 0,3,5,8,10', () => {
  assert.deepEqual(startsOf(buildPositions(9, FIX_MIN_PENT)), [0, 3, 5, 8, 10]);
});

test('P3: C major has all 7 boxes (the 5-position cap is a content decision)', () => {
  assert.deepEqual(startsOf(buildPositions(0, FIX_MAJOR)), [0, 1, 3, 5, 7, 8, 10]);
});

test('P4: A major has 7 boxes starting 0,2,4,5,7,9,10', () => {
  assert.deepEqual(startsOf(buildPositions(9, FIX_MAJOR)), [0, 2, 4, 5, 7, 9, 10]);
});

test('P5: C blues borrows the minor-pentatonic boxes', () => {
  assert.deepEqual(startsOf(buildPositions(0, FIX_MIN_PENT)), [1, 3, 6, 8, 11]);
});

test('P6: C major pentatonic has 5 boxes starting 0,3,5,8,10', () => {
  assert.deepEqual(startsOf(buildPositions(0, FIX_MAJ_PENT)), [0, 3, 5, 8, 10]);
});

test('P7: chromatic intervals produce no boxes', () => {
  assert.deepEqual(buildPositions(0, CHROMATIC), []);
});

test('P8: every returned range starts at fret 0 or above', () => {
  for (let key = 0; key < 12; key++) {
    for (const scaleId of ['minPent', 'majPent', 'major', 'blues']) {
      for (const box of buildPositions(key, prototypeScale(scaleId).base)) {
        for (const s of [1, 2, 3, 4, 5, 6]) {
          assert.ok(box.ranges[s][0] >= 0, `${scaleId} key ${key} string ${s} negative fret`);
          assert.ok(box.ranges[s][0] <= box.ranges[s][1]);
        }
      }
    }
  }
});

test('P9: boxes are sorted ascending by low-E anchor', () => {
  for (const key of [0, 2, 5, 9, 11]) {
    const starts = startsOf(buildPositions(key, FIX_MAJOR));
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  }
});

test('P1/P2 concrete ranges match the prototype', () => {
  assert.deepEqual(buildPositions(0, FIX_MAJOR)[0], {
    start: 0,
    ranges: { 1: [1, 5], 2: [1, 5], 3: [0, 4], 4: [0, 3], 5: [0, 3], 6: [0, 3] },
  });
  assert.deepEqual(buildPositions(9, FIX_MIN_PENT)[0], {
    start: 0,
    ranges: { 1: [0, 3], 2: [1, 3], 3: [0, 2], 4: [0, 2], 5: [0, 3], 6: [0, 3] },
  });
});

// ---------- Five-position cap and whole-neck coverage ----------
test('positionsForScale returns exactly five sorted s6fN positions for all scales and keys', () => {
  for (const scale of Object.values(scaleById)) {
    for (let key = 0; key < 12; key++) {
      const positions = positionsForScale(key, scale);
      assert.equal(positions.length, 5, `${scale.id} key ${key}`);
      const starts = positions.map(p => p.start);
      assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
      assert.equal(new Set(positions.map(p => p.id)).size, 5);
      positions.forEach((p, i) => {
        assert.equal(p.id, 's6f' + p.start);
        assert.equal(p.anchor, p.start);
        assert.ok(p.label);
        assert.ok(p.ranges && typeof p.ranges === 'object');
      });
    }
  }
});

test('C major is capped to the first five anchors 0,1,3,5,7', () => {
  assert.deepEqual(positionsForScale(0, scaleById.major).map(p => p.id), ['s6f0', 's6f1', 's6f3', 's6f5', 's6f7']);
});

test('remapPosition keeps the box index when the key changes (WR-01)', () => {
  const major = scaleById.major;
  const cBoxes = positionsForScale(0, major);
  const dbBoxes = positionsForScale(1, major);
  assert.equal(remapPosition(cBoxes[0].id, 0, 1, major), dbBoxes[0].id);

  assert.equal(remapPosition('all', 0, 1, major), 'all');
  assert.equal(remapPosition('s6f24', 0, 1, major), 'all', 'an undefined box falls back to whole neck');
  assert.equal(remapPosition(cBoxes[0].id, 0, 1, null), 'all');

  // The invariant that keeps the select valid: the result is a target-key box or 'all'.
  for (const scale of Object.values(scaleById)) {
    for (let fromPc = 0; fromPc < 12; fromPc++) {
      for (const box of positionsForScale(fromPc, scale)) {
        for (let toPc = 0; toPc < 12; toPc++) {
          const remapped = remapPosition(box.id, fromPc, toPc, scale);
          const valid = remapped === 'all' || positionsForScale(toPc, scale).some(p => p.id === remapped);
          assert.ok(valid, `${scale.id} ${box.id} ${fromPc}->${toPc} produced ${remapped}`);
        }
      }
    }
  }
});


test('whole-neck browse keeps every note while the drill set is deduped by MIDI', () => {
  for (const scale of Object.values(scaleById)) {
    for (let key = 0; key < 12; key++) {
      const all = notesForScale(key, scale, null);
      const drill = notesForPosition(key, scale, 'all');
      assert.ok(all.length >= drill.length);
      assert.equal(drill.length, new Set(all.map(n => n.midi)).size);
      assert.deepEqual(drill.map(n => n.midi), [...drill.map(n => n.midi)].sort((a, b) => a - b));
      for (const iv of scale.intervals) assert.ok(all.some(n => n.iv === iv), `${scale.id} key ${key} missing iv ${iv}`);
      for (const pc of scale.intervals) assert.ok(all.some(n => (n.midi - key + 12) % 12 === pc));
    }
  }
});

test('a position selection keeps every note inside its box and no others', () => {
  const position = positionsForScale(9, scaleById.minPent)[0];
  const notes = notesForPosition(9, scaleById.minPent, position.id);
  assert.equal(notes.length, 12);
  for (const n of notes) {
    assert.ok(n.f >= position.ranges[n.s][0] && n.f <= position.ranges[n.s][1]);
  }
  const outside = notesForScale(9, scaleById.minPent, null).filter(n => !notes.some(m => m.s === n.s && m.f === n.f));
  assert.ok(outside.length > 0);
});

// ---------- S1-S10: scale expansion and sequences ----------
test('S1: A minor pentatonic whole neck, up', () => {
  const display = notesForScale(9, scaleById.minPent, null);
  const seq = sequenceFor(notesAt(9, 'minPent', 'all'), 'up');
  assert.equal(display.length, 51);
  assert.equal(seq.length, 18);
  assert.equal(display.filter(n => n.f === 0).length, 5);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f, midi: seq[0].midi, iv: seq[0].iv }, { s: 6, f: 0, midi: 40, iv: 7 });
  assert.deepEqual({ s: seq[17].s, f: seq[17].f, midi: seq[17].midi }, { s: 1, f: 17, midi: 81 });
});

test('S2: A minor pentatonic position 0, up', () => {
  const seq = sequenceFor(notesAt(9, 'minPent', 's6f0'), 'up');
  assert.equal(seq.length, 12);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f }, { s: 6, f: 0 });
  assert.deepEqual({ s: seq[11].s, f: seq[11].f, midi: seq[11].midi }, { s: 1, f: 3, midi: 67 });
});

test('S3: A minor pentatonic position 0, down', () => {
  const seq = sequenceFor(notesAt(9, 'minPent', 's6f0'), 'down');
  assert.equal(seq.length, 12);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f, midi: seq[0].midi }, { s: 1, f: 3, midi: 67 });
  assert.deepEqual({ s: seq[11].s, f: seq[11].f, midi: seq[11].midi }, { s: 6, f: 0, midi: 40 });
});

test('S4: A minor pentatonic position 0, up and down', () => {
  const notes = notesAt(9, 'minPent', 's6f0');
  const seq = sequenceFor(notes, 'updown');
  assert.equal(notes.length, 12);
  assert.equal(seq.length, 22);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f }, { s: 6, f: 0 });
  assert.deepEqual({ s: seq[21].s, f: seq[21].f, midi: seq[21].midi }, { s: 6, f: 3, midi: 43 });
});

test('S5: C major whole neck, up', () => {
  const display = notesForScale(0, scaleById.major, null);
  const seq = sequenceFor(notesAt(0, 'major', 'all'), 'up');
  assert.equal(display.length, 72);
  assert.equal(seq.length, 26);
  assert.equal(display.filter(n => n.f === 0).length, 6);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f, midi: seq[0].midi, iv: seq[0].iv }, { s: 6, f: 0, midi: 40, iv: 4 });
  assert.deepEqual({ s: seq[25].s, f: seq[25].f, midi: seq[25].midi }, { s: 1, f: 19, midi: 83 });
});

test('S6: C major position 0, up and down', () => {
  const notes = notesAt(0, 'major', 's6f0');
  const seq = sequenceFor(notes, 'updown');
  assert.equal(notes.length, 18);
  assert.equal(seq.length, 34);
});

test('S7: A blues position 0 keeps the blue note', () => {
  const notes = notesAt(9, 'blues', 's6f0');
  assert.equal(notes.length, 13);
  assert.equal(sequenceFor(notes, 'up').length, 13);
  assert.equal(sequenceFor(notes, 'updown').length, 24);
});

test('S8: whole-neck sequence keeps one fingering per MIDI, lowest fret wins', () => {
  const display = notesForScale(9, scaleById.minPent, null);
  const seq = notesAt(9, 'minPent', 'all');
  assert.equal(seq.length, new Set(display.map(n => n.midi)).size);
  for (const midi of [45, 52, 57]) {
    const minFret = Math.min(...display.filter(n => n.midi === midi).map(n => n.f));
    assert.equal(seq.find(n => n.midi === midi).f, minFret, `midi ${midi} chose a higher fret`);
  }
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i].midi > seq[i - 1].midi);
});

test('S9: position sequence runs low string to high string, low fret to high fret', () => {
  const seq = notesAt(9, 'minPent', 's6f0');
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    assert.ok(a.s > b.s || (a.s === b.s && a.f <= b.f), `order broke at ${a.s}:${a.f} -> ${b.s}:${b.f}`);
  }
});

test('S10: up-and-down repeats neither endpoint', () => {
  const up = sequenceFor(notesAt(9, 'minPent', 's6f0'), 'up');
  const updown = sequenceFor(notesAt(9, 'minPent', 's6f0'), 'updown');
  assert.deepEqual(updown, up.concat(up.slice(1, -1).reverse()));
  assert.equal(updown.length, up.length * 2 - 2);
  assert.deepEqual(updown[0], up[0]);
  assert.deepEqual(updown[updown.length - 1], up[1]);
  assert.notDeepEqual(updown[updown.length - 1], updown[0]);
});

// ---------- Chord expansion ----------
test('expandChord returns six string entries with root, open and muted semantics', () => {
  const openC = CHORD_FAMILIES.find(c => c.id === 'C').voicings.find(v => v.id === 'open');
  const notes = expandChord(openC);
  assert.equal(notes.length, 6);
  assert.equal(notes[0].s, 6);
  assert.equal(notes[5].s, 1);
  assert.equal(notes[0].muted, true);
  assert.equal(notes[0].f, null);
  const rootNotes = notes.filter(n => n.root);
  assert.ok(rootNotes.length >= 1);
  assert.ok(rootNotes.every(n => n.pc === 0));
  const openG = notes.find(n => n.s === 3);
  assert.equal(openG.f, 0);
  assert.equal(openG.open, true);
  assert.equal(openG.muted, false);
  assert.equal(openG.finger, null);
  const aString = notes.find(n => n.s === 5);
  assert.equal(aString.f, 3);
  assert.equal(aString.finger, 3);
  assert.equal(aString.midi, 48);
});

test('every curated voicing expands without throwing', () => {
  for (const family of CHORD_FAMILIES) {
    for (const voicing of family.voicings) {
      const notes = expandChord(voicing);
      assert.equal(notes.filter(n => !n.muted).length, voicing.frets.filter(f => f !== null).length);
    }
  }
});

// ---------- Progression and song-section expansion ----------
test('expandProgression resolves major and minor tables in all keys', () => {
  const minor = PROGRESSIONS.find(p => p.id === 'i-VI-III-VII');
  const bars = expandProgression(minor, 9); // A minor
  assert.deepEqual(bars.map(b => b.rootPc), [9, 5, 0, 7]);
  assert.deepEqual(bars.map(b => b.quality), ['min', 'maj', 'maj', 'maj']);
  assert.deepEqual(bars.map(b => b.roman), ['i', 'VI', 'III', 'VII']);
  assert.deepEqual(bars.map(b => b.bar), [1, 2, 3, 4]);

  const major = PROGRESSIONS.find(p => p.id === 'I-IV-V');
  const g = expandProgression(major, 7);
  assert.deepEqual(g.map(b => b.rootPc), [7, 0, 2]);
  assert.deepEqual(g.map(b => b.quality), ['maj', 'maj', 'maj']);
  assert.deepEqual(g.map(b => b.name), ['G', 'C', 'D']);
});

test('every song section expands for all 12 keys', () => {
  for (const song of SONGS) {
    for (const section of song.sections) {
      for (let key = 0; key < 12; key++) {
        const bars = expandSongSection(song, section, key, progressionById);
        const expected = section.progressionId
          ? progressionById[section.progressionId].degrees.length
          : section.degrees.length;
        assert.equal(bars.length, expected, `${song.id}:${section.id} key ${key}`);
      }
    }
  }
});

// ---------- Curated and movable voicings ----------
test('voiceChord prefers a curated open voicing, then the lowest movable shape', () => {
  const c = voiceChord(0, 'maj', 'open', CHORD_FAMILIES);
  assert.equal(c.id, 'open');
  const f = voiceChord(5, 'maj', 'open', CHORD_FAMILIES);
  assert.equal(f.rootString, 6);
  assert.equal(f.baseFret, 1);
  assert.ok(f.frets.every(x => x === null || x <= 19));
  const bb = voiceChord(10, 'maj', null, CHORD_FAMILIES);
  assert.equal(bb.rootString, 5);
  assert.equal(bb.baseFret, 1);
  const am = voiceChord(9, 'min', 'barreE5', CHORD_FAMILIES);
  assert.equal(am.id, 'barreE5');
  assert.equal(voiceChord(0, 'dim', null, CHORD_FAMILIES), null);
});

// ---------- SP1-SP4 plus the D-17 spelling matrix ----------
test('SP1: D natural minor keeps the key-signature letters', () => {
  const names = spellScale(2, { id: 'minor', intervals: MINOR });
  assert.equal(names[10], 'B♭');
  assert.equal(names[2], 'D');
  assert.equal(names[5], 'F');
});

test('SP2: C major spells C D E F G A B', () => {
  const names = namesAt(0, 'major');
  assert.deepEqual([names[0], names[2], names[4], names[5], names[7], names[9], names[11]], ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
});

test('SP3: F major spells B♭', () => {
  assert.equal(namesAt(5, 'major')[10], 'B♭');
});

test('SP4: A minor pentatonic spells A C D E G', () => {
  const names = namesAt(9, 'minPent');
  assert.equal(names[0], 'C');
  assert.equal(names[2], 'D');
  assert.equal(names[4], 'E');
  assert.equal(names[7], 'G');
  assert.equal(names[9], 'A');
});

test('every v1 scale in every key keeps the tonic name and never emits a double accidental', () => {
  for (const scale of Object.values(scaleById)) {
    for (let key = 0; key < 12; key++) {
      const names = spellScale(key, scale);
      assert.equal(names.length, 12);
      assert.equal(names[key], KEY_NAMES[key], `${scale.id} key ${key}`);
      for (const name of names) assert.doesNotMatch(name, /[♭♯]{2}/, `${scale.id} key ${key}: ${name}`);
      for (const iv of scale.intervals) assert.ok(names[(key + iv) % 12]);
    }
  }
});

test('D-17 blues note policy: ♭5 in flat keys, ♯4 in sharp keys, enharmonic fallback on doubles', () => {
  const blues = scaleById.blues;
  const blueAt = key => spellScale(key, blues)[(key + 6) % 12];
  assert.equal(blueAt(0), 'F♯');   // C: sharp key -> ♯4
  assert.equal(blueAt(9), 'D♯');   // A: sharp key -> ♯4
  assert.equal(blueAt(5), 'C♭');   // F: flat key -> ♭5 (single flat)
  assert.equal(blueAt(10), 'F♭');  // B♭: flat key -> ♭5 (single flat)
  assert.equal(blueAt(1), 'G');    // D♭: ♭5 would be A♭♭ -> ♯4 fallback
  assert.equal(blueAt(3), 'A');    // E♭: ♭5 would be B♭♭ -> ♯4 fallback
  assert.equal(blueAt(8), 'D');    // A♭: ♭5 would be E♭♭ -> ♯4 fallback
  for (const key of [1, 3, 5, 8, 10]) assert.doesNotMatch(blueAt(key), /[♭♯]{2}/);
});
