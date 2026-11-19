// ---------- Versioned settings + progress store (t2coach.v1) ----------
// One key, one writer. The record holds the browse settings and the progress plane so a
// reload restores both from one atomic write (D-29). Storage and the content lookups are
// injected so the store runs in Node tests without a DOM.
import { scaleById, chordById, chordPairById, progressionById, songById } from './content.js';
import { emptyProgress, fitProgress, validateProgress } from './progress.js';

export const STORAGE_KEY = 't2coach.v1';
export const LEGACY_KEY = 't2scales';
export const SCHEMA_VERSION = 2;
export const MAX_RECORD_LENGTH = 512 * 1024;
export const BACKUP_KEY = 't2coach.v1.migration-backup';
const MAX_STRING = 64;

const TABS = ['scales', 'chords', 'progressions', 'songs'];
const LABELS = ['notes', 'degrees', 'intervals', 'fingers', 'none'];
const DIRECTIONS = ['up', 'down', 'updown'];
// The validator's own family list. The picker's guard in `main.applyChange` tests the same
// export, so the radio, the validator and the stage can never disagree about what may run.
// 04-03 adds the fifth family: `song` is one edit here because the picker's guard is a
// membership test on this list.
export const DRILL_FAMILIES = ['scaleRun', 'findNote', 'chordChanges', 'progression', 'song'];
// D-55's storage shape: four stems with independent mute plus one three-value preset over
// them. The preset is the bulk writer; the four booleans are the stored truth.
const INTENSITIES = ['click', 'drumsBass', 'full'];
// The preset is the bulk writer of the four stem booleans (A-58): one press writes all four
// at once, and a hand toggle afterwards changes exactly one of them without touching the
// stored preset. `click` is the click alone, `drumsBass` adds the drums and the bass, `full`
// is the whole band — the same three names the select offers and D-66 locks.
export const INTENSITY_STEMS = {
  click: { stemClick: true, stemDrums: false, stemBass: false, stemPad: false },
  drumsBass: { stemClick: true, stemDrums: true, stemBass: true, stemPad: false },
  full: { stemClick: true, stemDrums: true, stemBass: true, stemPad: true },
};
// The four stored stem keys, in the DOM's own order (click, drums, bass, pad), so a hand
// toggle can only ever write one of the four booleans the record carries.
export const STEM_KEYS = ['stemClick', 'stemDrums', 'stemBass', 'stemPad'];
// The loop window is an allow-list, not a clamp: a `3`, a `'4'` and a `null` all fall back
// to `Whole`, because a window the chart cannot honour must never reach `buildPlayAlongChart`
// (T-04-08). `Whole` is 0 — the whole item, in both senses.
export const LOOP_BARS = [0, 4, 8];
const QUIZ_QUESTIONS = ['note', 'degree', 'interval'];
const QUIZ_MODES = ['find', 'name'];
// The Session panel's two remembered preferences (05-01, D-73): which view it opens on and which
// list the Practise view shows. Both are closed allow-lists, so a hand-edited or imported record
// can only ever select one of the approved values (T-05-03).
export const SESSION_VIEWS = ['plan', 'practise'];
export const PRACTISE_FILTERS = ['due', 'pairs'];
// The main view the app reopens on (Phase 6): a v1 shell drops the unknown key, a v2 shell defaults a missing one.
export const VIEWS = ['today', 'practice', 'progress', 'library'];
const POSITION_ID = /^s6f(?:[0-9]|1[0-9]|2[0-4])$/;

