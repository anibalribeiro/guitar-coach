// ---------- Scale and chord math ----------
// Standard tuning, string 1 = high E
export const OPEN = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
export const FRETS = 19;
export const MARKERS = [3, 5, 7, 9, 12, 15, 17, 19];

export const mod12 = n => ((n % 12) + 12) % 12;

// ---------- Key-signature spelling (D-17) ----------
// One source of truth: the seven letter names of each major key signature. Every
// scale degree is spelled from the parent scale's letters; a degree that would need
// a double accidental falls back to its chromatic name, so no double accidental is
// ever emitted.
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_VALUES = { '♭♭': -2, '♭': -1, '': 0, '♯': 1, '♯♯': 2 };
const ACC_NAMES = ['♭♭', '♭', '', '♯', '♯♯'];
const CHROMATIC_SHARPS = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const CHROMATIC_FLATS = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];

const KEY_SIGNATURES = {
  0: ['C','D','E','F','G','A','B'],
  1: ['D♭','E♭','F','G♭','A♭','B♭','C'],
  2: ['D','E','F♯','G','A','B','C♯'],
  3: ['E♭','F','G','A♭','B♭','C','D'],
  4: ['E','F♯','G♯','A','B','C♯','D♯'],
  5: ['F','G','A','B♭','C','D','E'],
  6: ['F♯','G♯','A♯','B','C♯','D♯','E♯'],
  7: ['G','A','B','C','D','E','F♯'],
  8: ['A♭','B♭','C','D♭','E♭','F','G'],
  9: ['A','B','C♯','D','E','F♯','G♯'],
  10: ['B♭','C','D','E♭','F','G','A'],
  11: ['B','C♯','D♯','E','F♯','G♯','A♯'],
};

// Semitone interval -> which letter of the parent scale it uses (0 = tonic).
const DEGREE_LETTER = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };

function parseName(name) {
  const letter = name[0];
  const acc = ACC_VALUES[name.slice(1)] ?? 0;
  return { letter, acc, pc: mod12(NATURAL_PC[letter] + acc) };
}

function formatName(letter, offset) {
  if (offset < -2 || offset > 2) return null;
  return letter + ACC_NAMES[offset + 2];
}

const shortestDelta = (from, to) => {
  let d = mod12(to - from);
  if (d > 6) d -= 12;
  return d;
};

const isFlatKey = keyPc => (KEY_SIGNATURES[keyPc] || KEY_SIGNATURES[0]).some(n => n.includes('♭'));

function chromaticName(pc, flat) {
  return (flat ? CHROMATIC_FLATS : CHROMATIC_SHARPS)[mod12(pc)];
}

function spellFromLetter(name, targetPc) {
  const { letter, acc, pc } = parseName(name);
  return formatName(letter, acc + shortestDelta(pc, targetPc));
}

// The locked D-17 policy: the blues note is ♭5 in flat keys (KEY_NAMES indices 1, 3,
// 5, 8, 10) and ♯4 in sharp keys. If the preferred spelling would need a double
// accidental (D♭, E♭, A♭), use the other enharmonic spelling. Research preferred the
// reverse mapping; the user decision wins.
function spellBluesNote(keySig, keyPc, flat) {
  const targetPc = mod12(keyPc + 6);
  const preferred = flat ? spellFromLetter(keySig[4], targetPc) : spellFromLetter(keySig[3], targetPc);
  if (preferred && !preferred.includes('♭♭') && !preferred.includes('♯♯')) return preferred;
  const other = flat ? spellFromLetter(keySig[3], targetPc) : spellFromLetter(keySig[4], targetPc);
  return other && !other.includes('♭♭') && !other.includes('♯♯') ? other : chromaticName(targetPc, flat);
}

function spellDegree(keySig, keyPc, iv, scaleDef, flat) {
  const targetPc = mod12(keyPc + iv);
  if (iv === 6 && scaleDef.id === 'blues') return spellBluesNote(keySig, keyPc, flat);
  const letterIndex = DEGREE_LETTER[iv];
  if (letterIndex === undefined) return chromaticName(targetPc, flat);
  const name = spellFromLetter(keySig[letterIndex], targetPc);
  return name && !name.includes('♭♭') && !name.includes('♯♯') ? name : chromaticName(targetPc, flat);
}

// Full 12-entry name table for a key/scale, the single spelling source used by the
// board, chips and panels. Non-scale pitch classes use the key's chromatic fallback.
export function spellScale(keyPc, scaleDef) {
  const key = mod12(keyPc);
  const keySig = KEY_SIGNATURES[key] || KEY_SIGNATURES[0];
  const flat = isFlatKey(key);
  const names = (flat ? CHROMATIC_FLATS : CHROMATIC_SHARPS).slice();
  for (const iv of scaleDef.intervals) names[mod12(key + iv)] = spellDegree(keySig, key, iv, scaleDef, flat);
  return names;
}

