#!/usr/bin/env python3
"""Generate the six silent lesson clips in app/assets/videos.

Everything is drawn from primitives here: no stock footage, no external media and no
audio track. Run with the Pillow package available, then ffmpeg on PATH:

    python3 tools/make_lesson_videos.py

The app ships the MP4 and its poster PNG. Re-running overwrites both.
"""
from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H, FPS, SECONDS = 720, 480, 24, 8
FRAMES = FPS * SECONDS
OUT = Path(__file__).resolve().parent.parent / "app" / "assets" / "videos"

BG = (244, 241, 236)
PANEL = (255, 255, 255)
TEXT = (31, 29, 26)
MUTED = (109, 103, 95)
BORDER = (221, 214, 204)
ACCENT = (194, 65, 12)
ACCENT_TEXT = (255, 255, 255)
NOTE = (47, 43, 39)
NOTE_TEXT = (255, 255, 255)
WOOD = (59, 42, 30)
FRET = (185, 180, 171)
STRING = (216, 210, 196)
OK = (35, 122, 53)
WHITE = (255, 255, 255)

FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


F_TITLE = font(34, True)
F_SUB = font(16)
F_LABEL = font(11, True)
F_SMALL = font(11)
F_NOTE = font(12, True)
F_TINY = font(9, True)
F_BIG = font(22, True)


def text(draw: ImageDraw.ImageDraw, xy, value, f, fill=TEXT, anchor=None):
    draw.text(xy, value, font=f, fill=fill, anchor=anchor)


def base(draw, title, subtitle):
    draw.rectangle([0, 0, W, H], fill=BG)
    text(draw, (40, 26), "T2 COACH  ·  VISUAL DEMO", F_LABEL, MUTED)
    text(draw, (40, 46), title, F_TITLE, TEXT)
    text(draw, (40, 92), subtitle, F_SUB, MUTED)
    text(draw, (40, H - 30), "Practice this in Guitar Coach  ·  no audio", F_SMALL, MUTED)


def progress(draw, value):
    x, y, w = 40, H - 12, W - 80
    draw.rounded_rectangle([x, y, x + w, y + 4], radius=2, fill=BORDER)
    if value > 0:
        draw.rounded_rectangle([x, y, x + max(4, int(w * value)), y + 4], radius=2, fill=ACCENT)


# ---------- Scale run ----------
SCALE_NOTES = [
    (6, 5, "A", 1, True), (6, 8, "C", 4, False),
    (5, 5, "D", 1, False), (5, 7, "E", 3, False),
    (4, 5, "G", 1, False), (4, 7, "A", 3, True),
    (3, 5, "C", 1, False), (3, 7, "D", 3, False),
    (2, 5, "E", 1, False), (2, 8, "G", 4, False),
    (1, 5, "A", 1, True), (1, 8, "C", 4, False),
]
SCALE_ORDER = sorted(SCALE_NOTES, key=lambda n: (-n[0], n[1]))
SCALE_STEPS = SCALE_ORDER + SCALE_ORDER[-2:0:-1]


def frame_scale(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "A minor pentatonic", "Position 1  ·  follow the shape up, then back down")
    board = (40, 128, W - 40, 420)
    draw.rounded_rectangle(board, radius=12, fill=WOOD)
    inner_x, inner_w = 68, board[2] - 68 - 16
    start_fret, frets = 4, 6
    row_h = 42
    top = board[1] + 18
    cell_w = inner_w / frets
    for s in range(1, 7):
        y = top + (s - 1) * row_h + row_h / 2
        draw.line([(inner_x, y), (inner_x + inner_w, y)], fill=STRING, width=1)
        text(draw, (44, y), "E B G D A E"[2 * (s - 1):2 * (s - 1) + 1], F_TINY, (207, 198, 184), "mm")
    for f in range(frets + 1):
        x = inner_x + f * cell_w
        draw.line([(x, top), (x, top + 6 * row_h)], fill=FRET, width=2)
    for f in range(frets):
        text(draw, (inner_x + f * cell_w + cell_w / 2, board[3] - 14), str(start_fret + f), F_TINY, (207, 198, 184), "mm")
    elapsed = max(0.0, t - 0.9)
    step = min(len(SCALE_STEPS) - 1, int(elapsed / 0.27))
    active = SCALE_STEPS[step]
    for s, f, name, finger, root in SCALE_NOTES:
        if f < start_fret or f >= start_fret + frets:
            continue
        x = inner_x + (f - start_fret + 0.5) * cell_w
        y = top + (s - 1) * row_h + row_h / 2
        is_active = (s, f) == active[:2]
        radius = 17
        if is_active:
            draw.ellipse([x - radius - 5, y - radius - 5, x + radius + 5, y + radius + 5], outline=WHITE, width=3)
        fill = ACCENT if root else NOTE
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=fill)
        text(draw, (x - 2, y - 1), name, F_NOTE, ACCENT_TEXT if root else NOTE_TEXT, "mm")
        bx, by = x + 10, y + 10
        draw.ellipse([bx - 7, by - 7, bx + 7, by + 7], fill=PANEL, outline=BORDER)
        text(draw, (bx, by + 0.5), str(finger), F_TINY, TEXT, "mm")
    text(draw, (40, 112), f"Note {step + 1} of {len(SCALE_STEPS)}  ·  one finger per fret", F_SMALL, MUTED)
    progress(draw, (step + 1) / len(SCALE_STEPS))
    return image


