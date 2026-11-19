// v1 content cap, stable semantic IDs, voicings, progressions, songs and version separation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_VERSION, SCALES, CHORD_FAMILIES, PROGRESSIONS, SONGS,
  scaleById, chordById, progressionById, songById, SCALE_BY_ID, LESSONS, lessonFor,
} from '../app/src/content.js';
import { expandChord, expandProgression, expandSongSection, spellPitch } from '../app/src/theory.js';
import { DEFAULT_SETTINGS, DRILL_FAMILIES, SCHEMA_VERSION } from '../app/src/settings.js';

const unique = values => new Set(values).size === values.length;

test('content is capped at 4 scales, 8 chord families, 8 progressions and 4 songs', () => {
  assert.equal(SCALES.length, 4);
  assert.equal(CHORD_FAMILIES.length, 8);
  assert.equal(PROGRESSIONS.length, 8);
  assert.ok(SONGS.length >= 3 && SONGS.length <= 5);
  assert.deepEqual(SCALES.map(s => s.id).sort(), ['blues', 'majPent', 'major', 'minPent']);
  assert.deepEqual(CHORD_FAMILIES.map(c => c.id).sort(), ['A', 'Am', 'C', 'D', 'Dm', 'E', 'Em', 'G']);
});

test('lookup maps are built from the collections and are the same objects', () => {
  assert.deepEqual(Object.keys(scaleById).sort(), SCALES.map(s => s.id).sort());
  assert.deepEqual(Object.keys(chordById).sort(), CHORD_FAMILIES.map(c => c.id).sort());
  assert.deepEqual(Object.keys(progressionById).sort(), PROGRESSIONS.map(p => p.id).sort());
  assert.deepEqual(Object.keys(songById).sort(), SONGS.map(s => s.id).sort());
  for (const s of SCALES) assert.equal(scaleById[s.id], s);
  for (const c of CHORD_FAMILIES) assert.equal(chordById[c.id], c);
  assert.equal(SCALE_BY_ID, scaleById);
});

test('IDs are unique, semantic and never array-index derived', () => {
  assert.ok(unique(SCALES.map(s => s.id)));
  assert.ok(unique(CHORD_FAMILIES.map(c => c.id)));
  assert.ok(unique(PROGRESSIONS.map(p => p.id)));
  assert.ok(unique(SONGS.map(s => s.id)));
  for (const family of CHORD_FAMILIES) assert.ok(unique(family.voicings.map(v => v.id)), family.id);
  const ids = [...SCALES, ...CHORD_FAMILIES, ...PROGRESSIONS, ...SONGS].map(x => x.id);
  for (const id of ids) assert.ok(Number.isNaN(Number(id)), `index-like id ${id}`);
  for (const scale of SCALES) assert.doesNotMatch(scale.id, /^s?\d+$/);
});

test('every voicing has six frets/fingers, a playable range and a sounding root', () => {
  for (const family of CHORD_FAMILIES) {
    assert.ok(family.voicings.length >= 2 && family.voicings.length <= 3, family.id);
    for (const voicing of family.voicings) {
      assert.equal(voicing.frets.length, 6, `${family.id}:${voicing.id}`);
      assert.equal(voicing.fingers.length, 6, `${family.id}:${voicing.id}`);
      assert.ok(voicing.baseFret >= 0 && voicing.baseFret <= 19);
      for (const f of voicing.frets) {
        if (f === null) continue;
        assert.ok(Number.isInteger(f) && f >= 0 && f <= 19, `${family.id}:${voicing.id} fret ${f}`);
      }
      if (voicing.barre) {
        assert.ok(voicing.barre.from >= 1 && voicing.barre.from <= 6);
        assert.ok(voicing.barre.to >= 1 && voicing.barre.to <= 6);
      }
      const expansion = expandChord(voicing);
      assert.equal(expansion.length, 6);
      assert.ok(expansion.some(n => !n.muted && n.pc === family.rootPc), `${family.id}:${voicing.id} has no sounding root`);
      const rootNote = expansion.find(n => n.s === voicing.rootString);
      assert.ok(rootNote && !rootNote.muted && rootNote.pc === family.rootPc, `${family.id}:${voicing.id} rootString mismatch`);
      for (const n of expansion) {
        if (n.muted) assert.equal(n.f, null);
        else if (n.open) assert.equal(n.f, 0);
      }
    }
  }
});