export const DEFAULT_SETTINGS = {
  tab: 'scales', keyPc: 0, scaleId: 'major', positionId: 'all', labels: 'notes',
  direction: 'updown', bpm: 70, sound: true, drone: false, lightsOn: true, stageMode: false,
  // The backing mix (D-55): a full band is what a Phase 3 record loads, and the four stem
  // booleans are the stored truth the intensity select writes in bulk (A-58).
  intensity: 'full', stemClick: true, stemDrums: true, stemBass: true, stemPad: true,
  drillFamily: 'scaleRun', quizQuestion: 'note', quizMode: 'find', chordPairId: 'C-G',
  chordId: 'C', voicingId: 'open', progressionId: 'I-IV-V', songId: '', barIndex: 0,
  // The song plane (04-03): which section of the chosen song a pass plays, and whether the
  // pass repeats that section once more. `songSectionId: ''` resolves to the song's first
  // section, so a Phase 3 record loads unchanged and the Songs tab behaves exactly as today.
  songSectionId: '', sectionLoop: false,
  // The play-along's loop window: 0 is `Whole`, 4 and 8 are the two windows the charts can
  // honour. It is a stored preference, so a later pass reopens on the same window (D-64).
  loopBars: 0,
  // The Session panel's two preferences (05-01): the view it opens on and the Practise view's
  // filter. Two additive defaulted fields, so a Phase 4 record loads unchanged — no schema bump
  // and no migration, because `validateSettings` rebuilds the whole object from these defaults.
  sessionView: 'plan', practiseFilter: 'due',
  view: 'today',
  micOn: false, calibrationMs: 0,
};

// The stored offset is the player's measured latency: a device that needs more than the
// working range is saved at the ceiling and warned about, never rejected (D-48).
const clampCalibration = value => Math.min(250, Math.max(0, Math.round(value)));

const CONTENT = { scaleById, chordById, chordPairById, progressionById, songById };

// Content maps are plain objects, so an inherited key ("constructor", "toString",
// "__proto__") must never resolve as a real scale/chord/song (CR-02).
const owns = (map, key) => typeof key === 'string' && Object.hasOwn(map, key);
const ownEntry = (map, key) => (owns(map, key) ? map[key] : null);

const pickString = (value, allowed, fallback) =>
  typeof value === 'string' && value.length <= MAX_STRING && allowed.includes(value) ? value : fallback;

const pickBool = (value, fallback) => typeof value === 'boolean' ? value : fallback;

function clampBpm(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_SETTINGS.bpm;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.bpm;
  return Math.min(240, Math.max(30, Math.round(n)));
}

function maps(content) {
  return {
    scales: content.scaleById || content.SCALE_BY_ID || {},
    chords: content.chordById || {},
    pairs: content.chordPairById || {},
    progressions: content.progressionById || {},
    songs: content.songById || {},
    positionsForScale: typeof content.positionsForScale === 'function' ? content.positionsForScale : null,
  };
}

function resolvePosition(raw, keyPc, scaleId, content) {
  if (raw === 'all') return 'all';
  if (typeof raw !== 'string' || raw.length > MAX_STRING || !POSITION_ID.test(raw)) return 'all';
  if (!content.positionsForScale) return raw;
  const scale = ownEntry(content.scales, scaleId);
  if (!scale) return 'all';
  return content.positionsForScale(keyPc, scale).some(p => p.id === raw) ? raw : 'all';
}

function resolveVoicing(raw, family) {
  if (!family || !Array.isArray(family.voicings) || !family.voicings.length) return DEFAULT_SETTINGS.voicingId;
  const id = typeof raw === 'string' && raw.length <= MAX_STRING ? raw : '';
  return family.voicings.some(v => v.id === id) ? id : family.voicings[0].id;
}

function songBars(song, progressions) {
  if (!song || !Array.isArray(song.sections)) return 1;
  return song.sections.reduce((count, section) => {
    if (Array.isArray(section.degrees)) return count + section.degrees.length;
    const prog = ownEntry(progressions, section.progressionId);
    return count + (prog && Array.isArray(prog.degrees) ? prog.degrees.length : 0);
  }, 0) || 1;
}

