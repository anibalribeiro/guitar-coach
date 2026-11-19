// ---------- v1 content (compiled static data; imports nothing) ----------
// CONTENT_VERSION is the content schema version and is deliberately independent of
// the t2coach.v1 settings schema (CONT-02). Content changes never rewrite settings.
export const CONTENT_VERSION = 1;

// ---------- Name tables ----------
export const SHARPS = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const FLATS  = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
export const KEYS = [0,1,2,3,4,5,6,7,8,9,10,11];
export const KEY_NAMES = ['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const FLAT_KEYS = [1,3,5,8,10];
export const DEGREES   = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
export const INTERVALS = ['R','m2','M2','m3','M3','P4','TT','P5','m6','M6','m7','M7'];
export const INTERVAL_NAMES = [
  'Root','Minor 2nd','Major 2nd','Minor 3rd','Major 3rd','Perfect 4th',
  'Tritone','Perfect 5th','Minor 6th','Major 6th','Minor 7th','Major 7th',
];

export const MAJOR = [0,2,4,5,7,9,11];
export const MINOR = [0,2,3,5,7,8,10];
export const MIN_PENT = [0,3,5,7,10];
export const MAJ_PENT = [0,2,4,7,9];
export const BLUES = [0,3,5,6,7,10];

// ---------- Scales (exactly four; CONT-01) ----------
export const SCALES = [
  { id: 'minPent', name: 'Minor pentatonic', intervals: MIN_PENT, baseIntervals: MIN_PENT },
  { id: 'majPent', name: 'Major pentatonic', intervals: MAJ_PENT, baseIntervals: MAJ_PENT },
  { id: 'major', name: 'Major', intervals: MAJOR, baseIntervals: MAJOR },
  { id: 'blues', name: 'Blues', intervals: BLUES, baseIntervals: MIN_PENT },
];
export const scaleById = Object.fromEntries(SCALES.map(s => [s.id, s]));
// Wave-1 alias kept for settings.js; both point at the same four v1 scales.
export const SCALE_BY_ID = scaleById;

// ---------- Chords (eight families; CHORD-01) ----------
// Convention, stated once and never varied: frets/fingers run low E -> high E with
// exactly six entries; null means muted (fingers null also means open). `barre` uses
// string numbers 1-6, never array indices.
export const CHORD_FAMILIES = [
  { id: 'C', name: 'C', rootPc: 0, quality: 'maj', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 5, tags: ['open'],
      frets: [null, 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 5, tags: ['open', '7th'],
      frets: [null, 3, 2, 3, 1, 0], fingers: [null, 3, 2, 4, 1, null], barre: null },
    { id: 'barreA3', label: 'Barre · fret 3', baseFret: 3, rootString: 5, tags: ['barre'],
      frets: [null, 3, 5, 5, 5, 3], fingers: [null, 1, 3, 3, 3, 1], barre: { fret: 3, from: 5, to: 1 } },
  ] },
  { id: 'G', name: 'G', rootPc: 7, quality: 'maj', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 6, tags: ['open'],
      frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 6, tags: ['open', '7th'],
      frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, null, null, null, 1], barre: null },
    { id: 'barreE3', label: 'Barre · fret 3', baseFret: 3, rootString: 6, tags: ['barre'],
      frets: [3, 5, 5, 4, 3, 3], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 3, from: 6, to: 1 } },
  ] },
  { id: 'D', name: 'D', rootPc: 2, quality: 'maj', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 4, tags: ['open'],
      frets: [null, null, 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 4, tags: ['open', '7th'],
      frets: [null, null, 0, 2, 1, 2], fingers: [null, null, null, 2, 1, 3], barre: null },
    { id: 'barreA5', label: 'Barre · fret 5', baseFret: 5, rootString: 5, tags: ['barre'],
      frets: [null, 5, 7, 7, 7, 5], fingers: [null, 1, 3, 3, 3, 1], barre: { fret: 5, from: 5, to: 1 } },
  ] },
  { id: 'A', name: 'A', rootPc: 9, quality: 'maj', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 5, tags: ['open'],
      frets: [null, 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 5, tags: ['open', '7th'],
      frets: [null, 0, 2, 0, 2, 0], fingers: [null, null, 2, null, 3, null], barre: null },
    { id: 'barreE5', label: 'Barre · fret 5', baseFret: 5, rootString: 6, tags: ['barre'],
      frets: [5, 7, 7, 6, 5, 5], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 5, from: 6, to: 1 } },
  ] },
  { id: 'E', name: 'E', rootPc: 4, quality: 'maj', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 6, tags: ['open'],
      frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 6, tags: ['open', '7th'],
      frets: [0, 2, 0, 1, 0, 0], fingers: [null, 2, null, 1, null, null], barre: null },
    { id: 'barreA7', label: 'Barre · fret 7', baseFret: 7, rootString: 5, tags: ['barre'],
      frets: [null, 7, 9, 9, 9, 7], fingers: [null, 1, 3, 3, 3, 1], barre: { fret: 7, from: 5, to: 1 } },
  ] },
  { id: 'Am', name: 'Am', rootPc: 9, quality: 'min', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 5, tags: ['open'],
      frets: [null, 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 5, tags: ['open', '7th'],
      frets: [null, 0, 2, 0, 1, 0], fingers: [null, null, 2, null, 1, null], barre: null },
    { id: 'barreE5', label: 'Barre · fret 5', baseFret: 5, rootString: 6, tags: ['barre'],
      frets: [5, 7, 7, 5, 5, 5], fingers: [1, 3, 4, 1, 1, 1], barre: { fret: 5, from: 6, to: 1 } },
  ] },
  { id: 'Dm', name: 'Dm', rootPc: 2, quality: 'min', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 4, tags: ['open'],
      frets: [null, null, 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 4, tags: ['open', '7th'],
      frets: [null, null, 0, 2, 1, 1], fingers: [null, null, null, 2, 1, 1], barre: null },
    { id: 'barreA5', label: 'Barre · fret 5', baseFret: 5, rootString: 5, tags: ['barre'],
      frets: [null, 5, 7, 7, 6, 5], fingers: [null, 1, 3, 4, 2, 1], barre: { fret: 5, from: 5, to: 1 } },
  ] },
  { id: 'Em', name: 'Em', rootPc: 4, quality: 'min', voicings: [
    { id: 'open', label: 'Open', baseFret: 0, rootString: 6, tags: ['open'],
      frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null], barre: null },
    { id: '7', label: '7th', baseFret: 0, rootString: 6, tags: ['open', '7th'],
      frets: [0, 2, 0, 0, 0, 0], fingers: [null, 2, null, null, null, null], barre: null },
    { id: 'barreE12', label: 'Barre · fret 12', baseFret: 12, rootString: 6, tags: ['barre'],
      frets: [12, 14, 14, 12, 12, 12], fingers: [1, 3, 4, 1, 1, 1], barre: { fret: 12, from: 6, to: 1 } },
  ] },
];
export const chordById = Object.fromEntries(CHORD_FAMILIES.map(c => [c.id, c]));