# ---------- Blues scale ----------
BLUES_NOTES = [
    (6, 5, "A", 1, True, False), (6, 8, "C", 4, False, False),
    (5, 5, "D", 1, False, False), (5, 6, "D#", 2, False, True), (5, 7, "E", 3, False, False),
    (4, 5, "G", 1, False, False), (4, 7, "A", 3, True, False),
    (3, 5, "C", 1, False, False), (3, 7, "D", 3, False, False), (3, 8, "D#", 4, False, True),
    (2, 5, "E", 1, False, False), (2, 8, "G", 4, False, False),
    (1, 5, "A", 1, True, False), (1, 8, "C", 4, False, False),
]
BLUES_ORDER = sorted(BLUES_NOTES, key=lambda n: (-n[0], n[1]))
BLUES_STEPS = BLUES_ORDER + BLUES_ORDER[-2:0:-1]


def frame_blues(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "A blues scale", "The flat 5 is the ringed note  ·  position 1")
    board = (40, 128, W - 40, 420)
    draw.rounded_rectangle(board, radius=12, fill=WOOD)
    inner_x, inner_w = 68, board[2] - 68 - 16
    start_fret, frets = 4, 6
    row_h = 42
    top = board[1] + 18
    cell_w = inner_w / frets
    for s in range(1, 7):
        y = top + (s - 1) * row_h + row_h / 2
        draw.line([(inner_x, y), (inner_x + inner_w, y)], fill=STRING, width=1)
        text(draw, (44, y), "E B G D A E"[2 * (s - 1):2 * (s - 1) + 1], F_TINY, (207, 198, 184), "mm")
    for f in range(frets + 1):
        x = inner_x + f * cell_w
        draw.line([(x, top), (x, top + 6 * row_h)], fill=FRET, width=2)
    for f in range(frets):
        text(draw, (inner_x + f * cell_w + cell_w / 2, board[3] - 14), str(start_fret + f), F_TINY, (207, 198, 184), "mm")
    elapsed = max(0.0, t - 0.9)
    step = min(len(BLUES_STEPS) - 1, int(elapsed / 0.25))
    active = BLUES_STEPS[step]
    for s, f, name, finger, root, blue in BLUES_NOTES:
        if f < start_fret or f >= start_fret + frets:
            continue
        x = inner_x + (f - start_fret + 0.5) * cell_w
        y = top + (s - 1) * row_h + row_h / 2
        if (s, f) == active[:2]:
            draw.ellipse([x - 22, y - 22, x + 22, y + 22], outline=WHITE, width=3)
        if blue:
            draw.ellipse([x - 18, y - 18, x + 18, y + 18], fill=PANEL, outline=ACCENT, width=2)
            text(draw, (x, y + 1), name, F_TINY, TEXT, "mm")
        else:
            fill = ACCENT if root else NOTE
            draw.ellipse([x - 17, y - 17, x + 17, y + 17], fill=fill)
            text(draw, (x - 2, y - 1), name, F_NOTE, ACCENT_TEXT if root else NOTE_TEXT, "mm")
        bx, by = x + 10, y + 10
        draw.ellipse([bx - 7, by - 7, bx + 7, by + 7], fill=PANEL, outline=BORDER)
        text(draw, (bx, by + 0.5), str(finger), F_TINY, TEXT, "mm")
    text(draw, (40, 112), f"Note {step + 1} of {len(BLUES_STEPS)}  ·  the flat 5 is one extra note", F_SMALL, MUTED)
    progress(draw, (step + 1) / len(BLUES_STEPS))
    return image


