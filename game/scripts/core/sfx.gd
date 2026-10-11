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
	_streams.alarm = _make(1.2, func(t, n): return (1.0 if fmod(t * 2.0, 1.0) < 0.5 else 0.0) * signf(sin(TAU * 620.0 * t)) * 0.22)
	_streams.comm = _make(0.12, func(t, n): return (sin(TAU * 1800.0 * t) * 0.15 + n * 0.08) * exp(-t * 30.0))
	_streams.objective = _make(0.5, func(t, n): return (sin(TAU * 660.0 * t) * (1.0 if t < 0.12 else 0.0) + sin(TAU * 990.0 * t) * (1.0 if t >= 0.12 else 0.0)) * exp(-t * 6.0) * 0.3)
	_streams.click = _make(0.06, func(t, n): return sin(TAU * 2200.0 * t) * exp(-t * 80.0) * 0.4)
	_streams.step = _make(0.12, func(t, n): return _lp(n, 0.25) * exp(-t * 45.0) * 0.5 + sin(TAU * 90.0 * t) * exp(-t * 40.0) * 0.4)
	_streams.door = _make(1.4, func(t, n): return _lp(n, 0.05) * 0.5 * (1.0 - t / 1.4) + sin(TAU * 70.0 * t) * 0.2 * (1.0 if t < 1.1 else 0.0))
	_streams.beep = _make(0.12, func(t, n): return sin(TAU * 1040.0 * t) * (1.0 if t < 0.09 else 0.0) * 0.25)
	_streams.missile = _make(1.0, func(t, n): return _lp(n, 0.35) * minf(1.0, t * 12.0) * exp(-t * 2.2) * 0.7 + sin(TAU * (180.0 + t * 120.0) * t) * exp(-t * 4.0) * 0.15)
	_streams.locked = _make(0.3, func(t, n): return sin(TAU * (1320.0 if t < 0.12 else 1760.0) * t) * (1.0 if fmod(t, 0.15) < 0.11 else 0.0) * 0.22)
	_streams.warn = _make(0.9, func(t, n): return signf(sin(TAU * 980.0 * t)) * (1.0 if fmod(t, 0.15) < 0.08 else 0.0) * 0.16)
	_streams.warp = _make(3.4, func(t, n): return (_lp(n, 0.04 + t * 0.03) * 0.9 + sin(TAU * (60.0 + t * t * 40.0) * t) * 0.35) * minf(1.0, t * 0.8) * (1.0 - smoothstep(3.0, 3.4, t)))
	_streams.warp_out = _make(1.6, func(t, n): return (_lp(n, 0.12) * 0.8 + sin(TAU * (300.0 - t * 160.0) * t) * 0.2) * exp(-t * 2.4))
	_streams.ping = _make(0.7, func(t, n): return sin(TAU * 1480.0 * t) * exp(-t * 7.0) * 0.3 + sin(TAU * 2960.0 * t) * exp(-t * 12.0) * 0.08)
	_streams.roll = _make(0.6, func(t, n): return _lp(n, 0.2) * sin(PI * t / 0.6) * 0.5)

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
	p.pitch_scale = pitch
	p.play()