// ---------- Chord-change pairs (eleven curated loops; CHORD-02) ----------
// A pair is an ordered loop of chord ids that all resolve in `chordById`: an id the
// eight families above do not define would throw on selection, so the table never
// leaves them (CONT-01 caps content at eight chords). The label's arrow is U+2192 with
// one space either side, never '->'. The id becomes a settings value and a persisted
// record key, so every id satisfies progress.js `SAFE_ID`.
export const CHORD_PAIRS = [
  { id: 'C-G', label: 'C → G', chords: ['C', 'G'] },
  { id: 'G-D', label: 'G → D', chords: ['G', 'D'] },
  { id: 'D-A', label: 'D → A', chords: ['D', 'A'] },
  { id: 'A-E', label: 'A → E', chords: ['A', 'E'] },
  { id: 'E-Am', label: 'E → Am', chords: ['E', 'Am'] },
  { id: 'Am-C', label: 'Am → C', chords: ['Am', 'C'] },
  { id: 'Em-Am', label: 'Em → Am', chords: ['Em', 'Am'] },
  { id: 'Dm-G', label: 'Dm → G', chords: ['Dm', 'G'] },
  { id: 'C-Am-Dm-G', label: 'C → Am → Dm → G', chords: ['C', 'Am', 'Dm', 'G'] },
  { id: 'G-D-Em-C', label: 'G → D → Em → C', chords: ['G', 'D', 'Em', 'C'] },
  { id: 'Am-Dm-G-C', label: 'Am → Dm → G → C', chords: ['Am', 'Dm', 'G', 'C'] },
];
export const chordPairById = Object.fromEntries(CHORD_PAIRS.map(p => [p.id, p]));

