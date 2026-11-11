class_name Weather
extends Node3D
## Weather on the worlds with air and water. Fronts come over at the same
## minutes of every loop (it is the same day each time, and a shower you
## were caught in is one you can plan round): the cloud thickens, the light
## goes grey and flat, the distance closes in, rain falls and drums, the
## ground darkens and shines, and in the heaviest of it there is lightning.
## Everything here is laid over what the scene already does: step() runs
## after the day's light and air are set and only scales them.

## Each world's fronts: [starts, ends, strength 0..1], in loop seconds.
const FRONTS := {
	"hearthstone": [[400.0, 560.0, 0.65], [1010.0, 1260.0, 1.0]],
	"verdance": [[90.0, 330.0, 0.85], [560.0, 800.0, 1.0], [1000.0, 1240.0, 0.75]],
}
## Cloud gathers this long before the rain and lingers after it.
const LEAD := 70.0
const STREAKS := 2400

var reach: Node
## A front held overhead whatever the hour (capture beats): its strength, or -1.
static var held := -1.0
## How overcast (0..1), how hard it rains (0..1), how wet the ground is.
var cloud := 0.0
var rain := 0.0
var wet := 0.0
## Lightning: the flash now (0..1), and how many so far.
var flash := 0.0
var strikes := 0

var _mat: ShaderMaterial
var _drops: MultiMeshInstance3D
var _drift := Vector3.ZERO
var _last := Vector3.ZERO
var _rain_sound: AudioStreamPlayer
var _roof_sound: AudioStreamPlayer
var _thunder: AudioStreamPlayer
var _covered := 0.0
var _cover_t := 0.0
var _under := false
var _next_strike := 14.0
var _thunder_in := -1.0
var _wet_on := ""

## How overcast a world is at a moment of the loop.
static func cloud_at(key: String, t: float) -> float:
	if held >= 0.0:
		return lerpf(0.75, 1.0, held) if FRONTS.has(key) else 0.0
	var c := 0.0
	for f: Array in FRONTS.get(key, []):
		c = maxf(c, smoothstep(f[0] - LEAD, f[0], t) * (1.0 - smoothstep(f[1], f[1] + LEAD, t)) * lerpf(0.75, 1.0, f[2]))
	return c

## How hard it rains there then.
static func rain_at(key: String, t: float) -> float:
	if held >= 0.0:
		return held if FRONTS.has(key) else 0.0
	var r := 0.0
	for f: Array in FRONTS.get(key, []):
		r = maxf(r, smoothstep(f[0], f[0] + 45.0, t) * (1.0 - smoothstep(f[1] - 45.0, f[1], t)) * f[2])
	return r

func _ready() -> void:
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.0)
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/reach/rain.gdshader")
	# After the sky, the air and the clouds, which would paint over it.
	_mat.render_priority = 6
	q.material = _mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = q
	mm.instance_count = STREAKS
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	for i in STREAKS:
		mm.set_instance_transform(i, Transform3D.IDENTITY)
		mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), (float(i) + 0.5) / STREAKS))
	_drops = MultiMeshInstance3D.new()
	_drops.multimesh = mm
	_drops.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_drops.custom_aabb = AABB(Vector3.ONE * -20.0, Vector3.ONE * 40.0)
	_drops.visible = false
	add_child(_drops)
	var t0 := Time.get_ticks_usec()
	_rain_sound = _loop(_rain_stream(false))
	_roof_sound = _loop(_rain_stream(true))
	_thunder = AudioStreamPlayer.new()
	_thunder.stream = _thunder_stream()
	add_child(_thunder)
	if "--steps" in OS.get_cmdline_user_args():
		print("WEATHER sounds made in %d ms" % ((Time.get_ticks_usec() - t0) / 1000))

func _loop(s: AudioStream) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = s
	p.volume_db = -80.0
	p.autoplay = true
	add_child(p)
	return p

