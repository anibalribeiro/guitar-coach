// Settings record, validation, clamps and one-time legacy migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_KEY, LEGACY_KEY, BACKUP_KEY, MAX_RECORD_LENGTH, SCHEMA_VERSION, DEFAULT_SETTINGS,
  DRILL_FAMILIES, validateSettings, migrateLegacySettings, createSettingsStore,
} from '../app/src/settings.js';
import { emptyProgress, BACKUP_SCHEMA_VERSION } from '../app/src/progress.js';
import { scaleById, chordById, chordPairById, progressionById, songById, SONGS, CHORD_PAIRS } from '../app/src/content.js';
import { positionsForScale } from '../app/src/theory.js';
import { SCORE } from '../app/src/score.js';
import { createFakeStorage, createThrowingStorage } from './helpers/fakes.js';

const CONTENT = { scaleById, chordById, chordPairById, progressionById, songById, positionsForScale };

test('the settings clamp and the scorer agree on the calibration ceiling', () => {
  assert.equal(
    validateSettings({ calibrationMs: SCORE.maxCalibrationMs + 1 }).calibrationMs,
    SCORE.maxCalibrationMs,
    'the two calibration clamps must stay the same number',
  );
});

test('empty storage loads defaults without writing', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(store.record(), {
    schemaVersion: SCHEMA_VERSION,
    settings: DEFAULT_SETTINGS,
    progress: emptyProgress(),
  });
  assert.equal(storage.writes.length, 0);
  assert.equal(store.status, 'ok');
});

test('defaults include the full browse selection', () => {
  for (const key of ['tab', 'chordId', 'voicingId', 'progressionId', 'songId', 'barIndex', 'lightsOn']) {
    assert.ok(Object.hasOwn(DEFAULT_SETTINGS, key), `missing ${key}`);
  }
});

test('bpm clamps to 30-240 and rounds; non-numeric falls back to 70', () => {
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: 10 }, CONTENT).bpm, 30);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: 500 }, CONTENT).bpm, 240);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: 70.6 }, CONTENT).bpm, 71);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: '95' }, CONTENT).bpm, 95);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: 'fast' }, CONTENT).bpm, 70);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, bpm: null }, CONTENT).bpm, 70);
});

test('invalid tab, scale, position, labels and direction fall back to defaults', () => {
  const bad = validateSettings({
    ...DEFAULT_SETTINGS, tab: 'library', scaleId: 'nope', positionId: 's6f99',
    labels: 'solfa', direction: 'sideways', keyPc: 12,
  }, CONTENT);
  assert.equal(bad.tab, 'scales');
  assert.equal(bad.scaleId, 'major');
  assert.equal(bad.positionId, 'all');
  assert.equal(bad.labels, 'notes');
  assert.equal(bad.direction, 'updown');
  assert.equal(bad.keyPc, 0);

  const good = validateSettings({
    ...DEFAULT_SETTINGS, scaleId: 'blues', positionId: 's6f5', labels: 'intervals', direction: 'down', keyPc: 9,
  }, CONTENT);
  assert.equal(good.scaleId, 'blues');
  assert.equal(good.positionId, 's6f5');
  assert.equal(good.labels, 'intervals');
  assert.equal(good.direction, 'down');
  assert.equal(good.keyPc, 9);

  const fingers = validateSettings({ ...DEFAULT_SETTINGS, labels: 'fingers' }, CONTENT);
  assert.equal(fingers.labels, 'fingers', 'finger numbers are a real label mode');
});

test('positions resolve against positionsForScale and fall back to whole neck', () => {
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, keyPc: 0, scaleId: 'major', positionId: 's6f3' }, CONTENT).positionId, 's6f3');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, keyPc: 0, scaleId: 'major', positionId: 's6f2' }, CONTENT).positionId, 'all');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, keyPc: 9, scaleId: 'minPent', positionId: 's6f0' }, CONTENT).positionId, 's6f0');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, keyPc: 0, scaleId: 'major', positionId: 'all' }, CONTENT).positionId, 'all');
});

test('invalid chord, voicing, progression, song and barIndex fall back safely', () => {
  const out = validateSettings({
    ...DEFAULT_SETTINGS, tab: 'progressions', chordId: 'H', voicingId: 'nope',
    progressionId: 'nope', songId: 'nope', barIndex: 99,
  }, CONTENT);
  assert.equal(out.chordId, 'C');
  assert.equal(out.voicingId, 'open');
  assert.equal(out.progressionId, 'I-IV-V');
  assert.equal(out.songId, SONGS[0].id);
  assert.equal(out.barIndex, 2, 'I-IV-V has three bars, so barIndex clamps to 2');
});

test('valid browse IDs survive validation', () => {
  const out = validateSettings({
    ...DEFAULT_SETTINGS, tab: 'songs', keyPc: 9, scaleId: 'blues', positionId: 's6f5',
    chordId: 'Em', voicingId: 'barreE12', progressionId: '12-bar-blues',
    songId: 'amazingGrace', barIndex: 4,
  }, CONTENT);
  assert.equal(out.tab, 'songs');
  assert.equal(out.keyPc, 9);
  assert.equal(out.scaleId, 'blues');
  assert.equal(out.positionId, 's6f5');
  assert.equal(out.chordId, 'Em');
  assert.equal(out.voicingId, 'barreE12');
  assert.equal(out.progressionId, '12-bar-blues');
  assert.equal(out.songId, 'amazingGrace');
  assert.equal(out.barIndex, 4, 'Amazing Grace has five chart bars');
});

