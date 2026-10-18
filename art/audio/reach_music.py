"""The Reach's music, made in code: one song, "Wayfarers", in five parts,
each the length of the same loop so they play in step wherever they are
heard, plus the music for the end of a loop and the waking chime.

    python3 art/audio/reach_music.py game/audio/reach

Writes 22,050 Hz mono WAVs:
  banjo.wav     Mara, at Hearth's campfire: a forward roll on the chords
  flute.wav     Okafor, at the observatory: the tune
  harmonica.wav Renn, on Verdance: the chords, breathing
  drums.wav     Vex, on Ashfall: hand drums
  choir.wav     the Choir's songlines and the Engine: a hum on the roots
  end.wav       the last minute of a loop: the hum rising, a music box
  wake.wav      a soft chime as the eyes open
  launch.wav    the first lift-off of a morning: the banjo and the tune
                together over a choir that swells, once through

The song is in D, 92 beats a minute, sixteen bars of four, about 41.7 s.
Plain Python (no numpy): each part is synthesised sample by sample.
"""
import math
import os
import random
import struct
import sys
import wave

RATE = 22050
BPM = 92.0
BEAT = 60.0 / BPM
BARS = 16
LENGTH = BARS * 4 * BEAT
N = int(LENGTH * RATE)

# Chords by bar: root semitone above D, and minor or not.
CHORDS = [(0, False), (9, True), (5, False), (7, False), (0, False), (4, True), (5, False), (7, False),
          (9, True), (5, False), (0, False), (7, False), (5, False), (7, False), (0, False), (0, False)]
D3 = 146.83


def freq(semi, base=D3):
    return base * 2.0 ** (semi / 12.0)


def chord_tones(bar):
    root, minor = CHORDS[bar % BARS]
    return [root, root + (3 if minor else 4), root + 7]


def write(path, samples, peak=0.85):
    m = max(1e-6, max(abs(s) for s in samples))
    k = peak / m
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s * k)) * 32000)) for s in samples))
    print('wrote', path, f'{len(samples) / RATE:.1f} s')


def add(buf, start, data, gain=1.0):
    """Mix `data` into `buf` from sample `start`, wrapping (seamless loop)."""
    n = len(buf)
    for i, v in enumerate(data):
        buf[(start + i) % n] += v * gain


def pluck(f, seconds, bright=0.6, rng=random.Random(1)):
    """Karplus-Strong: a plucked string."""
    period = max(2, int(RATE / f))
    ring = [rng.uniform(-1, 1) for _ in range(period)]
    out = []
    idx = 0
    damp = 0.996 - (1.0 - bright) * 0.01
    for i in range(int(seconds * RATE)):
        a = ring[idx]
        b = ring[(idx + 1) % period]
        v = (a + b) * 0.5 * damp
        ring[idx] = v
        idx = (idx + 1) % period
        out.append(a)
    # A banjo's head: a short twang on the attack.
    for i in range(min(len(out), 400)):
        out[i] += math.sin(2 * math.pi * f * 2 * i / RATE) * 0.25 * (1 - i / 400)
    return out


def banjo():
    buf = [0.0] * N
    # Forward roll: thumb, index, middle over the chord, eighth notes.
    pattern = [0, 2, 1, 2, 0, 2, 1, 2]
    for bar in range(BARS):
        tones = chord_tones(bar)
        for k in range(8):
            t = (bar * 4 + k * 0.5) * BEAT
            which = pattern[k]
            semi = tones[which] + (12 if which > 0 else 0)
            f = freq(semi, D3 * 2)
            note = pluck(f, 1.2, 0.75)
            add(buf, int(t * RATE), note, 0.32 if which else 0.4)
    return buf