## After the scene has set the day's light and air: lay the weather over it.
func step(cam: Camera3D, dt: float) -> void:
	var sys: ReachSystem = reach.system
	var b := sys.ruling()
	var env: Environment = reach.env
	var low := 0.0
	if cam and FRONTS.has(b.key):
		var alt := cam.global_position.length() - b.radius
		low = 1.0 - smoothstep((b.atmo - b.radius) * 0.45, (b.atmo - b.radius) * 0.9, alt)
	# The ending is its own sky.
	if reach.loop and reach.loop.ending:
		low = 0.0
	var under: bool = reach.player != null and reach.player.underwater
	var c := cloud_at(b.key, sys.t)
	cloud = c * low
	rain = rain_at(b.key, sys.t) * low
	# The ground takes a while to wet and far longer to dry.
	if _wet_on != b.key:
		_soak(0.0)
		_wet_on = b.key
		wet = rain_at(b.key, sys.t)
	wet = move_toward(wet, 1.0 if rain_at(b.key, sys.t) > 0.05 else 0.0, dt / (25.0 if rain_at(b.key, sys.t) > 0.05 else 150.0))
	_soak(wet if FRONTS.has(b.key) else 0.0)
	var p := reach.planets.get(b.key) as Planet
	if p and p.look:
		p.look.overcast(c)
	_lightning(dt, b.key, sys.t)
	if cloud > 0.001 and not under:
		# Grey, flat light: less of the Lantern, more of the sky, and the
		# far hills gone into the wet.
		var grey := Color(0.5, 0.54, 0.6) * lerpf(0.25, 1.0, clampf(env.ambient_light_energy / 0.45, 0.0, 1.0))
		reach.sun.light_energy *= 1.0 - 0.8 * cloud
		env.ambient_light_color = env.ambient_light_color.lerp(Color(0.62, 0.66, 0.74), cloud * 0.8)
		env.ambient_light_energy *= 1.0 + 0.55 * cloud
		env.fog_light_color = env.fog_light_color.lerp(grey, cloud * 0.9)
		env.fog_density *= 1.0 + 5.0 * cloud + 9.0 * rain
		env.fog_sky_affect = maxf(env.fog_sky_affect, cloud * 0.92)
	if flash > 0.0 and not under:
		env.ambient_light_color = env.ambient_light_color.lerp(Color(0.8, 0.86, 1.0), flash)
		env.ambient_light_energy += 2.6 * flash * low
		env.fog_light_color = env.fog_light_color.lerp(Color(0.75, 0.8, 0.95), flash * 0.7)
	_fall(cam, dt, b, under)
	_mist(cam, dt, b, under)
	_sound(dt, under)

## Low mist in the hollows round the camera: some every dawn and dusk on
## the worlds with air, thick in the fronts. Laid on the ground where the
## camera is (rebuilt after it has moved 35 m), the lowest of a few tries
## each, so it pools where mist pools.
const PUFFS := 56
var _puffs: MultiMeshInstance3D
var _puff_mat: ShaderMaterial
var _laid_at := Vector3.INF
var _laid_on := ""
var mist := 0.0

func _mist(cam: Camera3D, dt: float, b: ReachBody, under: bool) -> void:
	var want := 0.0
	if cam and b.air and not under and not (reach.loop and reach.loop.ending):
		var alt := cam.global_position.distance_to(b.node.global_position) - b.radius
		var low := 1.0 - smoothstep(60.0, 160.0, alt)
		var sun_up := (cam.global_position - b.node.global_position).normalized().dot((reach.system.world("lantern") - cam.global_position).normalized())
		var dawn := 1.0 - smoothstep(0.05, 0.45, absf(sun_up - 0.05))
		want = clampf(0.35 + 0.65 * dawn + cloud * 0.8, 0.0, 1.0) * low
	mist = move_toward(mist, want, dt * 0.2)
	if _puffs == null:
		var q := QuadMesh.new()
		_puff_mat = ShaderMaterial.new()
		_puff_mat.shader = load("res://shaders/reach/mist.gdshader")
		_puff_mat.render_priority = 5
		q.material = _puff_mat
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = q
		mm.instance_count = PUFFS
		_puffs = MultiMeshInstance3D.new()
		_puffs.multimesh = mm
		_puffs.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_puffs)
	_puffs.visible = mist > 0.01
	if not _puffs.visible:
		return
	# Laid in the world's own space, so the sheets stay put as you move.
	if _puffs.get_parent() != b.node:
		_puffs.reparent(b.node, false)
		_laid_at = Vector3.INF
	var local := b.node.global_transform.affine_inverse() * cam.global_position
	if b.key != _laid_on or local.distance_to(_laid_at) > 35.0:
		_laid_on = b.key
		_laid_at = local
		_lay(b, local)
	var e: Environment = reach.env
	var c: Color = e.ambient_light_color * (0.45 + e.ambient_light_energy * 1.1) + reach.sun.light_color * reach.sun.light_energy * 0.22
	_puff_mat.set_shader_parameter("tint", Color(c.r, c.g, c.b).lerp(e.fog_light_color, 0.3))
	_puff_mat.set_shader_parameter("amount", mist)