export function validateSettings(raw, content = CONTENT) {
  const c = maps(content);
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  out.tab = pickString(raw.tab, TABS, out.tab);
  out.keyPc = Number.isInteger(raw.keyPc) && raw.keyPc >= 0 && raw.keyPc <= 11 ? raw.keyPc : out.keyPc;

  const scaleIds = Object.keys(c.scales);
  out.scaleId = typeof raw.scaleId === 'string' && raw.scaleId.length <= MAX_STRING && owns(c.scales, raw.scaleId)
    ? raw.scaleId : (owns(c.scales, out.scaleId) ? out.scaleId : (scaleIds[0] || out.scaleId));

  out.positionId = resolvePosition(raw.positionId, out.keyPc, out.scaleId, c);

  out.labels = pickString(raw.labels, LABELS, out.labels);
  out.direction = pickString(raw.direction, DIRECTIONS, out.direction);
  out.bpm = clampBpm(raw.bpm);
  out.sound = pickBool(raw.sound, out.sound);
  out.drone = pickBool(raw.drone, out.drone);
  out.lightsOn = pickBool(raw.lightsOn, out.lightsOn);
  out.stageMode = pickBool(raw.stageMode, out.stageMode);
  // The four checkboxes — not the preset — are the stored truth: a hand toggle changes one
  // stem and never re-derives the select's value (UI-SPEC A-58). A Phase 3 record that has
  // none of these keys loads the defaults, so no schema bump and no migration (D-55).
  out.intensity = pickString(raw.intensity, INTENSITIES, out.intensity);
  out.stemClick = pickBool(raw.stemClick, out.stemClick);
  out.stemDrums = pickBool(raw.stemDrums, out.stemDrums);
  out.stemBass = pickBool(raw.stemBass, out.stemBass);
  out.stemPad = pickBool(raw.stemPad, out.stemPad);
  out.drillFamily = pickString(raw.drillFamily, DRILL_FAMILIES, out.drillFamily);
  // An allow-list, not a clamp: only the three windows the charts carry survive validation.
  out.loopBars = LOOP_BARS.includes(raw.loopBars) ? raw.loopBars : out.loopBars;
  // The two Session-panel preferences are additive defaulted fields on the same record: a string
  // outside its closed list — `'x'`, a number, a `null` — falls back, so the panel can never open
  // on a view or a list it cannot render (T-05-03).
  out.sessionView = pickString(raw.sessionView, SESSION_VIEWS, out.sessionView);
  out.practiseFilter = pickString(raw.practiseFilter, PRACTISE_FILTERS, out.practiseFilter);
  out.view = pickString(raw.view, VIEWS, out.view);
  out.quizQuestion = pickString(raw.quizQuestion, QUIZ_QUESTIONS, out.quizQuestion);
  out.quizMode = pickString(raw.quizMode, QUIZ_MODES, out.quizMode);
  // The mic is opt-in and the stored offset is a per-device measurement, so both default
  // rather than being inferred; a hand-edited offset clamps instead of unlocking anything.
  out.micOn = pickBool(raw.micOn, out.micOn);
  out.calibrationMs = Number.isFinite(raw.calibrationMs) ? clampCalibration(raw.calibrationMs) : out.calibrationMs;

  // The chord pair is resolved own-key only: a prototype key such as "constructor" must
  // never resolve as a real pair (T-03-06), so `pickString` is not used here.
  const pairIds = Object.keys(c.pairs);
  out.chordPairId = typeof raw.chordPairId === 'string' && owns(c.pairs, raw.chordPairId)
    ? raw.chordPairId
    : (owns(c.pairs, out.chordPairId) ? out.chordPairId : (pairIds[0] || out.chordPairId));

  const chordIds = Object.keys(c.chords);
  out.chordId = typeof raw.chordId === 'string' && raw.chordId.length <= MAX_STRING && owns(c.chords, raw.chordId)
    ? raw.chordId : (owns(c.chords, out.chordId) ? out.chordId : (chordIds[0] || out.chordId));
  out.voicingId = resolveVoicing(raw.voicingId, ownEntry(c.chords, out.chordId));

  const progressionIds = Object.keys(c.progressions);
  out.progressionId = typeof raw.progressionId === 'string' && raw.progressionId.length <= MAX_STRING && owns(c.progressions, raw.progressionId)
    ? raw.progressionId : (owns(c.progressions, out.progressionId) ? out.progressionId : (progressionIds[0] || out.progressionId));

  const songIds = Object.keys(c.songs);
  if (raw.songId === '' || raw.songId === undefined || raw.songId === null) out.songId = '';
  else out.songId = typeof raw.songId === 'string' && raw.songId.length <= MAX_STRING && owns(c.songs, raw.songId)
    ? raw.songId : (songIds[0] || '');

  // The section is resolved against the **chosen** song, and only by membership in its own
  // `sections[].id` list. A stale id from another song, a crafted one or a prototype shape
  // (`'constructor'`, `'__proto__'`) falls back to the song's first section instead of
  // rendering an empty select or a chart for a section that does not exist (T-04-15).
  // An empty `songId` (the Phase 3 default, and the Songs tab before any song is picked)
  // has no sections at all, so the section stays `''`.
  const chosenSong = ownEntry(c.songs, out.songId);
  const sectionIds = chosenSong && Array.isArray(chosenSong.sections)
    ? chosenSong.sections.filter(section => section && typeof section.id === 'string').map(section => section.id)
    : [];
  out.songSectionId = typeof raw.songSectionId === 'string' && sectionIds.includes(raw.songSectionId)
    ? raw.songSectionId
    : (sectionIds[0] || '');
  // The section loop is a boolean and nothing else: a `'true'`, a `1` and a `null` all fall
  // back, because the toggle doubles a pass and a crafted record must not (T-04-16).
  out.sectionLoop = pickBool(raw.sectionLoop, out.sectionLoop);

  const selectedProgression = ownEntry(c.progressions, out.progressionId);
  const barCount = out.tab === 'songs' && out.songId
    ? songBars(ownEntry(c.songs, out.songId), c.progressions)
    : (selectedProgression && Array.isArray(selectedProgression.degrees) ? selectedProgression.degrees.length : 1);
  const barIndex = Number.isInteger(raw.barIndex) ? raw.barIndex : 0;
  out.barIndex = Math.min(Math.max(0, barCount - 1), Math.max(0, barIndex));
  return out;
}