def flute():
    buf = [0.0] * N
    # The tune: (bar, beat, semitone above D4, beats).
    tune = [
        (0, 0, 9, 1.5), (0, 1.5, 7, 0.5), (0, 2, 4, 2),
        (1, 0, 2, 1), (1, 1, 4, 1), (1, 2, 0, 2),
        (2, 0, 2, 1.5), (2, 1.5, 4, 0.5), (2, 2, 7, 2),
        (3, 0, 9, 1), (3, 1, 7, 1), (3, 2, 4, 2),
        (4, 0, 9, 1.5), (4, 1.5, 11, 0.5), (4, 2, 14, 2),
        (5, 0, 11, 1), (5, 1, 9, 1), (5, 2, 7, 2),
        (6, 0, 7, 1), (6, 1, 9, 1), (6, 2, 11, 1), (6, 3, 9, 1),
        (7, 0, 7, 3), (7, 3, 4, 1),
        (8, 0, 2, 1.5), (8, 1.5, 4, 0.5), (8, 2, 7, 2),
        (9, 0, 7, 1), (9, 1, 9, 1), (9, 2, 11, 2),
        (10, 0, 9, 1.5), (10, 1.5, 7, 0.5), (10, 2, 4, 2),
        (11, 0, 9, 1), (11, 1, 7, 1), (11, 2, 4, 2),
        (12, 0, 4, 1), (12, 1, 7, 1), (12, 2, 9, 2),
        (13, 0, 11, 1), (13, 1, 9, 1), (13, 2, 7, 2),
        (14, 0, 2, 2), (14, 2, 4, 2),
        (15, 0, 0, 4),
    ]
    rng = random.Random(3)
    for bar, beat, semi, beats in tune:
        f = freq(semi, D3 * 2)
        dur = beats * BEAT
        n = int((dur + 0.15) * RATE)
        start = int((bar * 4 + beat) * BEAT * RATE)
        note = []
        lp = 0.0
        for i in range(n):
            t = i / RATE
            env = min(1.0, t / 0.06) * (1.0 if t < dur else max(0.0, 1.0 - (t - dur) / 0.15))
            vib = 1.0 + 0.006 * math.sin(2 * math.pi * 5.2 * t) * min(1.0, t / 0.4)
            ph = 2 * math.pi * f * vib * t
            lp += (rng.uniform(-1, 1) - lp) * 0.2
            v = math.sin(ph) * 0.8 + math.sin(2 * ph) * 0.12 + math.sin(3 * ph) * 0.05 + lp * 0.05
            note.append(v * env)
        add(buf, start, note, 0.5)
    return buf


def harmonica():
    buf = [0.0] * N
    rng = random.Random(5)
    for bar in range(BARS):
        tones = chord_tones(bar)
        for half in range(2):
            start = int((bar * 4 + half * 2) * BEAT * RATE)
            dur = 2 * BEAT
            n = int((dur + 0.1) * RATE)
            note = [0.0] * n
            for semi in tones[:2] + [tones[0] + 12]:
                f = freq(semi, D3 * 2)
                det = rng.uniform(-0.6, 0.6)
                for i in range(n):
                    t = i / RATE
                    env = min(1.0, t / 0.12) * (1.0 if t < dur else max(0.0, 1.0 - (t - dur) / 0.1))
                    # Breath swell, a reed's odd harmonics.
                    swell = 0.75 + 0.25 * math.sin(math.pi * min(t / dur, 1.0))
                    ph = 2 * math.pi * (f + det) * t * (1 + 0.004 * math.sin(2 * math.pi * 6 * t))
                    note[i] += (math.sin(ph) + 0.4 * math.sin(3 * ph) + 0.18 * math.sin(5 * ph)) * env * swell
            add(buf, start, note, 0.16)
    return buf


def drums():
    buf = [0.0] * N
    rng = random.Random(7)

    def hit(f0, decay, noise, length=0.4):
        out = []
        lp = 0.0
        for i in range(int(length * RATE)):
            t = i / RATE
            f = f0 * (1 + 1.5 * math.exp(-t * 40))
            lp += (rng.uniform(-1, 1) - lp) * 0.3
            out.append(math.sin(2 * math.pi * f * t) * math.exp(-t * decay) + lp * noise * math.exp(-t * 30))
        return out

    low = hit(82, 9, 0.2)
    mid = hit(150, 14, 0.35)
    slap = hit(260, 26, 0.9, 0.2)
    # A two-bar pattern on eighths: low, rest, slap, mid...
    pattern = [low, None, slap, mid, low, mid, slap, None, low, None, slap, mid, low, slap, mid, slap]
    for bar in range(0, BARS, 2):
        for k, h in enumerate(pattern):
            if h is None:
                continue
            t = (bar * 4 + k * 0.5) * BEAT
            add(buf, int(t * RATE), h, 0.5 if h is low else 0.38)
    return buf