func _lay(b: ReachBody, at: Vector3) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(at.x * 0.03) * 73856093 ^ int(at.y * 0.03) * 19349663 ^ int(at.z * 0.03) * 83492791
	var up := at.normalized()
	var mm := _puffs.multimesh
	for i in PUFFS:
		var best := Vector3.ZERO
		var best_h := INF
		for k in 3:
			var ang := rng.randf() * TAU
			var dist := rng.randf_range(16.0, 95.0)
			var side := up.cross(Vector3.UP if absf(up.y) < 0.9 else Vector3.RIGHT).normalized().rotated(up, ang)
			var d := up.rotated(up.cross(side).normalized(), -dist / b.radius)
			var h := Worlds.height(b.key, d, b.radius)
			if b.sea != 0.0:
				h = maxf(h, b.sea)
			if h < best_h:
				best_h = h
				best = d
		var w := rng.randf_range(30.0, 52.0)
		var tall := rng.randf_range(7.0, 11.0)
		# Scaled along its own axes (Basis.scaled would scale the world's).
		var u := Site.upright(best, Vector3.FORWARD)
		var basis := Basis(u.x * w, u.y * tall, u.z * w)
		mm.set_instance_transform(i, Transform3D(basis, best * (b.radius + best_h - tall * 0.2)))
		mm.set_instance_custom_data(i, Color(rng.randf(), 0, 0, 0))
	_puffs.custom_aabb = AABB(at - Vector3.ONE * 160.0, Vector3.ONE * 320.0)

func _soak(w: float) -> void:
	var p := reach.planets.get(_wet_on) as Planet
	if p:
		p.soak(w)

## The streaks: a box that goes with the camera, upright on the world,
## the shower drifting through it.
func _fall(cam: Camera3D, dt: float, b: ReachBody, under: bool) -> void:
	_drops.visible = rain > 0.01 and cam != null and not under
	if not _drops.visible:
		return
	var up := (cam.global_position - b.node.global_position).normalized()
	var x := up.cross(Vector3.FORWARD if absf(up.z) < 0.9 else Vector3.RIGHT).normalized()
	var basis := Basis(x, up, x.cross(up))
	# Where the camera went since last frame, in the box's own axes, so
	# the rain stays in the world as you walk or fly through it.
	var moved := cam.global_position - _last
	_last = cam.global_position
	if moved.length() < 60.0:
		_drift -= moved * basis
	var wind := Vector3(1.6, -10.5, 0.7)
	_drift += wind * dt
	_drops.global_transform = Transform3D(basis, cam.global_position)
	# A roof or the canopy overhead keeps it off (looked for a few times
	# a second; the answer eases across).
	_cover_t -= dt
	if _cover_t <= 0.0:
		_cover_t = 0.3
		var q := PhysicsRayQueryParameters3D.create(cam.global_position + up * 0.3, cam.global_position + up * 40.0)
		if reach.player:
			q.exclude = [reach.player.get_rid()]
		_under = not get_world_3d().direct_space_state.intersect_ray(q).is_empty()
	_covered = move_toward(_covered, 1.0 if _under else 0.0, dt * 2.5)
	_mat.set_shader_parameter("drift", _drift)
	_mat.set_shader_parameter("amount", rain)
	_mat.set_shader_parameter("fall", wind.normalized())
	_mat.set_shader_parameter("keep_off", _covered * 3.2)
	var e: Environment = reach.env
	_mat.set_shader_parameter("tone", Color(0.85, 0.9, 1.0) * clampf(0.5 + e.ambient_light_energy * 1.6 + reach.sun.light_energy * 0.3, 0.4, 1.3))