export function migrateLegacySettings(raw, content = CONTENT) {
  const c = maps(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keyPc = Number(raw.key);
  return {
    ...DEFAULT_SETTINGS,
    keyPc: Number.isInteger(keyPc) && keyPc >= 0 && keyPc <= 11 ? keyPc : DEFAULT_SETTINGS.keyPc,
    scaleId: typeof raw.scale === 'string' && Object.hasOwn(c.scales, raw.scale) ? raw.scale : DEFAULT_SETTINGS.scaleId,
    labels: pickString(raw.labels, LABELS, DEFAULT_SETTINGS.labels),
    direction: pickString(raw.dir, DIRECTIONS, DEFAULT_SETTINGS.direction),
    bpm: clampBpm(raw.bpm),
  };
}

export function createSettingsStore(storage, content = CONTENT) {
  let settings = null;
  let progress = null;
  let loaded = false;
  let status = 'ok';

  const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

  // The one write path, and the one place the byte ceiling is enforced: the fully serialized
  // document is measured (never a shell estimate), and if it would cross `MAX_RECORD_LENGTH`
  // the progress plane is fitted against the exact remaining budget — the wrapper overhead is
  // measured on this very document, `,"progress":` plus the closing brace included. Every
  // record the app writes is therefore a record the app can read back (T-04-22).
  // Returns the plane that was written (fitted or untouched), or null when the write failed.
  function persist(nextSettings, nextProgress) {
    const doc = { schemaVersion: SCHEMA_VERSION, settings: nextSettings, progress: nextProgress };
    try {
      let serialized = JSON.stringify(doc);
      if (serialized.length > MAX_RECORD_LENGTH) {
        const overhead = serialized.length - JSON.stringify(doc.progress).length;
        doc.progress = fitProgress(doc.progress, MAX_RECORD_LENGTH - overhead);
        serialized = JSON.stringify(doc);
        // The fitted plane is not a guarantee: `fitProgress` keeps the newest skill even when
        // that record alone is over the budget, so re-measure and refuse to write a document
        // `load()` would classify as readFailed and default. The catch below turns this into
        // `writeFailed`, and the caller keeps the previous plane (IN-01, T-04-22).
        if (serialized.length > MAX_RECORD_LENGTH) throw new Error('record over ceiling');
      }
      storage.setItem(STORAGE_KEY, serialized);
      status = 'ok';
      return doc.progress;
    } catch (e) {
      status = 'writeFailed';
      return null;
    }
  }

  function readLegacy() {
    try {
      const raw = storage.getItem(LEGACY_KEY);
      if (!raw || raw.length > MAX_RECORD_LENGTH) return null;
      return migrateLegacySettings(JSON.parse(raw), content);
    } catch (e) {
      return null;
    }
  }

  // Copy the pre-migration bytes once; a backup failure never blocks the v2 write (T-02-15).
  function backupV1(raw) {
    try {
      if (storage.getItem(BACKUP_KEY) === raw) return;
      storage.setItem(BACKUP_KEY, raw);
    } catch (e) {}
  }

  function load() {
    let nextSettings = null;
    let nextProgress = null;
    status = 'ok';
    let raw = null;
    let readable = true;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (e) {
      readable = false;
    }
    if (!readable) {
      status = 'readFailed';
      nextSettings = { ...DEFAULT_SETTINGS };
      nextProgress = emptyProgress();
    } else if (raw !== null && raw !== undefined && raw !== '') {
      if (String(raw).length > MAX_RECORD_LENGTH) {
        // A record that somehow arrives oversized is data loss the moment the store defaults,
        // so the raw bytes are copied to the backup key first — the same recovery the WR-08
        // branch above gives a plane that had to be replaced. Progress is never dropped
        // without a copy the player can still import (T-04-22).
        status = 'readFailed';
        backupV1(String(raw));
        nextSettings = { ...DEFAULT_SETTINGS };
        nextProgress = emptyProgress();
      } else {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = null;
        }
        if (!isPlainObject(parsed)) {
          status = 'readFailed';
          nextSettings = { ...DEFAULT_SETTINGS };
          nextProgress = emptyProgress();
        } else if (parsed.schemaVersion === SCHEMA_VERSION) {
          // The two planes validate independently: a bad settings object keeps the
          // valid progress plane and a bad progress object keeps valid settings.
          nextSettings = validateSettings(parsed.settings, content);
          nextProgress = validateProgress(parsed.progress);
          // A plane that had to be replaced is data loss, not a clean load. Keep the
          // original bytes before the next write overwrites them, and surface it at
          // boot instead of silently resetting (WR-08).
          if (!isPlainObject(parsed.settings) || !isPlainObject(parsed.progress)) {
            status = 'readFailed';
            backupV1(String(raw));
          }
        } else if (parsed.schemaVersion === 1) {
          nextSettings = validateSettings(parsed.settings, content);
          nextProgress = emptyProgress();
          backupV1(String(raw));
          persist(nextSettings, nextProgress);
        } else {
          status = 'readFailed';
          nextSettings = { ...DEFAULT_SETTINGS };
          nextProgress = emptyProgress();
        }
      }
    } else {
      const legacy = readLegacy();
      nextSettings = legacy || { ...DEFAULT_SETTINGS };
      nextProgress = emptyProgress();
      if (legacy) persist(nextSettings, nextProgress);
    }
    settings = nextSettings;
    progress = nextProgress;
    loaded = true;
    return settings;
  }

  const progressNow = () => (loaded && progress ? progress : emptyProgress());

  return {
    load,
    get status() { return status; },
    get() { return loaded ? settings : load(); },
    getProgress() {
      if (!loaded) load();
      return progress;
    },
    set(patch) {
      const current = loaded ? settings : load();
      settings = validateSettings({ ...current, ...patch }, content);
      loaded = true;
      const written = persist(settings, progressNow());
      // The fitted plane is the plane the store now holds: a later read can never resurrect
      // history the record had to shed to stay under the ceiling.
      if (written) progress = written;
      return settings;
    },
    setProgress(next) {
      if (!loaded) load();
      progress = validateProgress(next);
      const written = persist(settings, progress);
      if (written) progress = written;
      // The caller gets the fitted plane, never the one it handed in (T-04-22).
      return progress;
    },
    save() {
      const written = persist(loaded ? settings : load(), progressNow());
      if (written) progress = written;
      return settings;
    },
    // Import replace: one write, and a throwing write restores the previous snapshot.
    replaceAll(doc) {
      if (!loaded) load();
      const source = isPlainObject(doc) ? doc : {};
      const previousSettings = settings;
      const previousProgress = progress;
      settings = validateSettings(source.settings, content);
      progress = validateProgress(source.progress);
      const written = persist(settings, progress);
      if (!written) {
        settings = previousSettings;
        progress = previousProgress;
      } else {
        // An import that had to be fitted adopts the fitted plane, so the panel and the
        // record agree about what the store now holds.
        progress = written;
      }
      return settings;
    },
    record() {
      if (!loaded) load();
      // Settings were always copied; progress is copied too so a caller cannot mutate
      // the store's live plane through the returned record (IN-07).
      return { schemaVersion: SCHEMA_VERSION, settings: { ...settings }, progress: { ...progress } };
    },
  };
}
