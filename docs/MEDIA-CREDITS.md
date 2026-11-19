# Media credits

## Real reference media

### Hand-playing video

- **File:** `app/assets/videos/real-hand.mp4` (poster `real-hand.png`)
- **Title:** Close-Up of Hand Playing Acoustic Guitar
- **Creator:** Alejandro JV
- **Source:** https://www.pexels.com/video/close-up-of-hand-playing-acoustic-guitar-37439617/
- **License:** Pexels License, https://www.pexels.com/license/
- **Modifications:** trimmed to six seconds, cropped/resized to 720 × 405, audio track removed, H.264 compressed.

### Fretboard/hand photo

- **File:** `app/assets/videos/real-fretboard.jpg`
- **Title:** Person Playing Brown Electric Guitar
- **Creator:** cottonbro studio
- **Source:** https://www.pexels.com/photo/person-playing-brown-electric-guitar-4090159/
- **License:** Pexels License, https://www.pexels.com/license/
- **Modifications:** cropped to 3:2 and resized to 900 × 600.

The Pexels License permits free use and modification; credit is not required but is recorded here.

### Local lesson-link thumbnail

- **File:** `app/assets/videos/justinguitar-five-positions.jpg` (`docs/mockups/assets/justinguitar-five-positions.jpg` is the design copy)
- **Title:** Minor pentatonic: five positions — JustinGuitar lesson thumbnail
- **Source:** https://www.youtube.com/watch?v=ZHBomQaAvQo
- **Status:** legacy reference artifact, no longer displayed or pre-cached by the app, and **not included in the public repository** (gitignored). The live resource card uses an original text mark; public availability is not treated as a rehosting license. The design mockups in `docs/mockups/` that referenced it will show a missing image.

## Generated lesson clips

`scale-run`, `blues-scale`, `chord-change`, `power-chords`, `fretboard-notes` and `strumming`
are generated from primitives by `tools/make_lesson_videos.py`. They contain no third-party
footage, audio or fonts beyond the system Arial used at render time.

## External teaching links

The JustinGuitar, Wikipedia and MusicTheory.net destinations are external links only.
YouTube cards can load YouTube's official `youtube-nocookie.com` embed on demand; that stream is
served by YouTube under its terms, is not downloaded into this repository, and needs a network.
The rest of the app remains offline once the shell and local clips are cached.