// CR-02: truthiness checks used to accept inherited Object.prototype keys as content.
test('crafted content ids never resolve through the prototype chain', () => {
  for (const crafted of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    let out = null;
    assert.doesNotThrow(() => {
      out = validateSettings({
        ...DEFAULT_SETTINGS,
        scaleId: crafted,
        chordId: crafted,
        voicingId: crafted,
        progressionId: crafted,
        songId: crafted,
      }, CONTENT);
    }, `${crafted} must not throw`);
    assert.equal(out.scaleId, 'major', `${crafted} is not a scale`);
    assert.equal(out.chordId, 'C', `${crafted} is not a chord`);
    assert.equal(out.voicingId, 'open', `${crafted} is not a voicing`);
    assert.equal(out.progressionId, 'I-IV-V', `${crafted} is not a progression`);
    assert.equal(out.songId, SONGS[0].id, `${crafted} is not a song`);
  }
});

test('barIndex clamps to the selected song chart', () => {
  const out = validateSettings({ ...DEFAULT_SETTINGS, tab: 'songs', songId: 'amazingGrace', barIndex: 99 }, CONTENT);
  assert.equal(out.barIndex, 4);
});

test('stageMode defaults to off, accepts only booleans and round-trips through storage', () => {
  assert.equal(DEFAULT_SETTINGS.stageMode, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, stageMode: true }, CONTENT).stageMode, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, stageMode: 'yes' }, CONTENT).stageMode, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, stageMode: 1 }, CONTENT).stageMode, false);

  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, stageMode: true },
    }),
  });
  assert.equal(createSettingsStore(storage, CONTENT).get().stageMode, true);
});

test('unknown keys are ignored and booleans are type-checked', () => {
  const out = validateSettings({
    ...DEFAULT_SETTINGS, hack: 'ignored', sound: 'yes', drone: 1, lightsOn: false,
  }, CONTENT);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.equal(out.hack, undefined);
  assert.equal(out.sound, true);
  assert.equal(out.drone, false);
  assert.equal(out.lightsOn, false);
});

test('lightsOn restores from storage and defaults to true', () => {
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, lightsOn: false, tab: 'chords', chordId: 'Am', voicingId: 'open' },
    }),
  });
  const loaded = createSettingsStore(storage, CONTENT).get();
  assert.equal(loaded.lightsOn, false);
  assert.equal(loaded.tab, 'chords');
  assert.equal(loaded.chordId, 'Am');
});

test('corrupt or oversized records fall back to defaults without throwing', () => {
  const corrupt = createFakeStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(createSettingsStore(corrupt, CONTENT).get(), DEFAULT_SETTINGS);

  const oversized = createFakeStorage({ [STORAGE_KEY]: 'x'.repeat(2 * 1024 * 1024) });
  assert.deepEqual(createSettingsStore(oversized, CONTENT).get(), DEFAULT_SETTINGS);

  const legacyButCorrupt = createFakeStorage({ [LEGACY_KEY]: '[1,2' });
  assert.deepEqual(createSettingsStore(legacyButCorrupt, CONTENT).get(), DEFAULT_SETTINGS);
});

test('an unreadable, corrupt or oversized record reports readFailed and keeps an empty plane', () => {
  for (const initial of [
    { [STORAGE_KEY]: '{not json' },
    { [STORAGE_KEY]: 'x'.repeat(MAX_RECORD_LENGTH + 1) },
    { [STORAGE_KEY]: JSON.stringify({ schemaVersion: 99, settings: DEFAULT_SETTINGS }) },
  ]) {
    const store = createSettingsStore(createFakeStorage(initial), CONTENT);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    assert.deepEqual(store.getProgress(), emptyProgress());
    assert.equal(store.status, 'readFailed');
  }

  const unreadable = createSettingsStore(createThrowingStorage({}, { failGet: true, failSet: false }), CONTENT);
  assert.deepEqual(unreadable.get(), DEFAULT_SETTINGS);
  assert.equal(unreadable.status, 'readFailed');
});

test('a legacy t2scales record migrates once and leaves the old key intact', () => {
  const legacy = { key: 9, scale: 'minPent', labels: 'degrees', bpm: '95', dir: 'down', ledMode: 'target' };
  const storage = createFakeStorage({ [LEGACY_KEY]: JSON.stringify(legacy) });
  const store = createSettingsStore(storage, CONTENT);
  const settings = store.get();

  assert.equal(settings.keyPc, 9);
  assert.equal(settings.scaleId, 'minPent');
  assert.equal(settings.labels, 'degrees');
  assert.equal(settings.bpm, 95);
  assert.equal(settings.direction, 'down');
  assert.equal(settings.positionId, 'all');
  assert.ok(!('ledMode' in settings));
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_KEY)), legacy);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, STORAGE_KEY);
  assert.equal(JSON.parse(storage.writes[0].value).schemaVersion, SCHEMA_VERSION);

  const second = createSettingsStore(storage, CONTENT);
  assert.deepEqual(second.get(), settings);
  assert.equal(storage.writes.length, 1, 'migration must not run twice');
});

