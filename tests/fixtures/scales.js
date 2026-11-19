// Prototype scale definitions (app/index.html at the baseline commit), kept in the
// [id, name, intervals, base?] tuple shape so characterization tests exercise the
// same data the hardware-validated build used.
export const MAJOR = [0,2,4,5,7,9,11];
export const MINOR = [0,2,3,5,7,8,10];
export const MIN_PENT = [0,3,5,7,10];
export const MAJ_PENT = [0,2,4,7,9];
export const BLUES = [0,3,5,6,7,10];
export const CHROMATIC = [0,1,2,3,4,5,6,7,8,9,10,11];

export const PROTOTYPE_SCALES = [
  ['major', 'Major', MAJOR],
  ['minor', 'Natural minor', MINOR],
  ['harmMinor', 'Harmonic minor', [0,2,3,5,7,8,11]],
  ['melMinor', 'Melodic minor', [0,2,3,5,7,9,11]],
  ['majPent', 'Major pentatonic', MAJ_PENT],
  ['minPent', 'Minor pentatonic', MIN_PENT],
  ['blues', 'Blues', BLUES, MIN_PENT],
  ['chromatic', 'Chromatic', CHROMATIC],
  ['dorian', 'Dorian', [0,2,3,5,7,9,10]],
  ['phrygian', 'Phrygian', [0,1,3,5,7,8,10]],
  ['lydian', 'Lydian', [0,2,4,6,7,9,11]],
  ['mixolydian', 'Mixolydian', [0,2,4,5,7,9,10]],
  ['locrian', 'Locrian', [0,1,3,5,6,8,10]],
  ['majTriad', 'Major triad', [0,4,7], MAJOR],
  ['minTriad', 'Minor triad', [0,3,7], MINOR],
  ['dom7', 'Dominant 7', [0,4,7,10], [0,2,4,5,7,9,10]],
  ['maj7', 'Major 7', [0,4,7,11], MAJOR],
  ['min7', 'Minor 7', [0,3,7,10], MINOR],
  ['m7b5', 'Half-diminished (m7♭5)', [0,3,6,10], [0,1,3,5,6,8,10]],
];

const BY_ID = new Map(PROTOTYPE_SCALES.map(([id, name, ivs, base]) => [id, { id, name, ivs, base: base || ivs }]));

export function prototypeScale(id) {
  const scale = BY_ID.get(id);
  if (!scale) throw new Error(`Unknown prototype scale: ${id}`);
  return scale;
}
