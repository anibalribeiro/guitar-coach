# Code review — Field Book UI, path/media wiring, theme toggle

**Date:** 2026-11-10  
**Scope:** working-tree changes to `app/index.html`, `app/src/main.js`, `app/src/panels.js`, `app/src/settings.js`, `app/sw.js`, `tests/static.test.js`, `tests/settings.test.js`, `tests/progress.test.js`, plus the supporting docs/assets.  
**Run:** `node --test` → **723 pass, 0 fail** (after the fixes below).

## Verdict

The feature work is coherent and well-tested at the static/unit level. The main risk was **release integrity around the service worker**. That risk is now resolved in the working tree; see “Resolution” below.

## Resolution (post-review)

All findings are addressed in the working tree:

- **Critical — stale shell:** navigation and shell scripts are now network-first with cache fallback; media remains cache-first. The worker installs the shell atomically and treats media as best-effort, so one missing video cannot block a shell update. Cache bumped to `t2coach-v22` (`app/sw.js`).
- **High — mixed-version boot:** the new DOM lookups are guarded, and boot is wrapped in a catch that writes the actual error into `#bootErrorDetail` (`app/src/main.js`, `app/src/panels.js`).
- **High — no recovery:** `app/bootstrap.js` loads before CSS, applies the stored theme to avoid a flash, and wires a non-destructive **Clear cache & reload** action on the boot-error screen. It unregisters workers and clears Cache Storage without touching `localStorage`.
- **Medium — focus and ARIA:** new lesson openers expose `aria-controls`/`aria-expanded`; closing returns focus to the actual opener; the path session control exposes its panel relationship (`app/index.html`, `app/src/panels.js`).
- **Medium — Today card:** `pathTodayTotal` and `pathTodaySub` are painted from the real session plan (`app/src/panels.js`).
- **Low — theme flash:** the synchronous boot shim applies the stored theme before the stylesheet.
- **Low — dark palette drift:** dark values are declared once as `--dark-*` tokens and mapped by both selectors.
- **Low — path labels duplicated:** the path list is generated from the single `PATH_STEPS` table; the HTML list is an empty host.

New coverage was added for the boot shim/recovery, network-first worker, opener focus/ARIA, and session-driven Today card. Manual browser checks: cached-browser reload with new scripts, path focus return, theme persistence, and v22 boot all pass.

## Findings

### 1. Critical — cache-first navigation can pin the app to a stale shell

**Files:** `app/sw.js:71-74`, `app/sw.js:78-89`

Every navigation returns the cached `index.html` before trying the network. Module and media requests are also cache-first. Because `index.html`, `main.js`, `panels.js`, etc. share unversioned URLs, a cache update or a partially updated browser can pair an old shell with new modules (or vice versa). The result is an exception during boot, and the static error screen stays visible.

This matches the observed evidence: the server returns 200, a fresh profile loads the app, while the existing tab fails until its service worker/cache is removed.

**Fix:** make navigation network-first with cache fallback:

```js
if (request.mode === 'navigate') {
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
        return response;
      })
      .catch(() => caches.match('./index.html')),
  );
  return;
}
```

Do the same for shell JS/CSS (or version module URLs with a build id). Keep cache-first only for immutable media. Add a cache/version test that proves a new `index.html` is fetched while online.

### 2. High — new DOM references are unguarded, so a mixed shell crashes boot

**Files:** `app/src/panels.js:1562-1563`, `1550-1560`; `app/src/panels.js:2066-2068`; `app/src/panels.js:3742`, `3823-3825`; `app/index.html:1065-1166`

The new modules assume every new element exists:

- `updateWorkspace()` writes `workspaceTitle` and `workspaceSub` unconditionally.
- `setDrillState()` reads `pathSession`, `workspaceWatch`, `pathMaterials` unconditionally.
- `wire()` attaches to `theme`, `pathSession`, `workspaceWatch`, and `pathMaterials` unconditionally.
- `render()` guards `theme`, but the wire path does not, which is inconsistent.

An old cached `index.html` + new `panels.js` therefore throws during boot, exactly producing the static error screen. Guarding these references is a cheap defensive improvement, but the real fix is atomic versioned assets from Finding 1.

### 3. High — boot failure has no diagnostics and no recovery action