test('legacy migration maps unknown scale and invalid values to defaults', () => {
  assert.equal(migrateLegacySettings({ scale: 'nonsense' }, CONTENT).scaleId, 'major');
  assert.equal(migrateLegacySettings({ bpm: 'fast' }, CONTENT).bpm, 70);
  assert.equal(migrateLegacySettings({ key: 99 }, CONTENT).keyPc, 0);
  assert.equal(migrateLegacySettings({ labels: 'solfa' }, CONTENT).labels, 'notes');
  assert.equal(migrateLegacySettings({ dir: 'sideways' }, CONTENT).direction, 'updown');
  assert.equal(migrateLegacySettings(null, CONTENT), null);
  assert.equal(migrateLegacySettings('nope', CONTENT), null);
});

test('a v1 record migrates once to schema 2 with a one-time backup and never re-migrates', () => {
  const v1 = JSON.stringify({
    schemaVersion: 1,
    settings: { ...DEFAULT_SETTINGS, bpm: 120, keyPc: 9, scaleId: 'minPent' },
  });
  const storage = createFakeStorage({ [STORAGE_KEY]: v1 });
  const store = createSettingsStore(storage, CONTENT);
  const settings = store.get();

  assert.equal(settings.bpm, 120);
  assert.equal(settings.keyPc, 9);
  assert.equal(settings.scaleId, 'minPent');
  assert.deepEqual(store.getProgress(), emptyProgress());
  assert.equal(storage.writes.length, 2, 'one backup plus one v2 write');
  assert.equal(storage.writes[0].key, BACKUP_KEY);
  assert.equal(storage.writes[0].value, v1, 'the backup is the raw v1 string');
  assert.equal(storage.writes[1].key, STORAGE_KEY);
  const written = JSON.parse(storage.writes[1].value);
  assert.equal(written.schemaVersion, 2);
  assert.equal(written.settings.bpm, 120);
  assert.deepEqual(written.progress, emptyProgress());
  assert.equal(store.status, 'ok');

  const second = createSettingsStore(storage, CONTENT);
  assert.equal(second.get().bpm, 120);
  assert.equal(second.status, 'ok');
  assert.equal(storage.writes.length, 2, 'a second load performs zero writes');
});

test('a v1 record with a failing backup write still migrates', () => {
  const v1 = JSON.stringify({ schemaVersion: 1, settings: { ...DEFAULT_SETTINGS, bpm: 88 } });
  const storage = createFakeStorage({ [STORAGE_KEY]: v1 });
  const originalSet = storage.setItem;
  let backupAttempted = false;
  storage.setItem = (key, value) => {
    if (key === BACKUP_KEY) { backupAttempted = true; throw new Error('quota'); }
    originalSet(key, value);
  };
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.get().bpm, 88);
  assert.equal(backupAttempted, true);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).schemaVersion, 2);
});

test('a corrupt progress plane keeps valid settings', () => {
  const raw = JSON.stringify({
    schemaVersion: 2,
    settings: { ...DEFAULT_SETTINGS, bpm: 120, tab: 'chords' },
    progress: 'not an object',
  });
  const storage = createFakeStorage({ [STORAGE_KEY]: raw });
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.get().bpm, 120);
  assert.equal(store.get().tab, 'chords');
  assert.deepEqual(store.getProgress(), emptyProgress());
  assert.equal(store.status, 'readFailed', 'a replaced plane is data loss, not a clean load');
  assert.equal(storage.getItem(BACKUP_KEY), raw, 'the original bytes are kept before the next write');
});

// WR-08: a corrupt v2 plane must be backed up and reported, not silently overwritten.
test('a v2 record with a replaced plane is backed up and reported at load', () => {
  const raw = JSON.stringify({
    schemaVersion: 2,
    settings: [1, 2, 3],
    progress: { version: 1, skills: {}, sessions: [], totals: {} },
  });
  const storage = createFakeStorage({ [STORAGE_KEY]: raw });
  const store = createSettingsStore(storage, CONTENT);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.equal(store.status, 'readFailed');
  assert.equal(storage.getItem(BACKUP_KEY), raw);

  const clean = JSON.stringify({
    schemaVersion: 2,
    settings: DEFAULT_SETTINGS,
    progress: emptyProgress(),
  });
  const cleanStorage = createFakeStorage({ [STORAGE_KEY]: clean });
  const cleanStore = createSettingsStore(cleanStorage, CONTENT);
  assert.equal(cleanStore.status, 'ok');
  assert.equal(cleanStorage.map.has(BACKUP_KEY), false, 'a valid record needs no backup');
});

test('a corrupt settings plane keeps valid progress', () => {
  const progress = {
    version: 1,
    skills: { 'scaleRun:minPent:9:s6f0': { bestLevel: 2, cleanPasses: 4 } },
    sessions: [],
    totals: { totalMs: 12000, unguidedMs: 6000, sessionCount: 1 },
  };
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: [1, 2, 3], progress }),
  });
  const store = createSettingsStore(storage, CONTENT);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  const loaded = store.getProgress();
  assert.equal(loaded.skills['scaleRun:minPent:9:s6f0'].bestLevel, 2);
  assert.equal(loaded.skills['scaleRun:minPent:9:s6f0'].cleanPasses, 4);
  assert.equal(loaded.totals.totalMs, 12000);
  assert.equal(loaded.totals.unguidedMs, 6000);
});