# ---------- Chord change ----------
CHORDS = {
    "C": {
        "frets": [None, 3, 2, 0, 1, 0],
        "fingers": [None, 3, 2, None, 1, None],
        "root": 5,
    },
    "G": {
        "frets": [3, 2, 0, 0, 0, 3],
        "fingers": [2, 1, None, None, None, 3],
        "root": 6,
    },
    "G5": {
        "frets": [3, 5, 5, None, None, None],
        "fingers": [1, 3, 4, None, None, None],
        "root": 6,
        "baseFret": 3,
    },
    "A5": {
        "frets": [5, 7, 7, None, None, None],
        "fingers": [1, 3, 4, None, None, None],
        "root": 6,
        "baseFret": 5,
    },
}


def draw_chord(draw, name, x, y, active):
    data = CHORDS[name]
    base = data.get("baseFret", 0)
    w, h = 230, 235
    if active:
        draw.rounded_rectangle([x - 10, y - 10, x + w + 10, y + h + 10], radius=12, outline=ACCENT, width=3, fill=PANEL)
    else:
        draw.rounded_rectangle([x - 10, y - 10, x + w + 10, y + h + 10], radius=12, outline=BORDER, width=1, fill=PANEL)
    text(draw, (x + w / 2, y + 8), name, F_BIG, TEXT if active else MUTED, "ma")
    strings = 6
    gap = 26
    left = x + 38
    top = y + 54
    fret_gap = 27
    nut_y = top
    draw.line([(left, nut_y), (left + gap * (strings - 1), nut_y)], fill=TEXT, width=3)
    for i in range(strings):
        sx = left + i * gap
        draw.line([(sx, nut_y), (sx, nut_y + fret_gap * 5)], fill=BORDER, width=1)
        f = data["frets"][i]
        if f is None:
            text(draw, (sx, nut_y - 12), "×", F_TINY, MUTED, "mm")
        elif f == 0 and base == 0:
            draw.ellipse([sx - 4, nut_y - 16, sx + 4, nut_y - 8], outline=MUTED, width=1)
        else:
            offset = f - base if base > 0 else f - 1
            if 0 <= offset < 5:
                cy = nut_y + (offset + 0.5) * fret_gap
                root = i == 6 - data["root"]
                draw.ellipse([sx - 8, cy - 8, sx + 8, cy + 8], fill=ACCENT if root else NOTE)
                text(draw, (sx, cy + 0.5), str(data["fingers"][i] or ""), F_TINY, ACCENT_TEXT if root else NOTE_TEXT, "mm")
    for fret in range(1, 6):
        yy = nut_y + fret * fret_gap
        draw.line([(left, yy), (left + gap * (strings - 1), yy)], fill=BORDER, width=1)
    text(draw, (x + w / 2, y + h - 12), f"{base}fr" if base > 0 else "open", F_TINY, MUTED, "md")


def frame_chords(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "C  →  G", "Change on beat 1  ·  move all fingers together")
    first = t < 4.0
    name = "C" if first else "G"
    draw_chord(draw, "C", 112, 145, first)
    draw_chord(draw, "G", 382, 145, not first)
    beat = int(t) % 4
    text(draw, (W / 2, 402), f"{name}  ·  beat {beat + 1} of 4", F_SUB, TEXT, "ma")
    for i in range(4):
        cx = W / 2 - 45 + i * 30
        fill = ACCENT if i == beat else BORDER
        draw.ellipse([cx - 6, 420 - 6, cx + 6, 420 + 6], fill=fill)
    progress(draw, t / SECONDS)
    return image


def frame_power(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "Power chords", "Root + fifth + octave  ·  no third")
    first = t < 4.0
    draw_chord(draw, "G5", 112, 145, first)
    draw_chord(draw, "A5", 382, 145, not first)
    text(draw, (W / 2, 402), "Root 6 shape  ·  slide it and the root names the chord", F_SUB, TEXT, "ma")
    text(draw, (W / 2, 430), "Mute the thin strings; no third means neither major nor minor.", F_SMALL, MUTED, "ma")
    progress(draw, t / SECONDS)
    return image


# ---------- Fretboard notes ----------
A_STRING = ["A", "A♯", "B", "C", "C♯", "D"]