func _sound(dt: float, under: bool) -> void:
	var open := rain * (1.0 - _covered) * (0.0 if under else 1.0)
	var roof := rain * _covered * (0.0 if under else 1.0)
	var k := minf(1.0, dt * 3.0)
	_rain_sound.volume_db = lerpf(_rain_sound.volume_db, linear_to_db(maxf(open, 0.0001)) - 12.0 + Flow.sfx_db(), k)
	_roof_sound.volume_db = lerpf(_roof_sound.volume_db, linear_to_db(maxf(roof, 0.0001)) - 10.0 + Flow.sfx_db(), k)

## In the heavy of a front, lightning: a doubled flash, and the thunder a
## few seconds behind it.
func _lightning(dt: float, key: String, t: float) -> void:
	flash = maxf(0.0, flash - dt * 5.0)
	if _thunder_in > 0.0:
		_thunder_in -= dt
		if _thunder_in <= 0.0:
			_thunder.volume_db = -7.0 + Flow.sfx_db() + linear_to_db(maxf(rain, 0.05))
			_thunder.pitch_scale = randf_range(0.8, 1.1)
			_thunder.play()
	if rain_at(key, t) < 0.8 or cloud < 0.5:
		return
	_next_strike -= dt
	if _next_strike <= 0.0:
		_next_strike = randf_range(11.0, 26.0)
		strike()

## One stroke now.
func strike() -> void:
	strikes += 1
	flash = 1.0
	_thunder_in = randf_range(0.6, 3.5)
	# The second, weaker flicker of the same stroke.
	get_tree().create_timer(0.16).timeout.connect(func(): flash = maxf(flash, 0.6))

## Rain as sound: a hiss of many small drops with the nearer ones ticking
## over it; under a roof, lower and drummed.
static func _rain_stream(roof: bool) -> AudioStreamWAV:
	var rate := 22050
	var n := rate * 4
	var data := PackedByteArray()
	data.resize(n * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 12 if roof else 11
	var lp := 0.0
	var hp := 0.0
	var tick := 0.0
	var body := 0.0
	for i in n:
		var x := rng.randf() * 2.0 - 1.0
		# The hiss: noise with the bottom taken out.
		lp += (x - lp) * (0.18 if roof else 0.55)
		hp += (lp - hp) * 0.02
		var v := (lp - hp) * (1.6 if roof else 0.9)
		# Single drops landing near.
		if rng.randf() < (0.004 if roof else 0.0025):
			tick = rng.randf_range(0.3, 1.0)
		tick *= 0.985 if roof else 0.93
		body += (x * tick - body) * (0.08 if roof else 0.5)
		v += body * (2.4 if roof else 0.8)
		# Ease the ends into each other so the loop has no click.
		var edge := minf(1.0, minf(float(i), float(n - i)) / 600.0)
		data.encode_s16(i * 2, int(clampf(v * edge, -1.0, 1.0) * 22000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s

## Thunder: a crack, then the long roll of it coming back off the hills.
static func _thunder_stream() -> AudioStreamWAV:
	var rate := 11025
	var n := rate * 5
	var data := PackedByteArray()
	data.resize(n * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var lp := 0.0
	var lp2 := 0.0
	for i in n:
		var t := float(i) / rate
		var x := rng.randf() * 2.0 - 1.0
		lp += (x - lp) * lerpf(0.5, 0.03, clampf(t / 0.5, 0.0, 1.0))
		lp2 += (lp - lp2) * 0.12
		var roll := 0.55 + 0.45 * sin(t * 9.0 + sin(t * 2.3) * 3.0)
		var env := exp(-t * 0.9) * minf(1.0, t / 0.012)
		var v := (lp * 1.2 * exp(-t * 6.0) + lp2 * 7.0 * roll) * env
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 26000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	return s