test('a throwing setItem sets writeFailed and keeps the in-memory record', () => {
  const storage = createThrowingStorage();
  const store = createSettingsStore(storage, CONTENT);
  store.set({ bpm: 90 });
  assert.equal(store.get().bpm, 90);
  assert.equal(store.status, 'writeFailed');
  assert.equal(storage.writes.length, 0);

  const progress = store.setProgress({
    version: 1,
    skills: { 'scaleRun:minPent:9:s6f0': { bestLevel: 2 } },
    sessions: [],
    totals: { totalMs: 0, unguidedMs: 0, sessionCount: 0 },
  });
  assert.equal(progress.skills['scaleRun:minPent:9:s6f0'].bestLevel, 2, 'the in-memory plane survives');
  assert.equal(store.status, 'writeFailed', 'the failed write remains visible to the caller');

  const recovered = createFakeStorage();
  const recoveredStore = createSettingsStore(recovered, CONTENT);
  recoveredStore.set({ bpm: 100 });
  assert.equal(recoveredStore.status, 'ok');
});

test('setProgress validates once, writes once and returns the stored plane', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  const first = store.setProgress({
    version: 1,
    skills: { 'scaleRun:minPent:9:s6f0': { bestLevel: 9, accuracy: 5 } },
    sessions: [{ sessionId: 's1', durationMs: 12000, passes: [] }],
    totals: { totalMs: 12000, unguidedMs: 0, sessionCount: 1 },
  });
  assert.equal(first.skills['scaleRun:minPent:9:s6f0'].bestLevel, 3, 'out-of-range levels clamp');
  assert.equal(first.skills['scaleRun:minPent:9:s6f0'].accuracy, null, 'Phase 2 keeps scoring null');
  assert.equal(first.sessions.length, 1);
  assert.equal(storage.writes.length, 1);
  const written = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(written.schemaVersion, 2);
  assert.equal(written.progress.sessions.length, 1);

  const writes = storage.writes.length;
  store.setProgress(first);
  assert.equal(store.getProgress().sessions.length, 1, 'an upsert never appends a second row');
  assert.equal(storage.writes.length, writes + 1);
});

test('replaceAll writes the imported record once and restores the snapshot on failure', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  store.set({ bpm: 100 });
  const before = storage.writes.length;
  const next = store.replaceAll({
    settings: { ...DEFAULT_SETTINGS, bpm: 140, tab: 'chords' },
    progress: {
      version: 1,
      skills: { 'a:b': { bestLevel: 2 } },
      sessions: [],
      totals: { totalMs: 10, unguidedMs: 0, sessionCount: 1 },
    },
  });
  assert.equal(next.bpm, 140);
  assert.equal(storage.writes.length, before + 1, 'one atomic write');
  const written = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(written.schemaVersion, 2);
  assert.equal(written.settings.bpm, 140);
  assert.equal(written.progress.skills['a:b'].bestLevel, 2);

  const failing = createThrowingStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: store.get(), progress: store.getProgress() }),
  });
  const guarded = createSettingsStore(failing, CONTENT);
  const snapshot = guarded.record();
  const result = guarded.replaceAll({
    settings: { ...DEFAULT_SETTINGS, bpm: 30 },
    progress: emptyProgress(),
  });
  assert.equal(result.bpm, snapshot.settings.bpm, 'the in-memory settings are restored');
  assert.deepEqual(guarded.getProgress(), snapshot.progress, 'the in-memory progress is restored');
  assert.equal(guarded.status, 'writeFailed');
});

test('the record is exactly schemaVersion, settings and progress', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  store.set({ bpm: 500, tab: 'chords' });

  const record = store.record();
  assert.deepEqual(Object.keys(record).sort(), ['progress', 'schemaVersion', 'settings']);
  assert.equal(record.schemaVersion, SCHEMA_VERSION);
  assert.ok(!('contentVersion' in record.settings));
  assert.equal(record.settings.bpm, 240);
  assert.equal(record.settings.tab, 'chords');
  assert.deepEqual(record.progress, emptyProgress());

  const written = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(written).sort(), ['progress', 'schemaVersion', 'settings']);
  assert.deepEqual(Object.keys(written.settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

// IN-07: the settings plane was always copied; the progress plane now is too.
test('record returns a copy of both planes', () => {
  const store = createSettingsStore(createFakeStorage(), CONTENT);
  const record = store.record();
  record.settings.bpm = 200;
  record.progress.skills = { hacked: { bestLevel: 3 } };
  assert.equal(store.get().bpm, 70);
  assert.deepEqual(store.getProgress().skills, {});
});

test('a v2 record loads and a newer schemaVersion is rejected', () => {
  const v2 = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      settings: { ...DEFAULT_SETTINGS, bpm: 120 },
      progress: { version: 1, skills: { a: { bestLevel: 2 } }, sessions: [], totals: {} },
    }),
  });
  const loaded = createSettingsStore(v2, CONTENT);
  assert.equal(loaded.get().bpm, 120);
  assert.equal(loaded.getProgress().skills.a.bestLevel, 2);

  const v3 = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 3, settings: { ...DEFAULT_SETTINGS, bpm: 120 } }),
  });
  assert.equal(createSettingsStore(v3, CONTENT).get().bpm, 70);
});