def frame_notes(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "Find the note", "A string  ·  every fret is one half step")
    board = (40, 132, W - 40, 392)
    draw.rounded_rectangle(board, radius=12, fill=WOOD)
    inner_x, inner_w = 68, board[2] - 68 - 16
    frets = 6
    row_h = 38
    top = board[1] + 12
    cell_w = inner_w / frets
    for s in range(1, 7):
        y = top + (s - 1) * row_h + row_h / 2
        draw.line([(inner_x, y), (inner_x + inner_w, y)], fill=STRING, width=1)
        text(draw, (44, y), "E B G D A E"[2 * (s - 1):2 * (s - 1) + 1], F_TINY, (207, 198, 184), "mm")
    for f in range(frets + 1):
        x = inner_x + f * cell_w
        draw.line([(x, top), (x, top + 6 * row_h)], fill=FRET, width=2)
    for f in range(frets):
        text(draw, (inner_x + f * cell_w + cell_w / 2, board[3] - 12), str(f), F_TINY, (207, 198, 184), "mm")
    elapsed = max(0.0, t - 0.9)
    step = min(5, int(elapsed / 0.75))
    y = top + 4 * row_h + row_h / 2
    x = inner_x + (step + 0.5) * cell_w
    draw.ellipse([x - 20, y - 20, x + 20, y + 20], outline=WHITE, width=3)
    draw.ellipse([x - 14, y - 14, x + 14, y + 14], fill=ACCENT)
    text(draw, (x, y + 1), A_STRING[step], F_NOTE, ACCENT_TEXT, "mm")
    for f, note in enumerate(A_STRING):
        if f == step:
            continue
        fx = inner_x + (f + 0.5) * cell_w
        text(draw, (fx, y - 2), note, F_TINY, (207, 198, 184), "mm")
    text(draw, (40, 402), f"A + {step} fret{'s' if step != 1 else ''}  =  {A_STRING[step]}", F_BIG, TEXT)
    text(draw, (40, 430), "Say the note out loud before you play it.", F_SMALL, MUTED)
    progress(draw, (step + 1) / 6)
    return image


# ---------- Strumming ----------
PATTERN = ["D", "", "D", "U", "", "U", "D", "U"]


def frame_strum(t):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    base(draw, "Keep the strum steady", "D DU UDU  ·  four beats per bar")
    slot = int(t / 0.5) % 8
    beat = (slot // 2) % 4
    x0, x1 = 72, W - 72
    y = 230
    draw.rounded_rectangle([x0 - 24, y - 80, x1 + 24, y + 80], radius=14, fill=PANEL, outline=BORDER)
    for i, stroke in enumerate(PATTERN):
        x = x0 + i * ((x1 - x0) / 7)
        active = i == slot
        if stroke == "D":
            top, bottom = y - 36, y + 36
        elif stroke == "U":
            top, bottom = y + 36, y - 36
        else:
            top = bottom = y
        color = ACCENT if active else (MUTED if stroke else BORDER)
        width = 5 if active else 3
        if stroke:
            draw.line([(x, top), (x, bottom)], fill=color, width=width)
            head = bottom
            draw.polygon([(x - 7, head - (10 if stroke == "D" else -10)), (x + 7, head - (10 if stroke == "D" else -10)), (x, head)], fill=color)
        else:
            draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=color)
        text(draw, (x, y + 58), stroke or "·", F_TINY, ACCENT if active else MUTED, "mm")
    for i in range(4):
        cx = W / 2 - 45 + i * 30
        draw.ellipse([cx - 6, 350 - 6, cx + 6, 350 + 6], fill=ACCENT if i == beat else BORDER)
    text(draw, (W / 2, 390), "Down on the beat  ·  keep the hand moving through the rests", F_SMALL, MUTED, "ma")
    progress(draw, (slot + 1) / 8)
    return image


CLIPS = [
    ("scale-run", frame_scale, "A minor pentatonic · Position 1"),
    ("blues-scale", frame_blues, "A blues scale · the ♭5"),
    ("chord-change", frame_chords, "C to G · change on beat 1"),
    ("power-chords", frame_power, "G5 to A5 · the movable shape"),
    ("fretboard-notes", frame_notes, "A string · count one half step per fret"),
    ("strumming", frame_strum, "D DU UDU · four beats per bar"),
]


def encode(name, frame_fn):
    OUT.mkdir(parents=True, exist_ok=True)
    frames_dir = Path(tempfile.mkdtemp(prefix=f"t2-{name}-"))
    try:
        for i in range(FRAMES):
            frame_fn(i / FPS).save(frames_dir / f"f{i:04d}.png")
        out = OUT / f"{name}.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(frames_dir / "f%04d.png"),
            "-c:v", "libx264", "-preset", "slow", "-crf", "21",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out),
        ], check=True)
        frame_fn(0.4).save(OUT / f"{name}.png")
        print(f"{out}  {out.stat().st_size / 1024:.1f} KB")
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)


def main():
    for name, frame_fn, _ in CLIPS:
        encode(name, frame_fn)


if __name__ == "__main__":
    main()