// ---------- Progressions (exactly eight) ----------
export const PROGRESSIONS = [
  { id: 'I-IV-V', name: 'I–IV–V', mode: 'major', degrees: [1,4,5], barsPerChord: 1 },
  { id: 'ii-V-I', name: 'ii–V–I', mode: 'major', degrees: [2,5,1], barsPerChord: 1 },
  { id: 'I-V-vi-IV', name: 'I–V–vi–IV', mode: 'major', degrees: [1,5,6,4], barsPerChord: 1 },
  { id: '12-bar-blues', name: '12-bar blues', mode: 'major',
    degrees: [1,1,1,1,4,4,1,1,5,4,1,5], barsPerChord: 1 },
  { id: 'vi-IV-I-V', name: 'vi–IV–I–V', mode: 'major', degrees: [6,4,1,5], barsPerChord: 1 },
  { id: 'I-vi-IV-V', name: 'I–vi–IV–V', mode: 'major', degrees: [1,6,4,5], barsPerChord: 1 },
  { id: 'i-VI-III-VII', name: 'i–VI–III–VII', mode: 'minor', degrees: [1,6,3,7], barsPerChord: 1 },
  { id: 'blues-quick-change', name: 'Blues quick change', mode: 'major',
    degrees: [1,4,1,1,4,4,1,1,5,4,1,5], barsPerChord: 1 },
];
export const progressionById = Object.fromEntries(PROGRESSIONS.map(p => [p.id, p]));

// ---------- Songs (four traditional/public-domain charts) ----------
// A section carries exactly one of progressionId or inline degrees; no melody,
// lyrics, tab, recording or playback (playback is Phase 4).
export const SONGS = [
  { id: 'willTheCircleBeUnbroken', title: 'Will the Circle Be Unbroken', keyPc: 7,
    meter: [4,4], defaultBpm: 84, mode: 'major', strum: 'D DU UDU',
    tip: 'Change on beat 1; let the last strum ring.', provenance: 'Traditional, public domain',
    sections: [
      { id: 'verse', name: 'Verse', repeats: 2, degrees: [1,4,1,5] },
      { id: 'chorus', name: 'Chorus', repeats: 1, degrees: [1,4,1,5,1] },
    ] },
  { id: 'thisLittleLightOfMine', title: 'This Little Light of Mine', keyPc: 0,
    meter: [4,4], defaultBpm: 96, mode: 'major', strum: 'D D DU UDU',
    tip: 'Keep the strum even and let the light shine on the chorus.', provenance: 'Traditional, public domain',
    sections: [
      { id: 'verse', name: 'Verse', repeats: 2, degrees: [1,1,4,1] },
      { id: 'chorus', name: 'Chorus', repeats: 1, degrees: [1,4,1,5,1] },
    ] },
  { id: 'ohSusanna', title: 'Oh! Susanna', keyPc: 0,
    meter: [4,4], defaultBpm: 100, mode: 'major', strum: 'D DU D DU',
    tip: 'The verse is a loop; keep the bass note on beat 1.', provenance: 'Traditional, public domain',
    sections: [
      { id: 'verse', name: 'Verse', repeats: 2, degrees: [1,4,1,5] },
      { id: 'chorus', name: 'Chorus', repeats: 1, degrees: [1,4,5,1] },
    ] },
  { id: 'amazingGrace', title: 'Amazing Grace', keyPc: 7,
    meter: [3,4], defaultBpm: 70, mode: 'major', strum: 'D D DU',
    tip: 'Three beats per bar; let the last chord breathe.', provenance: 'Traditional, public domain',
    sections: [
      { id: 'verse', name: 'Verse', repeats: 1, degrees: [1,4,1,5,1] },
    ] },
];
export const songById = Object.fromEntries(SONGS.map(s => [s.id, s]));