test('set validates and persists; storage failures are swallowed', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  store.set({ bpm: 10, positionId: 's6f3' });
  assert.equal(store.get().bpm, 30);
  assert.equal(store.get().positionId, 's6f3');
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).settings.positionId, 's6f3');

  const failing = { getItem() { return null; }, setItem() { throw new Error('quota'); } };
  const guarded = createSettingsStore(failing, CONTENT);
  assert.doesNotThrow(() => guarded.set({ bpm: 90 }));
  assert.equal(guarded.get().bpm, 90);
});

test('settings.js imports content.js then progress.js and never stores the content version', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../app/src/settings.js', import.meta.url)), 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(specifiers, ['./content.js', './progress.js']);
  assert.ok(!/from\s+['"]\.\/theory\.js/.test(source));
  assert.ok(!/CONTENT_VERSION/.test(source));
});

// ---------- Phase 3: the drill-family and quiz settings (03-01) ----------
test('drillFamily, quizQuestion and quizMode default, validate and round-trip', () => {
  assert.equal(DEFAULT_SETTINGS.drillFamily, 'scaleRun');
  assert.equal(DEFAULT_SETTINGS.quizQuestion, 'note');
  assert.equal(DEFAULT_SETTINGS.quizMode, 'find');

  const blank = validateSettings({});
  assert.equal(blank.drillFamily, 'scaleRun');
  assert.equal(blank.quizQuestion, 'note');
  assert.equal(blank.quizMode, 'find');

  const kept = validateSettings({
    ...DEFAULT_SETTINGS, drillFamily: 'findNote', quizQuestion: 'interval', quizMode: 'name',
  }, CONTENT);
  assert.equal(kept.drillFamily, 'findNote');
  assert.equal(kept.quizQuestion, 'interval');
  assert.equal(kept.quizMode, 'name');
  assert.equal(
    validateSettings({ ...DEFAULT_SETTINGS, drillFamily: 'chordChanges' }, CONTENT).drillFamily,
    'chordChanges',
  );
  // 04-02 adds the fourth family to the one list the picker's guard also reads.
  assert.equal(
    validateSettings({ ...DEFAULT_SETTINGS, drillFamily: 'progression' }, CONTENT).drillFamily,
    'progression',
  );

  const bad = validateSettings({
    ...DEFAULT_SETTINGS, drillFamily: 'chordLoop', quizQuestion: 'solfa', quizMode: 'sight-read',
  }, CONTENT);
  assert.equal(bad.drillFamily, 'scaleRun');
  assert.equal(bad.quizQuestion, 'note');
  assert.equal(bad.quizMode, 'find');

  // Only a bounded string in the allowlist survives; every other type falls back.
  const typed = validateSettings({ drillFamily: 7, quizQuestion: null, quizMode: ['name'] }, CONTENT);
  assert.equal(typed.drillFamily, 'scaleRun');
  assert.equal(typed.quizQuestion, 'note');
  assert.equal(typed.quizMode, 'find');
  const long = validateSettings({ ...DEFAULT_SETTINGS, quizQuestion: 'x'.repeat(MAX_RECORD_LENGTH) }, CONTENT);
  assert.equal(long.quizQuestion, 'note');
});

test('a v2 record written before Phase 3 loads the three new fields as defaults', () => {
  assert.equal(SCHEMA_VERSION, 2, 'the new fields are defaulted, so no schema bump is needed');
  const old = { ...DEFAULT_SETTINGS, bpm: 110 };
  delete old.drillFamily;
  delete old.quizQuestion;
  delete old.quizMode;

  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: old, progress: emptyProgress() }),
  });
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.status, 'ok');
  assert.equal(store.get().bpm, 110, 'the stored values still win');
  assert.equal(store.get().drillFamily, 'scaleRun');
  assert.equal(store.get().quizQuestion, 'note');
  assert.equal(store.get().quizMode, 'find');

  // A hand-edited record cannot carry an unknown family or kind into the engine.
  const crafted = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      settings: { ...DEFAULT_SETTINGS, drillFamily: 'library', quizQuestion: 'solfa', quizMode: 'sight-read' },
      progress: emptyProgress(),
    }),
  });
  const loaded = createSettingsStore(crafted, CONTENT);
  assert.equal(loaded.get().drillFamily, 'scaleRun');
  assert.equal(loaded.get().quizQuestion, 'note');
  assert.equal(loaded.get().quizMode, 'find');
});