test('every progression degree is 1..7 and expands in all 12 keys', () => {
  for (const prog of PROGRESSIONS) {
    assert.equal(prog.barsPerChord, 1);
    assert.ok(['major', 'minor'].includes(prog.mode));
    for (const degree of prog.degrees) assert.ok(Number.isInteger(degree) && degree >= 1 && degree <= 7);
    for (let key = 0; key < 12; key++) {
      const bars = expandProgression(prog, key);
      assert.equal(bars.length, prog.degrees.length, `${prog.id} key ${key}`);
      for (const bar of bars) {
        assert.ok(bar.rootPc >= 0 && bar.rootPc <= 11);
        assert.ok(['maj', 'min', 'dim'].includes(bar.quality));
        assert.ok(bar.name);
        assert.ok(bar.name.startsWith(spellPitch(key, bar.rootPc)), `${prog.id} key ${key} name ${bar.name}`);
      }
    }
  }
});

test('every song section carries exactly one of progressionId/degrees and resolves in all 12 keys', () => {
  for (const song of SONGS) {
    assert.ok(song.title && song.keyPc >= 0 && song.keyPc <= 11);
    assert.equal(song.provenance, 'Traditional, public domain');
    assert.ok(Array.isArray(song.meter) && song.meter.length === 2);
    assert.ok(song.sections.length > 0);
    for (const section of song.sections) {
      const hasProg = Object.hasOwn(section, 'progressionId');
      const hasDegrees = Array.isArray(section.degrees);
      assert.notEqual(hasProg, hasDegrees, `${song.id}:${section.id}`);
      if (hasProg) assert.ok(progressionById[section.progressionId], `${song.id}:${section.id}`);
      if (hasDegrees) for (const d of section.degrees) assert.ok(d >= 1 && d <= 7);
      assert.ok(section.name && Number.isInteger(section.repeats) && section.repeats >= 1);
      for (let key = 0; key < 12; key++) {
        const bars = expandSongSection(song, section, key, progressionById);
        assert.ok(bars.length > 0, `${song.id}:${section.id} key ${key}`);
        assert.ok(bars.every(b => b.rootPc >= 0 && b.rootPc <= 11));
      }
    }
  }
});

