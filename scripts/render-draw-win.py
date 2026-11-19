#!/usr/bin/env python3
"""Render the draw reward sound. An optional Ta-Da recording stays in the local preview."""

from argparse import ArgumentParser
from array import array
from pathlib import Path
from random import Random
from tempfile import TemporaryDirectory
import json
import math
import subprocess

AUDIO = Path(__file__).resolve().parents[1] / "src/lib/audio"
TIMING = json.loads((AUDIO / "draw-win-timing.json").read_text())
IMPACT = TIMING["impactMs"] / 1000
LEFT = TIMING["leftBurstMs"] / 1000
RIGHT = TIMING["rightBurstMs"] / 1000
RATE = 44100
FRAMES = round(TIMING["durationMs"] * RATE / 1000)


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def voice(destination, start, duration, pan, render):
    offset = round(start * RATE)
    left = math.sqrt(1 - pan)
    right = math.sqrt(1 + pan)
    for frame in range(min(round(duration * RATE), FRAMES - offset)):
        sample = render(frame / RATE)
        index = (offset + frame) * 2
        destination[index] += sample * left
        destination[index + 1] += sample * right


def crystal(destination, start, note, strength, decay, pan):
    angular = math.tau * frequency(note)

    def render(time):
        phase = angular * time
        body = math.sin(phase) + .22 * math.sin(phase * 2.007)
        edge = math.sin(phase * 2.703) + .25 * math.sin(phase * 4.84)
        return strength * min(1, time / .005) * (
            body * math.exp(-time / decay) + .36 * edge * math.exp(-time / (decay * .34))
        )

    voice(destination, start, decay * 6, pan, render)


def rising_light(destination):
    rng = Random(613)
    wide = narrow = phase = 0

    def render(time):
        nonlocal wide, narrow, phase
        progress = time / IMPACT
        sample = rng.uniform(-1, 1)
        wide += (sample - wide) * (.17 + .30 * progress)
        narrow += (sample - narrow) * .052
        phase += math.tau * frequency(47 + 24 * progress ** 2) / RATE
        envelope = progress ** 1.40 * min(1, (IMPACT - time) / .057)
        return envelope * ((wide - narrow) * .39 + math.sin(phase) * .062)

    voice(destination, 0, IMPACT, -.10, render)
    for fraction, note, pan in ((.12, 55, -.54), (.36, 60, .38), (.61, 67, -.31), (.82, 74, .48)):
        crystal(destination, IMPACT * fraction, note, .063, .047, pan)


def strike(destination, start, strength, pan, seed):
    rng = Random(seed)
    wide = narrow = 0

    def render(time):
        nonlocal wide, narrow
        sample = rng.uniform(-1, 1)
        wide += (sample - wide) * .60
        narrow += (sample - narrow) * .13
        phase = math.tau * (66 * time + .95 * (1 - math.exp(-time / .020)))
        hit = (.16 * math.sin(phase) + .15 * math.sin(2 * phase)) * math.exp(-time / .103)
        crack = (wide - narrow) * .39 * math.exp(-time / .040)
        return strength * min(1, time / .003) * (hit + crack)

    voice(destination, start, .52, pan, render)


def glow(destination, start, length, note, gain, pan):
    angular = math.tau * frequency(note)

    def render(time):
        phase = angular * time
        env = min(1, time / .17) * (1 - time / length) ** 1.6
        tone = math.sin(phase) + .30 * math.sin(phase * 2.003) + .13 * math.sin(phase * 3.004)
        return gain * env * tone * (.82 + .18 * math.cos(time * 16))

    voice(destination, start, length, pan, render)


def write_sound(destination, samples, codec):
    master = samples[:]
    taper = .22 * RATE
    for frame in range(FRAMES):
        gain = min(1, (FRAMES - frame - 1) / taper)
        for channel in (0, 1):
            index = frame * 2 + channel
            # Only coincident peaks approach the soft limiter.
            value = master[index] * gain
            level = abs(value)
            if level > .72:
                level = .72 + .19 * math.tanh((level - .72) / .19)
            master[index] = math.copysign(level, value)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=destination.parent) as work_dir:
        rendered = Path(work_dir) / destination.name
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "-",
            "-map_metadata", "-1", *codec, str(rendered),
        ], input=master.tobytes(), check=True)
        rendered.replace(destination)


def backing_track():
    samples = array("f", [0]) * (FRAMES * 2)
    rising_light(samples)
    strike(samples, IMPACT, 1.04, 0, 310)
    strike(samples, LEFT, .72, -.63, 630)
    strike(samples, RIGHT, .65, .63, 924)

    for note, gain, pan in ((48, .058, -.12), (55, .045, .36), (64, .053, -.48), (67, .043, .46), (72, .035, .15)):
        glow(samples, IMPACT + .035, 2.86, note, gain, pan)

    for beat, notes, pan in ((IMPACT + .15, (84, 88, 91), .18), (LEFT, (79, 84, 88, 91), -.48), (RIGHT, (84, 91, 96, 100), .49)):
        for index, note in enumerate(notes):
            start = beat + index * .064
            strength = .122 * .88 ** index
            crystal(samples, start, note, strength, .17 + .02 * index, pan)
            crystal(samples, start + .091, note, strength * .24, .22, -pan)

    for start, note, pan in ((RIGHT + .43, 96, -.55), (RIGHT + .60, 100, .51), (RIGHT + .82, 103, -.40), (RIGHT + 1.08, 108, .40), (RIGHT + 1.31, 103, -.25)):
        crystal(samples, start, note, .046, .17, pan)
    return samples


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--ta-da", type=Path, help="create the local preview from this recording")
    options = parser.parse_args()
    samples = backing_track()
    if options.ta_da:
        original = array("f", subprocess.check_output([
            "ffmpeg", "-v", "error", "-i", str(options.ta_da), "-af", "pan=stereo|FL=c0|FR=c0",
            "-ar", str(RATE), "-f", "f32le", "-",
        ]))
        # TADA.WAV has about 35 ms of lead-in before its first attack.
        index = round((IMPACT - .035) * RATE) * 2
        for offset, sample in enumerate(original[:len(samples) - index]):
            samples[index + offset] += sample * .78
        write_sound(AUDIO / "preview.local/draw-win.wav", samples, ("-c:a", "pcm_s16le"))
        return

    for delay, note, strength, pan in ((0, 60, .20, 0), (.041, 72, .26, -.22), (.092, 76, .23, .26), (.143, 79, .21, -.34), (.225, 84, .21, .18)):
        crystal(samples, IMPACT + delay, note, strength, .30, pan)
    write_sound(AUDIO / "draw-win.mp3", samples, ("-c:a", "libmp3lame", "-q:a", "3"))


if __name__ == "__main__":
    main()