// ---------- 03-02 Task 1: the persisted chord pair (CHORD-02, T-03-06) ----------
test('chordPairId defaults to C-G, validates own-key only and round-trips', () => {
  assert.equal(DEFAULT_SETTINGS.chordPairId, 'C-G');
  assert.equal(validateSettings({}).chordPairId, 'C-G');
  assert.equal(validateSettings({}, CONTENT).chordPairId, 'C-G');

  // Every curated pair is a real setting, two-chord and four-chord alike.
  for (const pair of CHORD_PAIRS) {
    assert.equal(validateSettings({ ...DEFAULT_SETTINGS, chordPairId: pair.id }, CONTENT).chordPairId, pair.id);
  }
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, chordPairId: 'C-Am-Dm-G' }, CONTENT).chordPairId, 'C-Am-Dm-G');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, chordPairId: 'H-G' }, CONTENT).chordPairId, 'C-G');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, chordPairId: 7 }, CONTENT).chordPairId, 'C-G');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, chordPairId: null }, CONTENT).chordPairId, 'C-G');

  // A record written before the pair existed defaults instead of storing a hole.
  const legacy = { ...DEFAULT_SETTINGS };
  delete legacy.chordPairId;
  assert.equal(validateSettings(legacy, CONTENT).chordPairId, 'C-G');

  // The pair is resolved through the content table's own keys only: a prototype key
  // must never resolve as a real pair (T-03-06).
  for (const crafted of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(
      validateSettings({ ...DEFAULT_SETTINGS, chordPairId: crafted }, CONTENT).chordPairId,
      'C-G',
      `${crafted} is not a pair`,
    );
  }

  // The choice round-trips through the one record the store owns.
  const storage = createFakeStorage();
  createSettingsStore(storage, CONTENT).set({ chordPairId: 'Am-Dm-G-C' });
  assert.equal(createSettingsStore(storage, CONTENT).get().chordPairId, 'Am-Dm-G-C');
});

// ---------- 03-03 Task 1: the optional microphone (MIC-01, D-46, D-48) ----------
test('micOn defaults to off, accepts only booleans and round-trips', () => {
  assert.equal(DEFAULT_SETTINGS.micOn, false, 'the mic is opt-in');
  assert.equal(validateSettings({}).micOn, false);
  assert.equal(validateSettings({ micOn: true }).micOn, true);
  for (const value of ['yes', 'true', 1, 0, null, {}]) {
    assert.equal(validateSettings({ micOn: value }).micOn, false, `${JSON.stringify(value)} is not a boolean`);
  }

  const storage = createFakeStorage();
  createSettingsStore(storage, CONTENT).set({ micOn: true });
  assert.equal(createSettingsStore(storage, CONTENT).get().micOn, true);
});

test('calibrationMs defaults to 0 and clamps to 0-250 at both ends', () => {
  assert.equal(SCHEMA_VERSION, 2, 'both fields default, so the schema does not move');
  assert.equal(DEFAULT_SETTINGS.calibrationMs, 0);
  assert.equal(validateSettings({}).calibrationMs, 0);
  assert.equal(validateSettings({ calibrationMs: 24 }).calibrationMs, 24);
  assert.equal(validateSettings({ calibrationMs: 24.6 }).calibrationMs, 25);
  assert.equal(validateSettings({ calibrationMs: 900 }, CONTENT).calibrationMs, 250);
  assert.equal(validateSettings({ calibrationMs: -5 }, CONTENT).calibrationMs, 0);
  assert.equal(validateSettings({ calibrationMs: 250 }).calibrationMs, 250);

  // Only a finite number is a measurement; a hand-edited string or null defaults instead.
  for (const value of ['40', null, undefined, NaN, Infinity, {}]) {
    assert.equal(validateSettings({ calibrationMs: value }).calibrationMs, 0, `${String(value)} is not a measurement`);
  }

  // The clamped value is what the one record stores.
  const storage = createFakeStorage();
  createSettingsStore(storage, CONTENT).set({ calibrationMs: 900, micOn: true });
  const reloaded = createSettingsStore(storage, CONTENT);
  assert.equal(reloaded.get().calibrationMs, 250);
  assert.equal(reloaded.get().micOn, true);
});

test('a v2 record written before the microphone loads both fields as defaults', () => {
  const old = { ...DEFAULT_SETTINGS };
  delete old.micOn;
  delete old.calibrationMs;
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: old, progress: emptyProgress() }),
  });
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.status, 'ok');
  assert.equal(store.get().micOn, false);
  assert.equal(store.get().calibrationMs, 0);
});


// ---------- 04-01 Task 3: the intensity preset and the four stems (D-55, A-58, T-04-06) ----------
test('intensity defaults to full, accepts the three presets and falls back otherwise', () => {
  assert.equal(SCHEMA_VERSION, 2, 'the new fields default, so the schema does not move');
  assert.equal(DEFAULT_SETTINGS.intensity, 'full');
  assert.equal(validateSettings({}).intensity, 'full');
  assert.equal(validateSettings({}, CONTENT).intensity, 'full');
  assert.equal(validateSettings({ intensity: 'click' }).intensity, 'click');
  assert.equal(validateSettings({ intensity: 'drumsBass' }).intensity, 'drumsBass');
  assert.equal(validateSettings({ intensity: 'full' }).intensity, 'full');

  // A closed list, never a free string: an imported or hand-edited value falls back.
  for (const value of ['loud', '', 'FULL', 'drums', 7, null, {}, []]) {
    assert.equal(validateSettings({ intensity: value }).intensity, 'full', `${JSON.stringify(value)} is not a preset`);
  }
});

