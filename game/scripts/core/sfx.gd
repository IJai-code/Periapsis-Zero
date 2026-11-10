extends Node
## Sound effects made in code, once, at start: no files to license or load.
## Each is a short AudioStreamWAV synthesised from tones and noise.

const RATE := 22050
var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in 12:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_players.append(p)
	_streams.laser = _make(0.16, func(t, n): return sin(TAU * (1400.0 - t * 6500.0) * t) * exp(-t * 22.0) * 0.5 + n * exp(-t * 40.0) * 0.15)
	_streams.hit = _make(0.25, func(t, n): return n * exp(-t * 18.0) * 0.6 + sin(TAU * 140.0 * t) * exp(-t * 14.0) * 0.4)
	_streams.boom = _make(1.6, func(t, n): return _lp(n, 0.12) * exp(-t * 2.8) * 1.4 + sin(TAU * (55.0 - t * 20.0) * t) * exp(-t * 3.0) * 0.6)
	_streams.big = _make(3.2, func(t, n): return _lp(n, 0.06) * exp(-t * 1.1) * 1.6 + sin(TAU * (38.0 - t * 8.0) * t) * exp(-t * 1.2) * 0.8)
	_streams.alarm = _make(1.2, func(t, n): return (1.0 if fmod(t * 2.0, 1.0) < 0.5 else 0.0) * signf(sin(TAU * 587.33 * t)) * 0.22)
	_streams.comm = _make(0.12, func(t, n): return (sin(TAU * 1760.0 * t) * 0.15 + n * 0.08) * exp(-t * 30.0))
	_streams.objective = _make(0.5, func(t, n): return (sin(TAU * 587.33 * t) * (1.0 if t < 0.12 else 0.0) + sin(TAU * 880.0 * t) * (1.0 if t >= 0.12 else 0.0)) * exp(-t * 6.0) * 0.3)
	_streams.click = _make(0.06, func(t, n): return sin(TAU * 2349.32 * t) * exp(-t * 80.0) * 0.4)
	_streams.step = _make(0.12, func(t, n): return _lp(n, 0.25) * exp(-t * 45.0) * 0.5 + sin(TAU * 90.0 * t) * exp(-t * 40.0) * 0.4)
	_streams.door = _make(1.4, func(t, n): return _lp(n, 0.05) * 0.5 * (1.0 - t / 1.4) + sin(TAU * 70.0 * t) * 0.2 * (1.0 if t < 1.1 else 0.0))
	_streams.beep = _make(0.12, func(t, n): return sin(TAU * 1174.66 * t) * (1.0 if t < 0.09 else 0.0) * 0.25)
	_streams.missile = _make(1.0, func(t, n): return _lp(n, 0.35) * minf(1.0, t * 12.0) * exp(-t * 2.2) * 0.7 + sin(TAU * (180.0 + t * 120.0) * t) * exp(-t * 4.0) * 0.15)
	_streams.locked = _make(0.3, func(t, n): return sin(TAU * (1174.66 if t < 0.12 else 1760.0) * t) * (1.0 if fmod(t, 0.15) < 0.11 else 0.0) * 0.22)
	_streams.warn = _make(0.9, func(t, n): return signf(sin(TAU * 987.77 * t)) * (1.0 if fmod(t, 0.15) < 0.08 else 0.0) * 0.16)
	_streams.warp = _make(3.4, func(t, n): return (_lp(n, 0.04 + t * 0.03) * 0.9 + sin(TAU * (60.0 + t * t * 40.0) * t) * 0.35) * minf(1.0, t * 0.8) * (1.0 - smoothstep(3.0, 3.4, t)))
	_streams.warp_out = _make(1.6, func(t, n): return (_lp(n, 0.12) * 0.8 + sin(TAU * (300.0 - t * 160.0) * t) * 0.2) * exp(-t * 2.4))
	_streams.ping = _make(0.7, func(t, n): return sin(TAU * 1479.98 * t) * exp(-t * 7.0) * 0.3 + sin(TAU * 2959.96 * t) * exp(-t * 12.0) * 0.08)
	_streams.shutter = _make(0.22, func(t, n): return n * (exp(-t * 90.0) + exp(-maxf(t - 0.09, 0.0) * 70.0) * (1.0 if t > 0.09 else 0.0)) * 0.45 + sin(TAU * 3200.0 * t) * exp(-t * 120.0) * 0.2)
	_streams.roll = _make(0.6, func(t, n): return _lp(n, 0.2) * sin(PI * t / 0.6) * 0.5)
	# Water: a body going in, a stroke through it, a bubble rising.
	_streams.splash = _make(1.1, func(t, n): return _lp(n, 0.35) * exp(-t * 4.2) * 1.1 + _lp(n, 0.06) * exp(-t * 2.0) * 0.5 + sin(TAU * (260.0 + sin(t * 70.0) * 90.0) * t) * exp(-t * 8.0) * 0.12)
	_streams.swim = _make(0.6, func(t, n): return _lp(n, 0.07) * sin(PI * t / 0.6) * 0.55 + _lp(n, 0.4) * sin(PI * t / 0.6) * 0.08)
	# A meteor coming in: a falling whistle under a rising roar.
	_streams.whistle = _make(2.4, func(t, n): return sin(TAU * (1500.0 - t * 520.0) * t) * minf(1.0, t * 1.5) * 0.16 + _lp(n, 0.08 + t * 0.06) * (t / 2.4) * 0.7)
	# A ring flown through: a bright two-note chime.
	_streams.gate = _make(0.55, func(t, n): return (sin(TAU * 880.0 * t) * (1.0 if t < 0.1 else 0.0) + sin(TAU * 1174.66 * t) * (1.0 if t >= 0.1 else 0.0) + sin(TAU * 2349.32 * t) * 0.3) * exp(-t * 6.5) * 0.28)
	# A medal: three rising notes and a held chord.
	_streams.fanfare = _make(1.8, func(t, n): return (sin(TAU * (587.33 if t < 0.15 else (739.99 if t < 0.3 else 880.0)) * t) + (sin(TAU * 1174.66 * t) * 0.5 if t > 0.45 else 0.0)) * exp(-maxf(t - 0.45, 0.0) * 1.6) * 0.22)
	# One sung note, a D (D4): the Engine's song is sung on it, a word a note
	# (WandererSite.NOTES), in the key of everything else here.
	_streams.sing = _make(1.9, func(t, n): return (sin(TAU * 293.66 * t) + sin(TAU * 587.33 * t) * 0.35 + sin(TAU * 881.0 * t) * 0.16 + sin(TAU * 294.4 * t) * 0.5) * minf(1.0, t / 0.08) * exp(-t * 1.5) * 0.3)
	_streams.bubble = _make(0.16, func(t, n): return sin(TAU * (420.0 + t * 2600.0) * t) * exp(-t * 26.0) * 0.28)

