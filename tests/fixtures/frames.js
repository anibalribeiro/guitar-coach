// Golden LED frames captured from the hardware-validated prototype (L1-L14).
// Expected hex is the PROTOCOL.md codec output, verified in Node 24.21.0.
export const ZERO_FRAME = 'f1 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';
export const PROTOCOL_MARKER = 'f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00';

export const PROTOCOL_MARKER_NOTES = [
  { s: 5, f: 12 },
  { s: 4, f: 3 }, { s: 4, f: 5 }, { s: 4, f: 7 }, { s: 4, f: 9 }, { s: 4, f: 15 }, { s: 4, f: 17 },
  { s: 3, f: 3 }, { s: 3, f: 5 }, { s: 3, f: 7 }, { s: 3, f: 9 }, { s: 3, f: 15 }, { s: 3, f: 17 },
  { s: 2, f: 12 },
];

// L14: duplicate and order-shuffled input must produce the same OR-ed frame.
export const SHUFFLED_MARKER_NOTES = [
  ...PROTOCOL_MARKER_NOTES.slice().reverse(),
  ...PROTOCOL_MARKER_NOTES.slice(0, 3),
];

export const LED_FRAME_CASES = [
  { id: 'L1', name: 'clear frame', notes: [], hex: ZERO_FRAME },
  { id: 'L2', name: 'first fret, MSB', notes: [{ s: 6, f: 1 }], hex: 'f1 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L3', name: 'last bit of group 1', notes: [{ s: 6, f: 7 }], hex: 'f1 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L4', name: 'group boundary', notes: [{ s: 6, f: 8 }], hex: 'f1 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L5', name: 'next group', notes: [{ s: 6, f: 9 }], hex: 'f1 00 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L6', name: 'group 2 boundary', notes: [{ s: 6, f: 16 }], hex: 'f1 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L7', name: 'group 3 start', notes: [{ s: 6, f: 17 }], hex: 'f1 00 00 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L8', name: "T2's last usable fret", notes: [{ s: 6, f: 19 }], hex: 'f1 00 00 20 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L9', name: "protocol's last fret", notes: [{ s: 6, f: 24 }], hex: 'f1 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00' },
  { id: 'L10', name: 'fret above 24 skipped', notes: [{ s: 6, f: 25 }], hex: ZERO_FRAME },
  { id: 'L11', name: 'open string skipped', notes: [{ s: 6, f: 0 }], hex: ZERO_FRAME },
  { id: 'L12', name: 'string block 1 last byte', notes: [{ s: 1, f: 19 }], hex: 'f1 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20' },
  { id: 'L13', name: 'PROTOCOL.md marker frame', notes: PROTOCOL_MARKER_NOTES, hex: PROTOCOL_MARKER },
  { id: 'L14', name: 'duplicate and shuffled notes', notes: SHUFFLED_MARKER_NOTES, hex: PROTOCOL_MARKER },
];