// Name one pitch class inside a key (used for chord roots in charts).
export function spellPitch(keyPc, pc) {
  const key = mod12(keyPc);
  const keySig = KEY_SIGNATURES[key] || KEY_SIGNATURES[0];
  for (const name of keySig) if (parseName(name).pc === mod12(pc)) return name;
  return chromaticName(pc, isFlatKey(key));
}

// ---------- Position boxes ----------
// Position boxes: N notes per string (2 for pentatonic-sized scales, 3 for 6+ notes),
// starting from each scale degree on the low E string. Each box is a fret range per string.
export function buildPositions(root, base) {
  if (base.length > 8) return [];
  const nps = base.length >= 6 ? 3 : 2;
  const out = [];
  for (const iv of base) {
    let f0 = mod12(root + iv - 4);
    for (let attempt = 0; attempt < 2; attempt++, f0 += 12) {
      const pitches = [];
      for (let m = 40 + f0; pitches.length < nps * 6; m++) if (base.includes(mod12(m - root))) pitches.push(m);
      const ranges = {};
      let ok = true;
      for (let s = 6, i = 0; s >= 1; s--, i += nps) {
        const frets = pitches.slice(i, i + nps).map(p => p - OPEN[s]);
        if (Math.min(...frets) < 0) ok = false;
        ranges[s] = [Math.min(...frets), Math.max(...frets)];
      }
      if (ok) { out.push({ start: f0, ranges }); break; }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// The v1 practice cap: first five boxes sorted by low-E anchor. Whole-neck browse
// remains a separate 'all' selection that keeps every note (D-16).
export function positionsForScale(keyPc, scaleDef, limit = 5) {
  const base = scaleDef.baseIntervals || scaleDef.intervals;
  return buildPositions(keyPc, base).slice(0, limit).map((box, i) => ({
    id: 's6f' + box.start,
    label: 'Position ' + (i + 1),
    anchor: box.start,
    start: box.start,
    ranges: box.ranges,
  }));
}

// Keep the selected practice box when the key changes: position ids are
// key-absolute ('s6f' + low-E anchor), so the shape follows the box index rather
// than the old fret number. 'all' and unknown ids fall back to whole neck.
export function remapPosition(positionId, fromKeyPc, toKeyPc, scaleDef) {
  if (positionId === 'all' || !scaleDef) return 'all';
  const before = positionsForScale(fromKeyPc, scaleDef);
  const index = before.findIndex(p => p.id === positionId);
  if (index < 0) return 'all';
  const after = positionsForScale(toKeyPc, scaleDef);
  return after[index] ? after[index].id : 'all';
}


// Display note set: every scale note on the neck, including open strings.
export function notesForScale(keyPc, scaleDef, position = null) {
  const notes = [];
  for (let s = 1; s <= 6; s++) {
    for (let f = 0; f <= FRETS; f++) {
      const midi = OPEN[s] + f, iv = mod12(midi - keyPc);
      if (!scaleDef.intervals.includes(iv)) continue;
      if (position && (f < position.ranges[s][0] || f > position.ranges[s][1])) continue;
      notes.push({ s, f, midi, iv });
    }
  }
  return notes;
}

// Position order (low string -> high string, low fret -> high fret). Whole-neck is
// deduped by MIDI with the lowest-fret fingering, which is the drill sequence shape.
export function notesForPosition(keyPc, scaleDef, positionId) {
  if (positionId === 'all' || positionId === null || positionId === undefined) {
    const byMidi = new Map();
    for (const n of notesForScale(keyPc, scaleDef, null)) {
      const current = byMidi.get(n.midi);
      if (!current || n.f < current.f) byMidi.set(n.midi, n);
    }
    return [...byMidi.values()].sort((a, b) => a.midi - b.midi);
  }
  const position = positionsForScale(keyPc, scaleDef).find(p => p.id === positionId);
  if (!position) return [];
  const notes = [];
  for (let s = 6; s >= 1; s--) {
    const [lo, hi] = position.ranges[s];
    for (let f = lo; f <= hi; f++) {
      const midi = OPEN[s] + f, iv = mod12(midi - keyPc);
      if (scaleDef.intervals.includes(iv)) notes.push({ s, f, midi, iv });
    }
  }
  return notes;
}

// Practice order over notes already in ascending position order. Up-down repeats
// neither endpoint: [0,1,2,3] -> [0,1,2,3,2,1].
export function sequenceFor(notes, direction = 'updown') {
  if (direction === 'up') return notes;
  if (direction === 'down') return [...notes].reverse();
  return notes.concat(notes.slice(1, -1).reverse());
}

// ---------- Chord expansion ----------
// voicing.frets/fingers run low E -> high E; missing frets are null (muted). The root
// pitch class is derived from rootString so every sounding voicing can mark it.
export function expandChord(voicing) {
  const rootFret = voicing.frets[6 - voicing.rootString];
  const rootPc = rootFret === null || rootFret === undefined ? null : mod12(OPEN[voicing.rootString] + rootFret);
  return voicing.frets.map((f, i) => {
    const s = 6 - i;
    const finger = voicing.fingers[i] === undefined ? null : voicing.fingers[i];
    if (f === null || f === undefined) return { s, f: null, midi: null, pc: null, root: false, open: false, muted: true, finger: null };
    const midi = OPEN[s] + f, pc = mod12(midi);
    return { s, f, midi, pc, root: pc === rootPc, open: f === 0, muted: false, finger };
  });
}

// ---------- Progression expansion ----------
const MAJOR_DIATONIC = [
  { off: 0, roman: 'I', quality: 'maj' },
  { off: 2, roman: 'ii', quality: 'min' },
  { off: 4, roman: 'iii', quality: 'min' },
  { off: 5, roman: 'IV', quality: 'maj' },
  { off: 7, roman: 'V', quality: 'maj' },
  { off: 9, roman: 'vi', quality: 'min' },
  { off: 11, roman: 'vii°', quality: 'dim' },
];
const MINOR_DIATONIC = [
  { off: 0, roman: 'i', quality: 'min' },
  { off: 2, roman: 'ii°', quality: 'dim' },
  { off: 3, roman: 'III', quality: 'maj' },
  { off: 5, roman: 'iv', quality: 'min' },
  { off: 7, roman: 'v', quality: 'min' },
  { off: 8, roman: 'VI', quality: 'maj' },
  { off: 10, roman: 'VII', quality: 'maj' },
];

const qualitySuffix = quality => quality === 'min' ? 'm' : quality === 'dim' ? '°' : '';

// Table lookup, never a search engine. 4/4 only in v1; barsPerChord is 1.
export function expandProgression(progDef, keyPc) {
  const table = progDef.mode === 'minor' ? MINOR_DIATONIC : MAJOR_DIATONIC;
  return (progDef.degrees || []).map((degree, i) => {
    const d = table[degree - 1] || table[0];
    const rootPc = mod12(keyPc + d.off);
    return {
      bar: i + 1,
      degree,
      roman: d.roman,
      rootPc,
      quality: d.quality,
      name: spellPitch(keyPc, rootPc) + qualitySuffix(d.quality),
    };
  });
}

// A song section either references a curated progression or carries inline degrees.
// The effective mode is section.mode -> song.mode -> 'major'. progressionById is
// injected because theory.js imports nothing.
export function expandSongSection(song, section, keyPc, progressionById = {}) {
  if (section.progressionId) {
    const prog = progressionById[section.progressionId];
    if (!prog) return [];
    return expandProgression({ ...prog, mode: section.mode || prog.mode }, keyPc);
  }
  const mode = section.mode || song.mode || 'major';
  return expandProgression({ mode, degrees: section.degrees || [], barsPerChord: section.barsPerChord || 1 }, keyPc);
}

// ---------- Curated / movable voicing selection ----------
// E-shape and A-shape movable tables. Every generated voicing fits frets 0-19.
const MOVABLE = {
  maj: [
    { id: 'barreE', rootString: 6, frets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
    { id: 'barreA', rootString: 5, frets: [null, 0, 2, 2, 2, 0], fingers: [null, 1, 3, 3, 3, 1] },
  ],
  min: [
    { id: 'barreE', rootString: 6, frets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
    { id: 'barreA', rootString: 5, frets: [null, 0, 2, 2, 1, 0], fingers: [null, 1, 3, 4, 2, 1] },
  ],
  '7': [
    { id: 'barreE', rootString: 6, frets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
    { id: 'barreA', rootString: 5, frets: [null, 0, 2, 0, 2, 0], fingers: [null, 1, 3, 1, 4, 1] },
  ],
};

export function voiceChord(rootPc, quality, preferredId, families = []) {
  const family = families.find(f => f.rootPc === mod12(rootPc) && f.quality === quality);
  if (family) {
    const preferred = preferredId ? family.voicings.find(v => v.id === preferredId) : null;
    return preferred || family.voicings[0];
  }
  const shapes = MOVABLE[quality];
  if (!shapes) return null;
  const candidates = shapes.map(shape => ({
    shape,
    fret: mod12(rootPc - OPEN[shape.rootString]),
  })).filter(({ shape, fret }) => {
    const top = Math.max(...shape.frets.filter(f => f !== null));
    return fret + top <= 19;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.fret - b.fret);
  const { shape, fret } = candidates[0];
  const frets = shape.frets.map(f => f === null ? null : f + fret);
  const fingers = shape.fingers.slice();
  return {
    id: shape.id + fret,
    label: 'Barre · fret ' + fret,
    baseFret: fret,
    rootString: shape.rootString,
    tags: ['barre'],
    frets,
    fingers,
    barre: { fret, from: shape.rootString, to: 1 },
  };
}

// One call for the two outputs the original screen used: the display set and the
// practice sequence, plus the key-signature spellings.
export function computeScaleNotes({ keyPc, scaleDef, position = null, direction = 'updown' }) {
  const notes = notesForScale(keyPc, scaleDef, position);
  return {
    notes,
    sequence: sequenceFor(position ? notesForPosition(keyPc, scaleDef, position.id) : notesForPosition(keyPc, scaleDef, 'all'), direction),
    names: spellScale(keyPc, scaleDef),
  };
}