**Files:** `app/src/main.js:3443-3448`, `3609`; `app/index.html` boot-error block

`boot()` catches only settings-store creation. Any later error (panel wiring, rendering, a missing new element) propagates out of `boot()` and leaves the static “could not load” screen. The screen says only “Check that all app files were served,” which is wrong when the files are present and the cache is stale. Its only action is a normal reload, which the cache-first worker can turn into a loop.

**Fix:**

- Wrap the whole boot call in `try/catch`, log the actual error, and display a short error code/message in the boot-error block.
- Add a **Clear cache & reload** action that unregisters service workers and deletes Cache Storage but preserves `localStorage` (progress).
- Keep the simple reload as a secondary action.

### 4. Medium — new lesson entry points break focus return and drawer ARIA

**Files:** `app/src/panels.js:2547-2558`; `app/index.html:1102-1106`, `1159-1167`; `app/src/panels.js:3823-3825`

`workspaceWatch`, `pathMaterials`, and path-step lessons all open `#lessonPanel`, but:

- They do not expose `aria-controls="lessonPanel"` or `aria-expanded`.
- `setLessonOpen(false)` always returns focus to `#familyLearn`, even when the panel was opened from the path rail or the media card. Keyboard users are sent to a different control below the board.

Track the opener (for example, pass a return-focus element into `openLesson`) and update the new buttons’ `aria-expanded`/`aria-controls` alongside `familyLearn`.

### 5. Medium — “Today 13 min” is a hard-coded path-rail value

**File:** `app/index.html:1083-1087`; `app/src/panels.js:3823`

The session card is static. The actual Session panel is built from `session.js` and can show a different plan/summary after history or a completed block. The path rail can therefore contradict the panel it opens.

**Fix:** project the real session total/block count into the path card (the session view already computes them), or label it as “Curated session” with no numbers until the plan is loaded.

### 6. Low — theme is applied after the first paint

**Files:** `app/src/main.js:3449-3451`; `app/index.html:9-75`

`applyTheme(settings.theme)` runs after the store loads and before `appShell` is revealed, which is good, but the body and boot-error screen have already painted using the OS preference. An explicit Dark choice on a light OS (or Light on a dark OS) can flash. This is cosmetic; a later boot-error recovery/early theme bootstrap would remove it.

### 7. Low — duplicated dark token blocks can drift

**File:** `app/index.html:42-75`

The dark palette is duplicated for the explicit `data-theme="dark"` selector and the system media query. A future color change must update both. Acceptable, but worth a comment/test if the palette grows. The current static test only counts `--danger-text` occurrences.

### 8. Low — path labels/actions are duplicated in HTML and JS

**Files:** `app/index.html:1072-1078`; `app/src/panels.js:1505-1532`; `app/src/main.js:2085-2112`

The six labels, numbers and actions are encoded in the markup, the path-active map and the path router. Adding a seventh step requires three edits. A single path definition would avoid drift, but this is a future maintainability concern rather than a bug.

## Test gaps

- No test of the service-worker navigation/update strategy or a stale-shell/new-module combination.
- No runtime test of `applyTheme` (the static test only checks the markup/wiring); the Light override was verified manually.
- No test of the actual state changes behind each path step, or of the path’s active step after those changes.
- No accessibility test for focus return from the new media/path lesson openers.
- No automated test for the path card’s session numbers versus the Session panel.
- Responsive overflow was checked manually at 390/1024/1280/1660; there is no automated layout/viewport test.

## What looks good

- `theme` is an additive, validated settings field; old records migrate to `system`, and export/import coverage was updated.
- Explicit Light correctly beats a dark OS in the browser test; Dark and System persist across reload.
- The two-column layout and mobile/tablet path layout render cleanly at the widths checked.
- Real media is local (`real-fretboard.jpg`, `justinguitar-five-positions.jpg`), CSP remains default-deny, and the service worker caches no remote addresses.
- The new assets are credited and the offline cache is versioned (`v20`).
- All 719 tests pass.

## Immediate recovery for the reported boot error

In the app tab’s DevTools console (preserves progress):

```js
navigator.serviceWorker.getRegistrations()
  .then(rs => Promise.all(rs.map(r => r.unregister())))
  .then(() => caches.keys())
  .then(ks => Promise.all(ks.map(k => caches.delete(k))))
  .then(() => location.reload())
```
