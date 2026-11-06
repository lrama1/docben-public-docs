"""Generates per-scene promo narration (edge-tts Jenny) + a synthetic music bed.

Outputs:
  narration:  <BASE>/promo/narr-<sceneid>.mp3   (one per scene)
  music bed:  <BASE>/promo/music.wav            (~35s, soft ambient pad)

Run from video-src/<folder> (after `npm install` in video-src):  python generate-promo-audio.py
"""
import asyncio
import json
import math
import os
import struct
import wave

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.normpath(os.path.join(HERE, "..", "..", "videos"))
OUT = os.path.join(BASE, "promo")
SCRIPT = json.load(open(os.path.join(HERE, "promo-script.json"), encoding="utf-8"))
VOICE = SCRIPT["voice"]

SR = 44100


async def gen_narration():
    os.makedirs(OUT, exist_ok=True)
    for sc in SCRIPT["scenes"]:
        out = os.path.join(OUT, f"narr-{sc['id']}.mp3")
        # Slightly faster + brighter for promo energy.
        await edge_tts.Communicate(sc["narration"], VOICE, rate="+6%").save(out)
        print("wrote", out)


def note(freq, t, dur, vol=0.5, bright=0.0):
    """Soft synth note: sine + a touch of 2nd/3rd harmonic, exponential decay."""
    n = int(dur * SR)
    buf = []
    for i in range(n):
        tt = t + i / SR
        env = math.exp(-3.0 * (i / SR) / dur)
        s = (math.sin(2 * math.pi * freq * tt)
             + 0.3 * math.sin(2 * math.pi * freq * 2 * tt) * (0.3 + bright)
             + 0.15 * math.sin(2 * math.pi * freq * 3 * tt) * bright)
        buf.append(int(32767 * vol * env * s))
    return buf


def gen_music():
    """Gentle uplifting pad: a I–V–vi–IV progression in C, ~36s, low volume."""
    os.makedirs(OUT, exist_ok=True)
    # Chords (C major): C, G, Am, F  -> frequencies
    CHORDS = [
        [261.63, 329.63, 392.00],   # C E G
        [246.94, 293.66, 392.00],   # G (B D G)
        [220.00, 261.63, 329.63],   # Am (A C E)
        [174.61, 220.00, 261.63],   # F (F A C)
    ]
    chord_dur = 4.5
    total_dur = chord_dur * len(CHORDS) * 2  # play progression twice (~36s)
    total = [0] * int(total_dur * SR)

    t = 0.0
    for _ in range(2):
        for chord in CHORDS:
            for f in chord:
                b = note(f, 0.0, chord_dur, vol=0.22, bright=0.15)
                off = int(t * SR)
                for i, v in enumerate(b):
                    if off + i < len(total):
                        total[off + i] += v
            # soft root pulse for rhythm
            root = note(chord[0] / 2, 0.0, 0.6, vol=0.30)
            off = int(t * SR)
            for i, v in enumerate(root):
                if off + i < len(total):
                    total[off + i] += v
            t += chord_dur

    # Normalize + gentle fade in/out
    peak = max(1, max(abs(v) for v in total))
    fade = int(1.5 * SR)
    path = os.path.join(OUT, "music.wav")
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i, v in enumerate(total):
            g = v / peak * 0.5
            if i < fade:
                g *= i / fade
            if i > len(total) - fade:
                g *= max(0.0, (len(total) - i) / fade)
            frames += struct.pack("<h", int(32767 * max(-1, min(1, g))))
        w.writeframes(bytes(frames))
    print("wrote", path, f"({total_dur:.0f}s)")


async def main():
    await gen_narration()
    gen_music()


asyncio.run(main())
