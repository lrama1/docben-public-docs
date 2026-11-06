"""Generates narration for the "create + validate a CF4 claim" demo with edge-tts.

Reads claim-demo-script.json (single source of truth for beat order + text) and
writes one MP3 per beat to demo/claim/narration/claim-<key>.mp3.

Usage:  python generate-narration-claim.py [key ...]   # no args = all beats
"""
import asyncio
import json
import os
import sys

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "claim-demo-script.json")
OUT_DIR = os.path.join(HERE, "demo", "claim", "narration")


async def main(only):
    with open(SCRIPT, encoding="utf-8") as f:
        script = json.load(f)
    voice = script["voice"]
    os.makedirs(OUT_DIR, exist_ok=True)
    for beat in script["beats"]:
        if only and beat["key"] not in only:
            continue
        out = os.path.join(OUT_DIR, f"claim-{beat['key']}.mp3")
        await edge_tts.Communicate(beat["text"], voice).save(out)
        print("wrote", out)


asyncio.run(main(set(sys.argv[1:])))
