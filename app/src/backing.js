// ---------- Generated backing patterns (tier 0, imports nothing) ----------
// A bar is one chord and the meter chooses the pattern, so the chart supplies the chord
// changes and this table never invents one. Every hit is expressed in beats from the bar
// line, which lets the transport's own beatToTime place it on the audio clock: nothing
// here knows a millisecond, a tempo or a node.
export const PATTERNS = {
  4: [
    { beat: 0, type: 'kick', accent: true },
    { beat: 2, type: 'kick' },
    { beat: 1, type: 'snare' },
    { beat: 3, type: 'snare' },
    { beat: 0.5, type: 'hat' }, { beat: 1.5, type: 'hat' },
    { beat: 2.5, type: 'hat' }, { beat: 3.5, type: 'hat' },
    { beat: 0, type: 'bass', durBeats: 2 },
    { beat: 2, type: 'bass', durBeats: 2 },
    { beat: 0, type: 'pad', durBeats: 4 },
  ],
  3: [
    { beat: 0, type: 'kick', accent: true },
    { beat: 1, type: 'snare' },
    { beat: 2, type: 'snare' },
    { beat: 0, type: 'hat' }, { beat: 1, type: 'hat' }, { beat: 2, type: 'hat' },
    { beat: 0, type: 'bass', durBeats: 3 },
    { beat: 0, type: 'pad', durBeats: 3 },
  ],
};

// A one-shot transient (kick, snare, hat, click) carries no `durBeats`; a sustained voice
// (bass, pad) carries the length it must hold, so the scheduler can stop it at the bar line.
// An unknown meter falls back to 4/4 rather than producing an empty bar.
export const patternFor = beatsPerBar => PATTERNS[beatsPerBar] || PATTERNS[4];

// The pass as chart data: `chords[bar] = { rootMidi, padMidis }` for every chart bar (never
// the ending bar). One flat, beat-stamped list in the exact shape the transport already
// dispatches; a muted stem keeps its events and the mix silences it, so a toggle mid-pass is
// instant. Three passes — count-in, one pattern bar per chart bar, then the ending bar — plus
// a final sort that is stable in V8, so equal beats keep the table's own voice order.
export function backingEvents({ beatsPerBar, countInBeats, bars = 0, chords = [] } = {}) {
  const bpb = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  // A count-in is one bar, so it can never be longer than the longest curated meter; the chart
  // derives it from `beatsPerBar`, and the bound is what keeps a crafted `1e9` from spinning a
  // billion iterations here (IN-02, T-04-01).
  const requestedCount = Number.isFinite(countInBeats) ? countInBeats : bpb;
  const count = Math.min(Math.max(0, requestedCount), 32);
  // A curated item is at most a sixteen-bar section with its repeats; the ceiling is what makes
  // the "no hostile chart floods the scheduler" claim a bound rather than an absence (IN-02).
  const barCount = Number.isInteger(bars) && bars > 0 ? Math.min(bars, 64) : 0;
  const pattern = patternFor(bpb);
  const events = [];

  // Pass 1, the count-in: one click per beat with only the first accented.
  for (let beat = 0; beat < count; beat++) events.push({ beat, type: 'click', accent: beat === 0 });

  // Pass 2, one pattern bar per chart bar. A bar whose chord has no pitch keeps its drums and
  // its clicks and loses the bass or the pad hit: a voice with no note must never be scheduled.
  for (let bar = 0; bar < barCount; bar++) {
    const base = count + bar * bpb;
    const chord = chords[bar] || {};
    for (let beat = 0; beat < bpb; beat++) {
      events.push({ beat: base + beat, type: 'click', accent: beat === 0 });
    }
    for (const hit of pattern) {
      const event = { beat: base + hit.beat, type: hit.type };
      if (hit.accent) event.accent = true;
      if (hit.durBeats) event.durBeats = hit.durBeats;
      if (hit.type === 'bass') {
        if (!Number.isFinite(chord.rootMidi)) continue;
        event.midi = chord.rootMidi;
      } else if (hit.type === 'pad') {
        if (!Array.isArray(chord.padMidis) || !chord.padMidis.length) continue;
        event.midis = chord.padMidis.slice();
      }
      events.push(event);
    }
  }

  // Pass 3, the ending bar: one accented kick holding the pass's last chord plus a full bar of
  // clicks, so the last bar counts down instead of hanging (A3). The sustained hits obey the
  // same no-pitch rule as pass 2.
  if (barCount) {
    const base = count + barCount * bpb;
    const last = chords[barCount - 1] || {};
    events.push({ beat: base, type: 'kick', accent: true });
    if (Number.isFinite(last.rootMidi)) {
      events.push({ beat: base, type: 'bass', midi: last.rootMidi, durBeats: bpb });
    }
    if (Array.isArray(last.padMidis) && last.padMidis.length) {
      events.push({ beat: base, type: 'pad', midis: last.padMidis.slice(), durBeats: bpb });
    }
    for (let beat = 0; beat < bpb; beat++) events.push({ beat: base + beat, type: 'click', accent: beat === 0 });
  }

  return events.sort((a, b) => a.beat - b.beat);
}
