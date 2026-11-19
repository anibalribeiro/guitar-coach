// ---------- Fretboard (build once, diff render) ----------
// The board is a vertical neck, headstock up: 20 rows (open + frets 1-19) by 6 strings,
// low E in the left column and high E on the right, string names across the top and fret
// numbers down the left. The DOM is fret-major so reading and Tab order match what you see.
// Dots are cached by "s:f" and updated in place; a render never clears every cell. No
// imports: the view model supplies every label/state, and audition is an injected callback.
export const FRET_CELL = { open: 0, count: 20 };
export const STRING_NAMES = { 6: 'E', 5: 'A', 4: 'D', 3: 'G', 2: 'B', 1: 'E' };

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

// Low E is the left column, so ArrowLeft moves to the lower-pitched (higher-numbered) string
// and ArrowRight to the higher-pitched one; Up/Down walk toward the nut/body along a string.
export function nextCell(s, f, key) {
  switch (key) {
    case 'ArrowUp': return [s, Math.max(0, f - 1)];
    case 'ArrowDown': return [s, Math.min(19, f + 1)];
    case 'ArrowLeft': return [Math.min(6, s + 1), f];
    case 'ArrowRight': return [Math.max(1, s - 1), f];
    case 'Home': return [s, 0];
    case 'End': return [s, 19];
    default: return null;
  }
}

// The one cell label builder. Fret 0 has no LED on the T2, and the label says so.
export function cellLabel(s, f, text = '') {
  return `String ${s}, ${f === 0 ? 'open string, no LED' : 'fret ' + f}${text ? ', ' + text : ''}`;
}

export function createFretboard({ board, onAudition = null }) {
  const cells = {};
  const dots = new Map();
  let interactive = true;
  let lastTarget = null;
  let lastLowFret = null;
  let focusKey = '6:0';
  let labelsVisible = true;

  function build() {
    const corner = document.createElement('div');
    corner.className = 'num head';
    corner.setAttribute('aria-hidden', 'true');
    board.appendChild(corner);
    for (let s = 6; s >= 1; s--) {
      const h = document.createElement('div');
      h.className = 'num head';
      h.setAttribute('aria-hidden', 'true');
      h.textContent = STRING_NAMES[s];
      board.appendChild(h);
    }
    for (let f = 0; f <= 19; f++) {
      const n = document.createElement('div');
      const marked = [3,5,7,9,12,15,17,19].includes(f);
      n.className = 'num' + (marked ? ' mk' : '');
      n.setAttribute('aria-hidden', 'true');
      n.textContent = f === 0 ? '' : f;
      board.appendChild(n);
      for (let s = 6; s >= 1; s--) {
        const c = document.createElement('div');
        c.setAttribute('role', 'button');
        c.tabIndex = s === 6 && f === 0 ? 0 : -1;
        c.setAttribute('aria-label', cellLabel(s, f));
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
          // Alt/Ctrl/Cmd chords are browser and screen-reader shortcuts: never swallow them.
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const next = nextCell(s, f, event.key);
          if (next) {
            event.preventDefault();
            cells[next[0] + ':' + next[1]].focus();
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (interactive && onAudition) onAudition(s, f);
          }
        });
        board.appendChild(c);
        cells[s + ':' + f] = c;
      }
    }
  }

  // notes: [{ s, f, text, root, target, dim, open, muted }]. One dot per cell.
  function render(notes) {
    const next = new Set();
    let target = null;
    let low = null;
    for (const n of notes || []) {
      if (n.f === null || n.f === undefined) continue;
      // A muted × marker sits at f 0 but is not a played fret, so it never sets the low fret.
      if (Number.isInteger(n.f) && !n.muted && (!low || n.f < low.f)) low = n;
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
      const accessible = cellLabel(n.s, n.f, labelsVisible ? text : '');
      if (cells[key].getAttribute('aria-label') !== accessible) cells[key].setAttribute('aria-label', accessible);
      if (n.target) target = n;
    }
    for (const [key, dot] of dots) {
      if (next.has(key)) continue;
      dot.remove();
      dots.delete(key);
      const [s, f] = key.split(':').map(Number);
      cells[key].setAttribute('aria-label', cellLabel(s, f));
    }
    if (target && (!lastTarget || lastTarget.s !== target.s || lastTarget.f !== target.f)) {
      const cell = cells[target.s + ':' + target.f];
      const wrap = board.parentElement;
      if (cell && wrap && wrap.scrollTo) {
        // Scroll the neck box, never the page, and only when the target leaves the visible
        // band (one row of margin); CSS scroll-behavior decides smooth vs instant.
        const offset = cell.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
        const row = cell.getBoundingClientRect().height;
        // The neck is hidden (another view): leave lastTarget alone so a later render,
        // once the neck is visible again, still scrolls this target into view.
        if (!row) return;
        if (offset < row || offset > wrap.clientHeight - 2 * row) wrap.scrollTo({ top: wrap.scrollTop + offset - wrap.clientHeight / 2 });
      }
    }
    lastTarget = target;
    // Browse view and chord-following drills have no target: keep the shape's lowest fret one
    // row below the top of the box, or a position at fret 12 sits below a phone's 0-12 band.
    if (target || !low) { lastLowFret = null; return; }
    if (low.f !== lastLowFret) {
      const cell = cells[low.s + ':' + low.f];
      const wrap = board.parentElement;
      if (cell && wrap && wrap.scrollTo) {
        const offset = cell.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
        const row = cell.getBoundingClientRect().height;
        if (!row) return; // the neck is hidden (another view): retry on a later render
        const top = Math.max(0, wrap.scrollTop + offset - row);
        if (top !== wrap.scrollTop) wrap.scrollTo({ top: top });
      }
    }
    lastLowFret = low.f;
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
      const [s, f] = key.split(':').map(Number);
      const text = labelsVisible && dots.get(key) ? dots.get(key).textContent : '';
      const label = cellLabel(s, f, text);
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