var _lp_state := 0.0
func _lp(x: float, k: float) -> float:
	_lp_state += (x - _lp_state) * k
	return _lp_state * 3.0

func _make(seconds: float, f: Callable) -> AudioStreamWAV:
	var n := int(seconds * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	_lp_state = 0.0
	for i in n:
		var t := float(i) / RATE
		var v: float = f.call(t, randf() * 2.0 - 1.0)
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 32000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.data = data
	return s

## Four seconds of interior hum that loops cleanly: a 50 Hz and 100 Hz
## drone, a slow beat between them, and filtered air noise.
func hum_stream() -> AudioStreamWAV:
	var seconds := 4.0
	var n := int(seconds * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	var lp := 0.0
	var lp2 := 0.0
	for i in n:
		var t := float(i) / RATE
		var drone := sin(TAU * 50.0 * t) * 0.32 + sin(TAU * 100.0 * t) * 0.14 + sin(TAU * 150.5 * t) * 0.05
		drone *= 0.8 + 0.2 * sin(TAU * 0.5 * t)
		lp += (randf() * 2.0 - 1.0 - lp) * 0.02
		lp2 += (lp - lp2) * 0.05
		var v := drone * 0.55 + lp2 * 6.0
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 20000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s

func play(name: String, volume_db := 0.0, pitch := 1.0) -> void:
	if not _streams.has(name):
		return
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = _streams[name]
	p.volume_db = volume_db + Flow.sfx_db()
	p.pitch_scale = tuned(pitch) if name in TONAL else pitch
	p.play()

## The effects that are notes (the rest are noise and sweeps), and their
## pitch held to the song's scale: a caller's "a bit higher" lands on the
## nearest step of D major instead of between the keys.
const TONAL := ["alarm", "comm", "objective", "click", "beep", "locked", "warn", "ping", "gate", "fanfare", "sing"]
const SCALE := [0, 2, 4, 7, 9]

static func tuned(pitch: float) -> float:
	var semis := 12.0 * log(maxf(pitch, 0.05)) / log(2.0)
	var octave := floorf(semis / 12.0)
	var within := semis - octave * 12.0
	var best := 0.0
	var best_d := 99.0
	for s: int in SCALE + [12]:
		var d := absf(within - float(s))
		if d < best_d:
			best_d = d
			best = float(s)
	return pow(2.0, (octave * 12.0 + best) / 12.0)
