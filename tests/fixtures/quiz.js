// Frozen quiz fixture: a six-string pool at frets 0, 1, 3, 5, 7 and 8 in A minor
// pentatonic, the four label tables the generator is injected with, and a seeded LCG so
// the chip order is reproducible.
export const OPEN = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
export const KEY_PC = 9;
export const FRETS = [0, 1, 3, 5, 7, 8];

export const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
export const INTERVALS = ['R', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];
export const INTERVAL_NAMES = [
  'Root', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th',
  'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th',
];

const mod12 = n => ((n % 12) + 12) % 12;

export const POOL = Object.freeze(
  [6, 5, 4, 3, 2, 1].flatMap(s => FRETS.map(f => {
    const midi = OPEN[s] + f;
    return Object.freeze({ s, f, midi, iv: mod12(midi - KEY_PC) });
  })),
);

export function seededRng(seed = 12345) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