// ---------- Micro-lessons (one per drill family; TEACH-01, D-75) ----------
// Eight fields and no more: `title` is the family's own picker label so the panel heading can
// never contradict the stage, `why`/`mistake`/`practice` are the panel's first three blocks,
// `link`/`linkLabel` are the one external anchor, `videos` are the curated external
// watch-and-read links, and `demo` names the self-hosted silent clip for this family. Every
// sentence is a claim this app can attest — the hint ladder, the forced no-light pass, the
// click and the count-in, the microphone's own limits — and a field that cannot be written
// truthfully stays empty on purpose, because the panel renders `Not written yet.` for it
// instead of an invented paragraph. A link that cannot be verified ships as an empty pair
// rather than a dead address. Both addresses are literals here and nowhere else: nothing
// derives an `href` at runtime (T-05-11). The clips are generated from primitives by
// tools/make_lesson_videos.py; no third-party media is embedded, and every external teaching
// link opens outside the app.
export const LESSONS = {
  scaleRun: {
    title: 'Scale run',
    why: 'A scale run trains the fretting hand to find every note of one shape on the click, and the fading lights make you do it from memory instead of from the board.',
    mistake: 'The app only advances when the pitch matches the step it is waiting for, so a note that sounds and leaves the target pulsing is a neighbouring note in the shape, not the one you were asked for.',
    practice: 'Without the app, play the shape up and back down once while naming each note aloud, then again with your eyes closed.',
    link: 'https://en.wikipedia.org/wiki/Pentatonic_scale',
    linkLabel: 'Pentatonic scale',
    demo: { src: './assets/videos/scale-run.mp4', poster: './assets/videos/scale-run.png', label: 'A minor pentatonic · Position 1' },
    // The Blues entry in the scale picker gets its own teaching surface: the minor pentatonic
    // frame plus the ♭5 that makes it blues. It is a full lesson variant, merged over the base
    // scale-run lesson by `openLesson`; the variant swaps the title, copy, one link, the two
    // watch/read links and the local demo, and adds no new top-level content table.
    blues: {
      title: 'Blues scale',
      why: 'The blues scale is the minor pentatonic plus one note: the ♭5. That tension note is what turns a safe pentatonic shape into a blues phrase, and the fading lights make you find it without the board.',
      mistake: 'The ♭5 is a passing tone, not a resting note. Land on it and hold it and the phrase sounds wrong; touch it between the 4 and the 5 and it sounds like blues.',
      practice: 'Without the app, play the minor pentatonic up and down, then add the ♭5 once between the 4 and the 5. Do it again, landing on the 5 instead of the ♭5.',
      link: 'https://www.justinguitar.com/guitar-lessons/introducing-the-blues-scale-bl-410',
      linkLabel: 'Introducing the blues scale',
      videos: [
        { label: 'Introducing the blues scale', href: 'https://www.justinguitar.com/guitar-lessons/introducing-the-blues-scale-bl-410', source: 'JustinGuitar', note: 'Where the ♭5 comes from and how it sits inside the pentatonic shape.' },
        { label: 'Adding the flat 5 to the pentatonic', href: 'https://www.youtube.com/watch?v=jlgq0yamjuY', embed: 'https://www.youtube-nocookie.com/embed/jlgq0yamjuY', source: 'YouTube · JustinGuitar', note: 'The one-note difference between the pentatonic and the blues scale.' },
      ],
      demo: { src: './assets/videos/blues-scale.mp4', poster: './assets/videos/blues-scale.png', label: 'A blues scale · the ♭5' },
    },
    videos: [
      { label: 'Minor Pentatonic Pattern 1', href: 'https://www.justinguitar.com/guitar-lessons/minor-pentatonic-pattern-1-bl-402', source: 'JustinGuitar', note: 'The shape, the fingering, and why it is the first scale most players learn.' },
      { label: 'Minor Pentatonic: the five positions', href: 'https://www.youtube.com/watch?v=ZHBomQaAvQo', embed: 'https://www.youtube-nocookie.com/embed/ZHBomQaAvQo', source: 'YouTube · JustinGuitar', note: 'See the same shape moved to the other four positions.' },
    ],
  },
  findNote: {
    title: 'Find the note',
    why: 'Finding the note trains the question you have to answer on the spot — where is this pitch on this string — until the neck stops being a map you count along.',
    mistake: 'Choosing an answer and revealing it are different outcomes: a revealed question is recorded as revealed, never as correct, so the score keeps showing it.',
    practice: 'Without the app, name the note under your index finger on each string in turn, then check yourself against the low E string.',
    link: 'https://www.musictheory.net/exercises/fretboard',
    linkLabel: 'Fretboard Note Identification',
    demo: { src: './assets/videos/fretboard-notes.mp4', poster: './assets/videos/fretboard-notes.png', label: 'Find the note · A string' },
    videos: [
      { label: 'The 5-Minute Fretboard Method', href: 'https://www.youtube.com/watch?v=S0FJI6O62PQ', embed: 'https://www.youtube-nocookie.com/embed/S0FJI6O62PQ', source: 'YouTube · JustinGuitar', note: 'A short daily method for turning the neck into a mental map.' },
      { label: 'How to hold your guitar', href: 'https://www.justinguitar.com/guitar-lessons/how-to-hold-your-guitar-b1-102', source: 'JustinGuitar', note: 'Posture first: thumb behind the neck, fingers arched, no tension.' },
    ],
  },
  chordChanges: {
    title: 'Chord changes',
    why: 'Chord changes train the fretting hand to arrive on the next shape before the bar turns over, which is the difference between a chord you can hold and a chord you can use.',
    mistake: 'The bar moves on the click, not when your fingers land, so a change that arrives after beat one is already a bar behind and the app counts it that way.',
    practice: 'Without the app, change between two shapes once every four beats while counting out loud, and stop the moment the count outruns your hand.',
    link: 'https://www.justinguitar.com/guitar-lessons/one-minute-changes-exercise-b1-110',
    linkLabel: 'One Minute Changes — then play the pair in time',
    demo: { src: './assets/videos/chord-change.mp4', poster: './assets/videos/chord-change.png', label: 'C → G · change on beat 1' },
    videos: [
      { label: 'How to read guitar chord boxes', href: 'https://www.justinguitar.com/guitar-lessons/how-to-read-guitar-chord-boxes-b1-104', source: 'JustinGuitar', note: 'The dots, the numbers and the X/O marks used in this lesson.' },
      { label: 'Fast chord changes on guitar', href: 'https://www.youtube.com/watch?v=9CsY2PRzt94', embed: 'https://www.youtube-nocookie.com/embed/9CsY2PRzt94', source: 'YouTube · JustinGuitar', note: 'Air changes and the practice loop that makes the move land on the click.' },
    ],
    // A second full lesson variant, reached from the Chords tab rather than the family row:
    // power chords are a concept and a movable shape, not a fourth chord-family row. The variant
    // keeps the same eight fields, so the lesson panel needs no second renderer.
    power: {
      title: 'Power chords',
      why: 'A power chord is a root, a fifth and usually the octave. It has no third, so it is neither major nor minor; that is why it survives distortion and works across rock, punk and metal.',
      mistake: 'Do not add a third or strum the thin strings. The shape lives on the low E, A and D strings; the other three are muted by the side of the fretting hand.',
      practice: 'Without the app, slide the root-6 shape from fret 3 to 5 to 7 while palm muting. Keep the shape two frets wide and let the root note name the chord.',
      link: 'https://www.justinguitar.com/guitar-lessons/power-chords-bg-1201',
      linkLabel: 'Power chords',
      videos: [
        { label: 'Power Chords', href: 'https://www.justinguitar.com/guitar-lessons/power-chords-bg-1201', source: 'JustinGuitar', note: 'The root 6 and root 5 shapes, muting and the move.' },
        { label: 'Power Chords 1', href: 'https://www.youtube.com/watch?v=trf80-R41X8', embed: 'https://www.youtube-nocookie.com/embed/trf80-R41X8', source: 'YouTube · JustinGuitar', note: 'A beginner walkthrough of the two-string shape.' },
      ],
      demo: { src: './assets/videos/power-chords.mp4', poster: './assets/videos/power-chords.png', label: 'G5 → A5 · the movable shape' },
    },
  },
  progression: {
    title: 'Progression',
    why: 'A progression trains you to hear where the next chord is going before the bar turns over, rather than reading it off the chart one bar late.',
    mistake: 'At the recall level the chart is gone, so the mistake the pass can show is losing the form: the bar counter is the only thing left telling you which chord the band is on.',
    practice: 'Without the app, hum the four chords of a progression you know and tap the bar line on your knee, then play it through once without looking at anything.',
    link: 'https://en.wikipedia.org/wiki/Chord_progression',
    linkLabel: 'Chord progression',
    demo: { src: './assets/videos/chord-change.mp4', poster: './assets/videos/chord-change.png', label: 'Chord changes · change on beat 1' },
    videos: [
      { label: 'Chord progressions theory for beginners', href: 'https://www.youtube.com/watch?v=mzrt48Kwlkg', embed: 'https://www.youtube-nocookie.com/embed/mzrt48Kwlkg', source: 'YouTube', note: 'Why I–IV–V and the other forms sound the way they do.' },
      { label: 'How to read guitar chord boxes', href: 'https://www.justinguitar.com/guitar-lessons/how-to-read-guitar-chord-boxes-b1-104', source: 'JustinGuitar', note: 'Read the shapes in the form before you try to change between them.' },
    ],
  },
  song: {
    title: 'Song',
    why: 'A song section trains you to keep time from the first bar to the last, which is a longer run than any exercise and the only one that ends on a musical ending instead of a count.',
    mistake: 'The pass counts every bar of the section from the chart, so a verse abandoned at the last chord records fewer bars than it planned and the summary says so.',
    practice: 'Without the app, play one verse of a song you already know and stop at the end of the verse rather than when you make a mistake.',
    link: 'https://en.wikipedia.org/wiki/Song_structure',
    linkLabel: 'Song structure',
    demo: { src: './assets/videos/strumming.mp4', poster: './assets/videos/strumming.png', label: 'D DU UDU · keep the strum steady' },
    videos: [
      { label: 'Get strumming and chord changes right', href: 'https://www.youtube.com/watch?v=7VzPzBsm4sU', embed: 'https://www.youtube-nocookie.com/embed/7VzPzBsm4sU', source: 'YouTube · JustinGuitar', note: 'Keep the strum steady while the fretting hand changes shape.' },
      { label: 'How to read guitar chord boxes', href: 'https://www.justinguitar.com/guitar-lessons/how-to-read-guitar-chord-boxes-b1-104', source: 'JustinGuitar', note: 'The shapes behind the section, one bar at a time.' },
    ],
  },
};
// Own-key only: `'constructor'`, `'__proto__'` and any family this table does not name answer
// null, so no inherited key can ever reach the panel (CR-02, T-05-11).
export const lessonFor = family => (typeof family === 'string' && Object.hasOwn(LESSONS, family)
  ? LESSONS[family] : null);