def pad(roots, seconds, swell_from=0.0, swell_to=1.0, bright=1.0):
    """A choir hum: a few voices on each root and fifth, formant-shaded."""
    n = int(seconds * RATE)
    out = [0.0] * n
    rng = random.Random(11)
    for semi in roots:
        for v in range(3):
            f = freq(semi, D3) * (1 + rng.uniform(-0.003, 0.003))
            ph0 = rng.uniform(0, 6.28)
            for i in range(n):
                t = i / RATE
                amp = swell_from + (swell_to - swell_from) * (t / seconds)
                ph = 2 * math.pi * f * t + ph0
                s = math.sin(ph) + 0.5 * math.sin(2 * ph) * bright + 0.3 * math.sin(3 * ph) * bright + 0.12 * math.sin(4 * ph) * bright
                out[i] += s * amp * (0.85 + 0.15 * math.sin(2 * math.pi * 0.2 * t + v))
    return out


def choir():
    buf = [0.0] * N
    for bar in range(0, BARS, 2):
        root, _ = CHORDS[bar]
        p = pad([root - 12, root - 5], 2 * 4 * BEAT + 0.4, 0.6, 0.6, 0.6)
        # Fade each chord in and out.
        m = len(p)
        for i in range(m):
            p[i] *= min(1.0, i / (RATE * 0.8)) * min(1.0, (m - i) / (RATE * 0.8))
        add(buf, int(bar * 4 * BEAT * RATE), p, 0.12)
    return buf


def end():
    seconds = 60.0
    n = int(seconds * RATE)
    out = pad([0 - 12, 7 - 12, 0], seconds, 0.05, 1.0, 0.8)
    # A music box falling through the chords, slower toward the end.
    rng = random.Random(13)
    notes = [14, 9, 7, 4, 2, 7, 4, 2, 0, 4, 2, -3]
    t = 4.0
    k = 0
    while t < seconds - 3.0:
        semi = notes[k % len(notes)]
        f = freq(semi, D3 * 4)
        for i in range(int(1.6 * RATE)):
            j = int(t * RATE) + i
            if j >= n:
                break
            tt = i / RATE
            out[j] += (math.sin(2 * math.pi * f * tt) + 0.3 * math.sin(2 * math.pi * f * 3.01 * tt)) * math.exp(-tt * 3.0) * 0.5
        t += 0.75 + (t / seconds) * 0.9 + rng.uniform(-0.05, 0.05)
        k += 1
    return out


def wake():
    seconds = 4.0
    n = int(seconds * RATE)
    out = [0.0] * n
    for k, semi in enumerate([0, 7, 12, 16, 19]):
        f = freq(semi, D3 * 2)
        start = int(k * 0.22 * RATE)
        for i in range(n - start):
            t = i / RATE
            out[start + i] += math.sin(2 * math.pi * f * t) * math.exp(-t * 1.6) * 0.4
    return out


def launch():
    b = banjo()
    f = flute()
    c = choir()
    n = len(b)
    out = [0.0] * n
    swell = pad([0 - 12, 7 - 12], LENGTH, 0.1, 1.0, 0.7)
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / 2.5) * min(1.0, (LENGTH - t) / 6.0)
        out[i] = (b[i] * 0.8 + f[i] * 0.9 + c[i] * 0.6 + swell[i] * 0.07) * env
    return out


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, fn in (('banjo', banjo), ('flute', flute), ('harmonica', harmonica), ('drums', drums), ('choir', choir), ('end', end), ('wake', wake), ('launch', launch)):
        write(os.path.join(out, f'{name}.wav'), fn())
