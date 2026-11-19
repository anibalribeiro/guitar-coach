// ---------- Fretboard (build once, diff render) ----------
// The board is a 6 x 20 grid (open + frets 1-19). Dots are cached by "s:f" and
// updated in place; a render never clears every cell. No imports: the view model
// supplies every label/state, and audition is an injected callback.
export const FRET_CELL = { open: 0, count: 20 };

const mod12 = n => ((n % 12) + 12) % 12;

export function labelFor(note, mode, names, degrees, intervals) {
  switch (mode) {
    case 'notes': return names[mod12(note.midi)];
    case 'degrees': return degrees[note.iv];
    case 'intervals': return intervals[note.iv];
    case 'fingers':
      // The view model supplies the finger number for the selected position box. An open
      // string is `0`, the convention every chord box already uses.
      return note.f === 0 ? '0' : (Number.isFinite(note.finger) && note.finger > 0 ? String(note.finger) : '');
    default: return '';
  }
}

// `question` is the screen stand-in for a lit question LED: a ring on the cell, never a
// note dot with a name, so the cue fade cannot remove it.
export function classNameFor(n) {
  return 'note'
    + (n.root ? ' root' : '')
    + (n.target ? ' target' : '')
    + (n.dim ? ' dim' : '')
    + (n.open ? ' open' : '')
    + (n.muted ? ' muted' : '')
    + (n.question ? ' question' : '');
}

export function createFretboard({ board, onAudition = null }) {
  const cells = {};
  const dots = new Map();
  let interactive = true;
  let lastTarget = null;
  let focusKey = '1:0';
  let labelsVisible = true;

  function build() {
    const widths = ['48px'];
    for (let f = 1; f <= 19; f++) widths.push(Math.round(74 * Math.pow(2, -(f - 1) / 24)) + 'px');
    board.style.gridTemplateColumns = widths.join(' ');
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= 19; f++) {
        const c = document.createElement('div');
        c.setAttribute('role', 'button');
        c.tabIndex = s === 1 && f === 0 ? 0 : -1;
        c.setAttribute('aria-label', `String ${s}, ${f === 0 ? 'open' : 'fret ' + f}`);
        c.className = 'cell' + (f === 0 ? ' open' : '');
        if ((s === 3 && [3,5,7,9,15,17,19].includes(f)) || ((s === 2 || s === 4) && f === 12)) c.classList.add('marker');
        c.style.setProperty('--thick', (0.8 + (s - 1) * 0.45).toFixed(2) + 'px');
        c.addEventListener('focus', () => {
          if (cells[focusKey]) cells[focusKey].tabIndex = -1;
          focusKey = s + ':' + f;
          c.tabIndex = 0;
        });
        c.addEventListener('click', () => { if (interactive && onAudition) onAudition(s, f); });
        c.addEventListener('keydown', event => {
          const movement = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
          if (movement) {
            event.preventDefault();
            const string = Math.max(1, Math.min(6, s + movement[0]));
            const fret = Math.max(0, Math.min(19, f + movement[1]));
            cells[string + ':' + fret].focus();
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (interactive && onAudition) onAudition(s, f);
          }
        });
        board.appendChild(c);
        cells[s + ':' + f] = c;
      }
    }
    for (let f = 0; f <= 19; f++) {
      const n = document.createElement('div');
      const marked = [3,5,7,9,12,15,17,19].includes(f);
      n.className = 'num' + (marked ? ' mk' : '');
      n.textContent = f === 0 ? '' : f;
      board.appendChild(n);
    }
  }

  // notes: [{ s, f, text, root, target, dim, open, muted }]. One dot per cell.
  function render(notes) {
    const next = new Set();
    let target = null;
    for (const n of notes || []) {
      if (n.f === null || n.f === undefined) continue;
      const key = n.s + ':' + n.f;
      next.add(key);
      let dot = dots.get(key);
      if (!dot) {
        dot = document.createElement('div');
        cells[key].appendChild(dot);
        dots.set(key, dot);
      }
      const cls = classNameFor(n);
      if (dot.className !== cls) dot.className = cls;
      const text = n.text === undefined || n.text === null ? '' : String(n.text);
      if (dot.textContent !== text) dot.textContent = text;
      const accessible = `String ${n.s}, ${n.f === 0 ? 'open' : 'fret ' + n.f}${text && labelsVisible ? ', ' + text : ''}`;
      if (cells[key].getAttribute('aria-label') !== accessible) cells[key].setAttribute('aria-label', accessible);
      if (n.target) target = n;
    }
    for (const [key, dot] of dots) {
      if (next.has(key)) continue;
      dot.remove();
      dots.delete(key);
      const [s, f] = key.split(':');
      cells[key].setAttribute('aria-label', `String ${s}, ${f === '0' ? 'open' : 'fret ' + f}`);
    }
    if (target && (!lastTarget || lastTarget.s !== target.s || lastTarget.f !== target.f)) {
      const cell = cells[target.s + ':' + target.f];
      const wrap = board.parentElement;
      if (cell && wrap && wrap.scrollTo) {
        const offset = cell.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
        wrap.scrollTo({ left: wrap.scrollLeft + offset - wrap.clientWidth / 2 });
      }
    }
    lastTarget = target;
  }

  function flashHit(note) {
    const dot = dots.get(note.s + ':' + note.f);
    if (!dot) return;
    dot.classList.add('hit');
    setTimeout(() => dot.classList.remove('hit'), 250);
  }

  function setLabelsVisible(on) {
    labelsVisible = !!on;
    for (const [key, cell] of Object.entries(cells)) {
      const [s, f] = key.split(':');
      const text = labelsVisible && dots.get(key) ? dots.get(key).textContent : '';
      const label = `String ${s}, ${f === '0' ? 'open' : 'fret ' + f}${text ? ', ' + text : ''}`;
      if (cell.getAttribute('aria-label') !== label) cell.setAttribute('aria-label', label);
    }
  }

  function setInteractive(on) {
    interactive = !!on;
    board.classList.toggle('disabled', !interactive);
    board.setAttribute('aria-disabled', interactive ? 'false' : 'true');
    for (const cell of Object.values(cells)) cell.setAttribute('aria-disabled', interactive ? 'false' : 'true');
  }

  build();
  return { cells, render, flashHit, setInteractive, setLabelsVisible };
}