test('the four stem booleans default on, accept only real booleans and round-trip', () => {
  const stems = ['stemClick', 'stemDrums', 'stemBass', 'stemPad'];
  for (const stem of stems) {
    assert.equal(DEFAULT_SETTINGS[stem], true, `${stem} defaults on`);
    assert.equal(validateSettings({})[stem], true, `${stem} is on for a fresh record`);
    assert.equal(validateSettings({ [stem]: false })[stem], false, `${stem} mutes`);
    // A stringified boolean is not a boolean: it falls back instead of coercing (T-04-06).
    for (const value of ['false', 'true', 0, 1, null, {}]) {
      assert.equal(validateSettings({ [stem]: value })[stem], true, `${stem} rejects ${JSON.stringify(value)}`);
    }
  }

  // A hand toggle changes one checkbox and never re-derives the preset (A-58).
  const one = validateSettings({ intensity: 'full', stemPad: false });
  assert.equal(one.intensity, 'full');
  assert.deepEqual(stems.map(stem => one[stem]), [true, true, true, false]);

  const storage = createFakeStorage();
  createSettingsStore(storage, CONTENT).set({ intensity: 'drumsBass', stemPad: false });
  const reloaded = createSettingsStore(storage, CONTENT);
  assert.equal(reloaded.get().intensity, 'drumsBass');
  assert.equal(reloaded.get().stemPad, false);
  assert.equal(reloaded.get().stemClick, true);
});

test('a v2 record written before the backing mix loads the defaults without a migration', () => {
  assert.equal(SCHEMA_VERSION, 2, 'no version bump: every new field has a default');
  const old = { ...DEFAULT_SETTINGS, bpm: 96 };
  for (const key of ['intensity', 'stemClick', 'stemDrums', 'stemBass', 'stemPad']) delete old[key];
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: old, progress: emptyProgress() }),
  });
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.status, 'ok');
  assert.equal(store.get().bpm, 96, 'the stored values still win');
  assert.equal(store.get().intensity, 'full');
  for (const stem of ['stemClick', 'stemDrums', 'stemBass', 'stemPad']) assert.equal(store.get()[stem], true);
  assert.equal(storage.writes.length, 0, 'a Phase 3 record loads without a rewrite');
});

// ---------- 04-02 Task 1, extended by 04-03: the validator's one family list ----------
test('DRILL_FAMILIES is a named export the picker reads and the validator enforces', () => {
  // 04-03 adds the fifth family: the song play-along is one list entry, and the picker's
  // guard, the validator and the stage all read this same export.
  assert.deepEqual(DRILL_FAMILIES, ['scaleRun', 'findNote', 'chordChanges', 'progression', 'song']);
  // Every listed family validates and every other string falls back: one list, two readers.
  for (const family of DRILL_FAMILIES) {
    assert.equal(validateSettings({ ...DEFAULT_SETTINGS, drillFamily: family }, CONTENT).drillFamily, family);
  }
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, drillFamily: 'noSuchFamily' }, CONTENT).drillFamily, 'scaleRun');
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, drillFamily: 'constructor' }, CONTENT).drillFamily, 'scaleRun');
  // The list is the validator's, not a copy: `pickString` reads the same export.
  const source = fs.readFileSync(new URL('../app/src/settings.js', import.meta.url), 'utf8');
  assert.match(source, /export const DRILL_FAMILIES = \[/);
  assert.match(source, /out\.drillFamily = pickString\(raw\.drillFamily, DRILL_FAMILIES, out\.drillFamily\)/);
});

test('loopBars accepts only the windows a chart can honour', () => {
  assert.equal(validateSettings({ loopBars: 4 }).loopBars, 4);
  assert.equal(validateSettings({ loopBars: 8 }).loopBars, 8);
  assert.equal(validateSettings({ loopBars: 7 }).loopBars, 0);
  assert.equal(validateSettings({ loopBars: '4' }).loopBars, 0);
  assert.equal(validateSettings({ loopBars: 4.5 }).loopBars, 0);
});

test('a large progress plane is fitted before it is written', () => {
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  const plane = emptyProgress();
  const payload = {};
  for (let key = 0; key < 12; key++) payload[`k${key}`] = 'a'.repeat(64);
  for (let i = 0; i < 768; i++) {
    plane.skills[`skill:${i}`] = { skillId: `skill:${i}`, updatedAt: i, content: payload };
  }
  const written = store.setProgress(plane);
  assert.ok(written, 'the write succeeds');
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw.length <= MAX_RECORD_LENGTH, `${raw.length} bytes must fit ${MAX_RECORD_LENGTH}`);
  const loaded = createSettingsStore(createFakeStorage({ [STORAGE_KEY]: raw }), CONTENT);
  assert.equal(loaded.status, 'ok', 'the app can read back what it wrote');
});

test('an over-ceiling record is backed up before the store defaults', () => {
  const raw = 'x'.repeat(MAX_RECORD_LENGTH + 1);
  const storage = createFakeStorage({ [STORAGE_KEY]: raw });
  const store = createSettingsStore(storage, CONTENT);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(store.getProgress(), emptyProgress());
  assert.equal(store.status, 'readFailed');
  assert.equal(storage.getItem(BACKUP_KEY), raw, 'the bytes are recoverable');
});

test('songSectionId resolves only a real section of the selected song', () => {
  assert.equal(validateSettings({ songId: 'amazingGrace', songSectionId: 'verse' }).songSectionId, 'verse');
  assert.equal(validateSettings({ songId: 'willTheCircleBeUnbroken', songSectionId: 'chorus' }).songSectionId, 'chorus');
  assert.equal(validateSettings({ songId: 'amazingGrace', songSectionId: 'nope' }).songSectionId, 'verse', 'invalid falls back to the first section');
  assert.equal(validateSettings({ songId: 'amazingGrace', songSectionId: 'constructor' }).songSectionId, 'verse');
  assert.equal(validateSettings({ songId: 'amazingGrace', songSectionId: '' }).songSectionId, 'verse');
});