test('content version is separate from the settings schema and content imports nothing', () => {
  assert.equal(CONTENT_VERSION, 1);
  assert.equal(SCHEMA_VERSION, 2, 'the store schema is now the settings plus progress record');
  assert.ok(!('contentVersion' in DEFAULT_SETTINGS));
  assert.ok(!('schemaVersion' in scaleById.major));
  const source = fs.readFileSync(fileURLToPath(new URL('../app/src/content.js', import.meta.url)), 'utf8');
  assert.ok(!/from\s+['"]/.test(source), 'content.js must not import');
  assert.ok(!/localStorage|sessionStorage/.test(source), 'content.js must not touch storage');
});

// 05-02 Task 1 (TEACH-01, TEACH-02, D-75) and the materials pass: one micro-lesson per drill
// family, eight fields each, one verified reading address, two external watch/read links and
// one self-hosted silent demo. Nothing is embedded from a third party: the table names pages
// and local files, not remote media or players.
test('every drill family ships one eight-field micro-lesson and nothing else', () => {
  const fields = ['demo', 'link', 'linkLabel', 'mistake', 'practice', 'title', 'videos', 'why'];
  // The table is keyed by the five families the settings already name, so a family can never be
  // added to the picker without a lesson and a lesson can never name a drill the app cannot run.
  assert.deepEqual(Object.keys(LESSONS).sort(), [...DRILL_FAMILIES].sort());
  assert.equal(Object.keys(LESSONS).length, 5, 'exactly five lessons');
  for (const family of DRILL_FAMILIES) {
    const lesson = LESSONS[family];
    const expected = family === 'scaleRun' ? [...fields, 'blues'].sort()
      : family === 'chordChanges' ? [...fields, 'power'].sort()
        : fields;
    assert.deepEqual(Object.keys(lesson).sort(), expected, `${family} does not carry its lesson fields`);
    for (const field of ['title', 'why', 'mistake', 'practice']) {
      assert.equal(typeof lesson[field], 'string', `${family}.${field} is not a string`);
      assert.ok(lesson[field].trim() !== '', `${family}.${field} is empty`);
      // One sentence per field: no concatenated paragraphs and no newline.
      assert.ok(!/\n/.test(lesson[field]), `${family}.${field} is more than one paragraph`);
    }
    // The heading is the family's own picker label, so the panel can never contradict the stage.
    assert.equal(lesson.title, {
      scaleRun: 'Scale run', findNote: 'Find the note', chordChanges: 'Chord changes',
      progression: 'Progression', song: 'Song',
    }[family]);
    // The link pair is a pair: a written address and its label, or two empty strings together.
    assert.equal(typeof lesson.link, 'string', `${family}.link is not a string`);
    assert.equal(typeof lesson.linkLabel, 'string', `${family}.linkLabel is not a string`);
    assert.equal(lesson.link.trim() === '', lesson.linkLabel.trim() === '',
      `${family} ships half a link pair`);
    if (lesson.link !== '') {
      assert.match(lesson.link, /^https:\/\/[^\s]+$/, `${family}.link is not an https address`);
      assert.ok(!/\s/.test(lesson.link), `${family}.link carries whitespace`);
      assert.equal(lesson.link, lesson.link.trim(), `${family}.link is padded`);
    }
    // Two complete watch/read links, each with a source and a one-line reason.
    assert.equal(Array.isArray(lesson.videos), true, `${family}.videos is not an array`);
    assert.equal(lesson.videos.length, 2, `${family} needs two watch/read links`);
    for (const video of lesson.videos) {
      const keys = Object.keys(video).sort();
      assert.deepEqual(keys, video.embed
        ? ['embed', 'href', 'label', 'note', 'source']
        : ['href', 'label', 'note', 'source'],
      `${family} has a malformed watch/read entry`);
      if (video.embed) {
        assert.match(video.embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+$/,
          `${family}.video.embed is not an official embed address`);
      }
      for (const field of ['label', 'href', 'source', 'note']) {
        assert.equal(typeof video[field], 'string', `${family}.video.${field} is not a string`);
        assert.ok(video[field].trim() !== '', `${family}.video.${field} is empty`);
      }
      assert.match(video.href, /^https:\/\/[^\s]+$/, `${family}.video.href is not an https address`);
      assert.ok(!/\s/.test(video.href), `${family}.video.href carries whitespace`);
    }
    // One local clip and poster; both exist on disk, both are relative and neither can be remote.
    assert.deepEqual(Object.keys(lesson.demo).sort(), ['label', 'poster', 'src'],
      `${family}.demo is malformed`);
    assert.equal(typeof lesson.demo.label, 'string');
    assert.ok(lesson.demo.label.trim() !== '');
    assert.match(lesson.demo.src, /^\.\/assets\/videos\/[a-z0-9-]+\.mp4$/, `${family}.demo.src is not local`);
    assert.match(lesson.demo.poster, /^\.\/assets\/videos\/[a-z0-9-]+\.png$/, `${family}.demo.poster is not local`);
    const appRoot = fileURLToPath(new URL('../app/', import.meta.url));
    for (const asset of [lesson.demo.src, lesson.demo.poster]) {
      const file = `${appRoot}${asset.slice(2)}`;
      assert.ok(fs.existsSync(file), `${family} is missing ${asset}`);
      assert.ok(fs.statSync(file).size > 0, `${family} ships an empty ${asset}`);
    }
    // The Blues scale is a full lesson variant on the scale-run family: same eight fields,
    // its own copy, its own reading link, its own two watch/read links and its own clip.
    if (family === 'scaleRun') {
      const variant = lesson.blues;
      assert.deepEqual(Object.keys(variant).sort(), fields, 'scaleRun.blues is not a full lesson');
      assert.equal(variant.title, 'Blues scale');
      for (const field of ['why', 'mistake', 'practice']) {
        assert.equal(typeof variant[field], 'string', `blues.${field} is not a string`);
        assert.ok(variant[field].trim() !== '', `blues.${field} is empty`);
      }
      assert.match(variant.link, /^https:\/\/[^\s]+$/, 'blues.link is not https');
      assert.match(variant.linkLabel, /blues/i, 'blues.linkLabel does not name blues');
      assert.equal(variant.videos.length, 2);
      for (const video of variant.videos) {
        assert.match(video.href, /^https:\/\/[^\s]+$/, 'blues video is not https');
        for (const field of ['label', 'source', 'note']) assert.ok(video[field].trim() !== '');
      }
      assert.match(variant.demo.src, /^\.\/assets\/videos\/blues-scale\.mp4$/);
      assert.match(variant.demo.poster, /^\.\/assets\/videos\/blues-scale\.png$/);
      for (const asset of [variant.demo.src, variant.demo.poster]) {
        const file = `${appRoot}${asset.slice(2)}`;
        assert.ok(fs.existsSync(file), `scaleRun.blues is missing ${asset}`);
        assert.ok(fs.statSync(file).size > 0, `scaleRun.blues ships an empty ${asset}`);
      }
    }
    // Power chords are the second full variant, reached from the Chords tab.
    if (family === 'chordChanges') {
      const variant = lesson.power;
      assert.deepEqual(Object.keys(variant).sort(), fields, 'chordChanges.power is not a full lesson');
      assert.equal(variant.title, 'Power chords');
      for (const field of ['why', 'mistake', 'practice']) {
        assert.equal(typeof variant[field], 'string', `power.${field} is not a string`);
        assert.ok(variant[field].trim() !== '', `power.${field} is empty`);
      }
      assert.match(variant.link, /^https:\/\/[^\s]+$/, 'power.link is not https');
      assert.match(variant.linkLabel, /power/i, 'power.linkLabel does not name power chords');
      assert.equal(variant.videos.length, 2);
      for (const video of variant.videos) {
        assert.match(video.href, /^https:\/\/[^\s]+$/, 'power video is not https');
        for (const field of ['label', 'source', 'note']) assert.ok(video[field].trim() !== '');
      }
      assert.match(variant.demo.src, /^\.\/assets\/videos\/power-chords\.mp4$/);
      assert.match(variant.demo.poster, /^\.\/assets\/videos\/power-chords\.png$/);
      for (const asset of [variant.demo.src, variant.demo.poster]) {
        const file = `${appRoot}${asset.slice(2)}`;
        assert.ok(fs.existsSync(file), `chordChanges.power is missing ${asset}`);
        assert.ok(fs.statSync(file).size > 0, `chordChanges.power ships an empty ${asset}`);
      }
    }
  }
  // No third-party media element and no remote media file anywhere in the table. The local
  // `.mp4` paths are allowed because they ship with the app and are served from its origin.
  const table = JSON.stringify(LESSONS);
  assert.ok(!/<(video|iframe|embed|object|img)\b/i.test(table), 'the lesson table carries a media element');
  assert.ok(!/https?:\/\/[^"']+\.(mp4|webm|ogv|m3u8)/i.test(table), 'the lesson table carries a remote media file');
});

test('lessonFor resolves the five families own-key only', () => {
  for (const family of DRILL_FAMILIES) assert.equal(lessonFor(family), LESSONS[family]);
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'drums', '', null, undefined, 5, {}]) {
    assert.equal(lessonFor(key), null, `lessonFor(${String(key)}) resolved`);
  }
});

// 05-02 Task 3 (CONT-01, CONT-02): the phase's "content polish to the v1 cap" line made honest.
// The cap was already met in Phase 1, so the polish is the teaching copy Task 1 wrote plus this
// explicit assertion — and no content item is added, renamed or removed.
test('content stays exactly at the v1 cap and LESSONS is the only table the phase added', () => {
  assert.equal(CONTENT_VERSION, 1, 'the content version is still the v1 marker');
  assert.equal(SCALES.length, 4, 'four scales');
  assert.equal(CHORD_FAMILIES.length, 8, 'eight chord families');
  for (const family of CHORD_FAMILIES) assert.equal(family.voicings.length, 3, `${family.id} ships three voicings`);
  assert.equal(CHORD_FAMILIES.reduce((sum, family) => sum + family.voicings.length, 0), 24, 'twenty-four voicings');
  assert.equal(PROGRESSIONS.length, 8, 'eight progressions');
  assert.equal(SONGS.length, 4, 'four songs');
  // `LESSONS` is the one table this phase introduced: the exported table names are the Phase 1-4
  // set plus it, in that order, so a later phase cannot quietly add a content item beside the cap.
  const source = fs.readFileSync(fileURLToPath(new URL('../app/src/content.js', import.meta.url)), 'utf8');
  const tables = [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=/gm)].map(match => match[1]);
  assert.deepEqual(tables, [
    'CONTENT_VERSION', 'SHARPS', 'FLATS', 'KEYS', 'KEY_NAMES', 'FLAT_KEYS', 'DEGREES', 'INTERVALS',
    'INTERVAL_NAMES', 'MAJOR', 'MINOR', 'MIN_PENT', 'MAJ_PENT', 'BLUES', 'SCALES', 'SCALE_BY_ID',
    'CHORD_FAMILIES', 'CHORD_PAIRS', 'PROGRESSIONS', 'SONGS', 'LESSONS',
  ], 'LESSONS is the only new top-level table');
});
