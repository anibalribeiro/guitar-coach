// ---------- Quiz (tier 0: a deterministic question plan) ----------
// The caller passes the already-expanded pool and the label tables in, so the generator
// imports nothing and stays testable without the theory module. Nothing here calls
// Math.random: `rng` is injected so a seed fixes the chip order.
export const QUIZ_KINDS = ['note', 'degree', 'interval'];
export const QUIZ_MODES = ['find', 'name'];
export const QUESTION_COUNT = 12;
export const CHIP_COUNT = 4;

const MAX_FRET = 19;
const mod12 = n => ((n % 12) + 12) % 12;
const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)];

// A-34: naming an interval needs a reference note the T2 cannot state, so that pair does
// not exist. This is the single source of the Ask-for option list and of the clamp.
export function quizKindsFor(mode) {
  return mode === 'name' ? ['note', 'degree'] : QUIZ_KINDS.slice();
}

export function poolLabel({ keyName = '', scaleName = '', positionName = '' } = {}) {
  const where = !positionName || positionName === 'all' ? 'Whole neck' : positionName;
  return `${keyName} ${scaleName} · ${where}`.replace(/^\s+/, '');
}

function shuffle(values, rng) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

// Four fret candidates on the target string, the answer always among them. The list is
// sorted before the shuffle so a fixed seed reproduces the same chip row.
function fretValues(target, rng) {
  const values = [target.f];
  let guard = 0;
  while (values.length < CHIP_COUNT && guard++ < 200) {
    const f = 1 + Math.floor(rng() * MAX_FRET);
    if (!values.includes(f)) values.push(f);
  }
  for (let f = 1; values.length < CHIP_COUNT && f <= MAX_FRET; f++) {
    if (!values.includes(f)) values.push(f);
  }
  return values.sort((a, b) => a - b);
}

function noteValues(pool, target, names, rng) {
  const correct = names[mod12(target.midi)];
  const values = [correct];
  const spare = [];
  const add = name => {
    if (!name || values.includes(name) || spare.includes(name)) return;
    spare.push(name);
  };
  for (const n of pool) add(names[mod12(n.midi)]);
  for (let pc = 0; pc < 12; pc++) add(names[pc]);
  while (values.length < CHIP_COUNT && spare.length) {
    values.push(spare.splice(Math.floor(rng() * spare.length), 1)[0]);
  }
  return values;
}

function degreeValues(pool, target, degrees, rng) {
  const correct = degrees[target.iv];
  const values = [correct];
  const spare = [];
  const add = label => {
    if (!label || values.includes(label) || spare.includes(label)) return;
    spare.push(label);
  };
  for (const n of pool) add(degrees[n.iv]);
  for (const label of degrees) add(label);
  while (values.length < CHIP_COUNT && spare.length) {
    values.push(spare.splice(Math.floor(rng() * spare.length), 1)[0]);
  }
  return values;
}

function chipList(values, label) {
  return values.map(value => ({ value, label: label(value) }));
}

function makeQuestion(options) {
  const { index, target, pool, names, degrees, intervals, intervalNames, kind, mode, label, rng } = options;
  const noteName = names[mod12(target.midi)] || '';
  const degreeLabel = degrees[target.iv] || '';
  let intervalName = '';
  let rootName = '';
  if (kind === 'interval') {
    const rootFret = target.f - target.iv;
    if (rootFret < 1 || rootFret > MAX_FRET) return null;
    rootName = names[mod12(target.midi - target.iv)] || '';
    intervalName = intervalNames[target.iv] || intervals[target.iv] || '';
  }
  const frets = chipList(shuffle(fretValues(target, rng), rng), f => `Fret ${f}`);
  const nameValues = degreeValues(pool, target, degrees, rng);
  const noteValueList = noteValues(pool, target, names, rng);
  const chips = mode === 'find'
    ? frets
    : chipList(shuffle(kind === 'degree' ? nameValues : noteValueList, rng), value => value);
  const answerChip = mode === 'find' ? `Fret ${target.f}` : (kind === 'degree' ? degreeLabel : noteName);
  const question = {
    index,
    kind,
    mode,
    target: { s: target.s, f: target.f, midi: target.midi, iv: target.iv },
    chips,
    findChips: frets,
    answerChip,
    noteName,
    degreeLabel,
    intervalName,
    rootName,
    poolLabel: label || '',
    prompt: '',
  };
  question.prompt = promptText(question, mode);
  return question;
}

export function buildQuestions({
  pool = [], names = [], degrees = [], intervals = [], intervalNames = [],
  kind = 'note', mode = 'find', count = QUESTION_COUNT, label = '', rng = Math.random,
} = {}) {
  if (!Array.isArray(pool) || !pool.length) return [];
  if (kind === 'interval' && mode === 'name') return [];
  // A4: open strings cannot be lit and never ask, so they are not in the pool.
  const usable = pool.filter(n => n && n.f >= 1 && n.f <= MAX_FRET);
  if (!usable.length) return [];
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const target = pickFrom(usable, rng);
    if (!target) break;
    const key = target.s + ':' + target.f;
    if (used.has(key)) continue;
    used.add(key);
    const question = makeQuestion({
      index: out.length, target, pool: usable, names, degrees, intervals, intervalNames, kind, mode, label, rng,
    });
    if (question) out.push(question);
  }
  return out;
}

export function promptText(question, effectiveMode) {
  if (!question) return '';
  const mode = effectiveMode === 'name' || effectiveMode === 'find' ? effectiveMode : question.mode;
  const s = question.target.s;
  if (mode === 'name') {
    return question.kind === 'degree' ? 'Which degree is lit?' : 'Which note is lit?';
  }
  if (question.kind === 'degree') return `Find the ${question.degreeLabel} on string ${s}`;
  if (question.kind === 'interval') return `Find the ${question.intervalName} above ${question.rootName} on string ${s}`;
  return `Find ${question.noteName} on string ${s}`;
}

// A board tap or a detected pitch answers with { s, f }; a chip answers with { chip }.
// `effectiveMode` is the mode the pass is asking in, so the level-4 recall judges the
// fret chip the card actually shows.
export function judge(question, answer, effectiveMode) {
  if (!question || !answer) return false;
  const mode = effectiveMode === 'name' || effectiveMode === 'find' ? effectiveMode : question.mode;
  if (Object.hasOwn(answer, 'chip')) {
    if (mode === 'find') return Number(answer.chip) === question.target.f;
    return String(answer.chip) === String(question.answerChip);
  }
  return answer.s === question.target.s && answer.f === question.target.f;
}

// A-45: the recall pass asks in Find form, so "No lights" is literal and the mastery
// gate stays unaided.
export function questionMode(question, hintLevel) {
  if (!question) return 'find';
  return question.mode === 'name' && hintLevel === 3 ? 'find' : question.mode;
}

export function chipsFor(question, effectiveMode) {
  if (!question) return [];
  const mode = effectiveMode === 'name' || effectiveMode === 'find' ? effectiveMode : question.mode;
  return mode === 'find' ? question.findChips : question.chips;
}