test('sessionView and practiseFilter default and reject unknown values', () => {
  assert.equal(validateSettings({}).sessionView, 'plan');
  assert.equal(validateSettings({}).practiseFilter, 'due');
  assert.equal(validateSettings({ sessionView: 'practise' }).sessionView, 'practise');
  assert.equal(validateSettings({ sessionView: 'x' }).sessionView, 'plan');
  assert.equal(validateSettings({ practiseFilter: 'pairs' }).practiseFilter, 'pairs');
  assert.equal(validateSettings({ practiseFilter: 'x' }).practiseFilter, 'due');
});

test('view defaults to today, accepts the four views, and round-trips', () => {
  assert.equal(DEFAULT_SETTINGS.view, 'today');
  for (const view of ['today', 'practice', 'progress', 'library']) {
    assert.equal(validateSettings({ ...DEFAULT_SETTINGS, view }, CONTENT).view, view);
  }
  for (const bad of ['Today', 'stage', 1, null, true, '']) {
    assert.equal(validateSettings({ ...DEFAULT_SETTINGS, view: bad }, CONTENT).view, 'today');
  }
  const storage = createFakeStorage();
  const store = createSettingsStore(storage, CONTENT);
  store.set({ view: 'library' });
  assert.equal(createSettingsStore(storage, CONTENT).get().view, 'library');
});

// LOOK-02: the theme setting is gone. A stored theme from a v1 shell is ignored on load and
// dropped by the rebuild-from-defaults validator on the next save — no migration, no bump.
test('a stored theme is ignored and dropped on the next save, with every other setting intact', () => {
  const out = validateSettings({ theme: 'dark', bpm: 90, view: 'library' }, CONTENT);
  assert.equal(out.bpm, 90);
  assert.equal(out.view, 'library');
  assert.ok(!Object.hasOwn(out, 'theme'), 'no own theme key');
  for (const theme of ['system', 'dark']) {
    const progress = { ...emptyProgress(), totals: { ...emptyProgress().totals, sessionCount: 4, totalMs: 60000 } };
    const settings = { ...DEFAULT_SETTINGS, theme, bpm: 88, keyPc: 7, view: 'progress' };
    const storage = createFakeStorage({ [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings, progress }) });
    const store = createSettingsStore(storage, CONTENT);
    assert.equal(store.status, 'ok', 'never readFailed');
    assert.equal(store.get().bpm, 88);
    assert.equal(store.get().keyPc, 7);
    assert.equal(store.get().view, 'progress');
    assert.ok(!Object.hasOwn(store.get(), 'theme'));
    assert.equal(store.getProgress().totals.sessionCount, 4, 'the progress plane survives');
    store.set({ bpm: 92 });
    const saved = JSON.parse(storage.map.get(STORAGE_KEY));
    assert.equal(saved.schemaVersion, 2);
    assert.ok(!Object.hasOwn(saved.settings, 'theme'), 'the theme key is gone after the save');
    assert.equal(saved.settings.keyPc, 7);
    assert.equal(saved.progress.totals.sessionCount, 4);
  }
});

// KEEP-03: neither schema version moves, so an open v1 tab or a rollback never resets the record,
// and the v2 settings key set is exactly the v1 set minus theme plus view.
const V1_SETTINGS_KEYS = Object.freeze([
  'tab', 'keyPc', 'scaleId', 'positionId', 'labels', 'theme', 'direction', 'bpm', 'sound', 'drone',
  'lightsOn', 'stageMode', 'intensity', 'stemClick', 'stemDrums', 'stemBass', 'stemPad', 'drillFamily',
  'quizQuestion', 'quizMode', 'chordPairId', 'chordId', 'voicingId', 'progressionId', 'songId',
  'barIndex', 'songSectionId', 'sectionLoop', 'loopBars', 'sessionView', 'practiseFilter', 'micOn',
  'calibrationMs',
]);

test('KEEP-03: schema versions stay 2 and 3 and the settings keys are v1 minus theme plus view', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(BACKUP_SCHEMA_VERSION, 3);
  assert.equal(V1_SETTINGS_KEYS.length, 33);
  const expected = new Set([...V1_SETTINGS_KEYS.filter(key => key !== 'theme'), 'view']);
  assert.deepEqual(new Set(Object.keys(DEFAULT_SETTINGS)), expected);
});

test('Phase 7 keeps the storage contract: schema 2, backup 3, stored levels unchanged', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(BACKUP_SCHEMA_VERSION, 3);
  const progress = {
    version: 1,
    skills: { 'scaleRun:minPent:9:s6f5': { bestLevel: 2, cleanPasses: 4 } },
    sessions: [],
    totals: { totalMs: 12000, unguidedMs: 6000, sessionCount: 1 },
  };
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, settings: DEFAULT_SETTINGS, progress }),
  });
  const store = createSettingsStore(storage, CONTENT);
  assert.equal(store.getProgress().skills['scaleRun:minPent:9:s6f5'].bestLevel, 2, 'no migration lowers a stored level');
});
