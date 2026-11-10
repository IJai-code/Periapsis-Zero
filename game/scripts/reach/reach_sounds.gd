class_name ReachSounds
## Small looping signals made in code: a distress beacon's ping, the Hollow
## drones' radio chatter, the Phantom's wavering tone.

const RATE := 22050
const QUANTUM := [329.63, 440.0, 369.99, 493.88]

static func _wav(data: PackedByteArray, n: int) -> AudioStreamWAV:
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s

## A ping every `every` seconds: two tones, a falling tail.
static func beacon(pitch := 1.0, every := 3.0) -> AudioStreamWAV:
	var n := int(every * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / RATE
		# A D (D6) and the A under it, the caller's pitch held to the song's
		# scale: three beacons heard together make a chord, not a clash.
		var f := 1174.66 * Sfx.tuned(pitch) * (1.0 if t < 0.12 else 0.75)
		var v := sin(TAU * f * t) * exp(-t * 5.0) * 0.6 if t < 0.9 else 0.0
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 26000.0))
	return _wav(data, n)

## Clipped voices of static and tones: a drone net talking to itself.
static func chatter() -> AudioStreamWAV:
	var n := RATE * 6
	var data := PackedByteArray()
	data.resize(n * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 9
	var lp := 0.0
	var burst := 0.0
	var tone := 600.0
	for i in n:
		var t := float(i) / RATE
		if i % 2205 == 0:
			burst = 1.0 if rng.randf() < 0.45 else 0.0
			# Any note of the song's scale over two octaves: noise, but in key.
			tone = 440.0 * pow(2.0, float([0, 2, 5, 7, 9, 12, 14, 17, 19][rng.randi() % 9]) / 12.0)
		lp += (rng.randf() * 2.0 - 1.0 - lp) * 0.5
		var v := (lp * 0.4 + sin(TAU * tone * t) * 0.25 * signf(sin(TAU * 31.0 * t))) * burst
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 22000.0))
	return _wav(data, n)

## A tone that can't decide its pitch.
static func quantum() -> AudioStreamWAV:
	var n := RATE * 8
	var data := PackedByteArray()
	data.resize(n * 2)
	var ph := 0.0
	for i in n:
		var t := float(i) / RATE
		# It slides between the song's own notes (E, F sharp, A, B) and rests
		# on each a moment: undecided, but never out of key.
		var step := t / 2.0
		var k := int(step) % 4
		var glide := smoothstep(0.55, 1.0, step - floorf(step))
		var f := lerpf(QUANTUM[k], QUANTUM[(k + 1) % 4], glide) * (1.0 + 0.004 * sin(TAU * 1.7 * t))
		ph += TAU * f / RATE
		var v := (sin(ph) * 0.4 + sin(ph * 2.0) * 0.15) * (0.6 + 0.4 * sin(TAU * 0.5 * t))
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 24000.0))
	return _wav(data, n)

## Falling water: two bands of filtered noise, a slow swell.
static func falls() -> AudioStreamWAV:
	var n := int(3.0 * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	var lo := 0.0
	var hi := 0.0
	for i in n:
		var t := float(i) / RATE
		var x := randf() * 2.0 - 1.0
		lo += (x - lo) * 0.04
		hi += (x - hi) * 0.4
		var v := lo * 2.8 + (x - hi) * 0.18
		v *= 0.85 + 0.15 * sin(TAU * t / 3.0)
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 24000.0))
	return _wav(data, n)

## A drone's hum: a buzzing fundamental and a whine, beating slowly.
static func drone_hum() -> AudioStreamWAV:
	var n := int(2.0 * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / RATE
		var v := signf(sin(TAU * 110.0 * t)) * 0.12 + sin(TAU * 220.5 * t) * 0.16 + sin(TAU * 880.0 * t) * 0.05 * (0.6 + 0.4 * sin(TAU * 1.5 * t))
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 26000.0))
	return _wav(data, n)
