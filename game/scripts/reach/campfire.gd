class_name Campfire
extends Node3D
## A campfire: a ring of stones, crossed logs, flames that lick and flicker,
## sparks going up, a warm light that breathes. Placed with its up along
## the body's up.
##
## The fire has a life of its own: the twigs catch first and are gone in a
## couple of minutes, the logs char, sink and burn away over the first
## fifteen, and what is left is a bed of embers for the rest of the loop.
## It is paced by the loop's own clock, so sleeping by it (which runs the
## clock fast) burns it down while you sleep, and a new morning puts it
## back: the art is always the freshly lit campfire.

## Seconds of the loop a fresh fire burns for. The loop is 22 minutes, so
## the last seven are embers and a low red light.
const BURN := 900.0
## Where a log gives way and drops into the ash (fraction of BURN).
const SETTLE_AT := 0.58

var far_k := 1.0
var _light: OmniLight3D
var _solid: CollisionShape3D

## Solid only while its world is the frame's (it moves with the world when
## not, and nothing could walk into it then).
func solid(on: bool) -> void:
	if _solid:
		_solid.set_deferred("disabled", not on)
var _t := 0.0

# The pieces of the model that burn. Their materials are the shared scanned
# ones (Surfaces cache), so each is duplicated here to char on its own.
var _logs: MeshInstance3D
var _ends: MeshInstance3D
var _twigs: MeshInstance3D
var _ash: MeshInstance3D
var _log_mat: ShaderMaterial
var _ends_mat: ShaderMaterial
var _twig_mat: ShaderMaterial
var _ash_mat: ShaderMaterial
var _log_base := Color.WHITE
var _ends_base := Color.WHITE
var _ash_base := Color.WHITE
var _logs_home := Transform3D.IDENTITY
var _ends_home := Transform3D.IDENTITY
var _twigs_home := Transform3D.IDENTITY
var _ash_home := Transform3D.IDENTITY
var _outer: CPUParticles3D
var _core: CPUParticles3D
var _sparks: CPUParticles3D
var _smoke: CPUParticles3D
var _ember: MeshInstance3D
var _ember_mat: StandardMaterial3D
var _crackle: AudioStreamPlayer3D
var _song: AudioStreamPlayer3D
var _system: ReachSystem
var _reach
var _settled := false
var _last_t := 0.0

func _ready() -> void:
	# Stones blackened inside, a bed of ash and char, split logs leaned into
	# a cone and burnt toward their tops (art/godot/hearth_valley.py).
	var model: Node3D = load("res://art/valley-campfire.glb").instantiate()
	Surfaces.apply(model)
	add_child(model)
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_logs = model.find_child("campfire_logs", true, false) as MeshInstance3D
	_ends = model.find_child("campfire_logends", true, false) as MeshInstance3D
	_twigs = model.find_child("campfire_twigs", true, false) as MeshInstance3D
	_ash = model.find_child("campfire_ash", true, false) as MeshInstance3D
	# One material each: the surfaces' own, duplicated, so charring the logs
	# does not blacken every other campfire and log bench in the Reach.
	_log_mat = _own(_logs)
	_ends_mat = _own(_ends)
	_twig_mat = _own(_twigs)
	_ash_mat = _own(_ash)
	_log_base = _tint_of(_log_mat)
	_ends_base = _tint_of(_ends_mat)
	_ash_base = _tint_of(_ash_mat)
	if _logs: _logs_home = _logs.transform
	if _ends: _ends_home = _ends.transform
	if _twigs: _twigs_home = _twigs.transform
	if _ash: _ash_home = _ash.transform
	# Solid: a low drum the size of the ring, so the fire is walked round,
	# not through.
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = 0.98
	cyl.height = 0.9
	cs.shape = cyl
	cs.position = Vector3(0, 0.3, 0)
	body.add_child(cs)
	add_child(body)
	_solid = cs
	_ember_mat = StandardMaterial3D.new()
	_ember_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_ember_mat.albedo_color = Color(3.0, 0.9, 0.25)
	_ember = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.22
	s.height = 0.18
	s.material = _ember_mat
	_ember.mesh = s
	_ember.position = Vector3(0, 0.08, 0)
	_ember.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ember)
	_flames()
	_smoke_plume()
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.6, 0.3)
	_light.light_energy = 2.2
	_light.omni_range = 9.0
	_light.position = Vector3(0, 0.9, 0)
	_light.shadow_enabled = false
	add_child(_light)
	var crackle := AudioStreamPlayer3D.new()
	crackle.stream = _crackle_stream()
	crackle.unit_size = 3.0
	crackle.max_distance = 22.0
	crackle.volume_db = -8.0
	crackle.position = Vector3(0, 0.4, 0)
	add_child(crackle)
	crackle.play()
	_crackle = crackle
	# Mara's banjo, drifting across the village: quiet enough to be part of
	# the evening, loud enough to find your way back by. Looped at run time
	# (the file is a phrase, not a loop).
	var wav := load("res://audio/reach/banjo.wav") as AudioStreamWAV
	if wav:
		var song := AudioStreamPlayer3D.new()
		var loop := wav.duplicate() as AudioStreamWAV
		loop.loop_mode = AudioStreamWAV.LOOP_FORWARD
		loop.loop_end = int(loop.get_length() * loop.mix_rate)
		song.stream = loop
		song.unit_size = 7.0
		song.max_distance = 55.0
		song.volume_db = -21.0 + Flow.music_db()
		song.position = Vector3(0, 0.7, 0)
		add_child(song)
		song.play()
		_song = song
	# Sit by it (FireRest): roast a marshmallow, or sleep.
	var use := Usable.sphere("Sit by the fire", 1.3)
	use.reach = 3.6
	use.position = Vector3(0, 0.5, 0)
	add_child(use)
	use.used.connect(func(by: Node): FireRest.sit(self, by as Explorer))

## The first surface material of a mesh, duplicated so it can be changed
## without changing the shared original.
func _own(mi: MeshInstance3D) -> ShaderMaterial:
	if not mi or not mi.mesh:
		return null
	var kept: ShaderMaterial = null
	for i in mi.mesh.get_surface_count():
		var m := mi.get_surface_override_material(i)
		if m is ShaderMaterial:
			var c := (m as ShaderMaterial).duplicate() as ShaderMaterial
			mi.set_surface_override_material(i, c)
			if kept == null:
				kept = c
	return kept

static func _tint_of(m: ShaderMaterial) -> Color:
	var c = m.get_shader_parameter("tint") if m else null
	return c if c is Color else Color.WHITE

## The fire: a body of flame (many short-lived tongues, dimmer than the
## tonemapper's clipping point, so it reads as fire and not a white blob)
## and a hotter heart inside it, sparks, and the light it throws on the
## ground as a soft disc: fire is a lamp.
func _flames() -> void:
	Fx._materials()
	_outer = _flame_emitter(22, 0.9, Vector2(0.42, 0.62))
	_outer.color_ramp = Fx._ramp([Color(0.95, 0.44, 0.13, 0.85), Color(0.8, 0.26, 0.05, 0.7),
		Color(0.42, 0.1, 0.02, 0.36), Color(0.06, 0.02, 0.0, 0.0)])
	_core = _flame_emitter(7, 0.45, Vector2(0.24, 0.34))
	_core.color_ramp = Fx._ramp([Color(1.5, 0.78, 0.3, 0.8), Color(1.15, 0.45, 0.1, 0.6), Color(0.2, 0.05, 0.0, 0.0)])
	_core.position = Vector3(0, 0.18, 0)
	# Sparks: a puff when a log shifts, and a thin stream while it is hot.
	_sparks = CPUParticles3D.new()
	var sq := QuadMesh.new()
	sq.size = Vector2(0.04, 0.04)
	sq.material = Fx._spark
	_sparks.mesh = sq
	_sparks.amount = 12
	_sparks.lifetime = 2.2
	_sparks.local_coords = true
	_sparks.explosiveness = 0.15
	_sparks.direction = Vector3.UP
	_sparks.spread = 16.0
	_sparks.gravity = Vector3(0.1, 0.6, 0)
	_sparks.initial_velocity_min = 0.8
	_sparks.initial_velocity_max = 1.8
	_sparks.color_ramp = Fx._ramp([Color(4, 2, 0.6, 1), Color(3, 0.8, 0.2, 0.8), Color(1, 0.2, 0, 0)])
	_sparks.position = Vector3(0, 0.4, 0)
	_sparks.emitting = false
	add_child(_sparks)
	var glow := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(4.2, 4.2)
	var m := LaunchFx.dust_material().duplicate() as StandardMaterial3D
	m.albedo_color = Color(1.0, 0.5, 0.18, 0.22)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_DISABLED
	q.material = m
	glow.mesh = q
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	glow.rotation = Vector3(-PI / 2.0, 0, 0)
	glow.position = Vector3(0, 0.06, 0)
	add_child(glow)

func _flame_emitter(amount: int, life: float, size: Vector2) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = size
	q.material = Fx._fire
	p.mesh = q
	p.amount = amount
	p.lifetime = life
	p.local_coords = true
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.18
	p.direction = Vector3.UP
	p.spread = 8.0
	p.gravity = Vector3(0, 1.4, 0)
	p.initial_velocity_min = 0.4
	p.initial_velocity_max = 0.9
	p.scale_amount_min = 0.7
	p.scale_amount_max = 1.2
	var c := Curve.new()
	c.add_point(Vector2(0, 0.55))
	c.add_point(Vector2(0.3, 1.0))
	c.add_point(Vector2(1, 0.15))
	p.scale_amount_curve = c
	p.position = Vector3(0, 0.25, 0)
	add_child(p)
	return p

## A thin grey column off the flames, leaning with the valley's air.
func _smoke_plume() -> void:
	var mat := Fx._smoke.duplicate() as ShaderMaterial
	mat.set_shader_parameter("smoke", 1.0)
	mat.set_shader_parameter("heat", 0.0)
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.1, 1.1)
	q.material = mat
	p.mesh = q
	p.amount = 7
	p.lifetime = 7.0
	p.local_coords = true
	p.direction = Vector3.UP
	p.spread = 7.0
	p.gravity = Vector3(0.05, 0.09, 0.0)
	p.initial_velocity_min = 0.18
	p.initial_velocity_max = 0.34
	p.scale_amount_min = 0.35
	p.scale_amount_max = 0.6
	var c := Curve.new()
	c.add_point(Vector2(0, 0.3))
	c.add_point(Vector2(0.25, 0.8))
	c.add_point(Vector2(1, 2.4))
	p.scale_amount_curve = c
	p.color_ramp = Fx._ramp([Color(0.24, 0.22, 0.2, 0.0), Color(0.3, 0.28, 0.26, 0.3),
		Color(0.34, 0.32, 0.3, 0.16), Color(0.3, 0.3, 0.3, 0.0)])
	p.position = Vector3(0, 1.05, 0)
	add_child(p)
	_smoke = p

## The loop's clock (or, with no Reach about, this fire's own).
func _clock() -> float:
	if _system == null or not is_instance_valid(_system):
		_reach = get_tree().get_first_node_in_group("reach_root")
		_system = _reach.system if _reach and _reach.system else null
	return _system.t if _system else _t

func _process(dt: float) -> void:
	_t += dt
	var t := _clock()
	# Waking again: a new morning, and a fresh fire.
	if t < _last_t - 5.0:
		_settled = false
	_last_t = t
	var k := clampf(t / BURN, 0.0, 1.0)
	var heat := 1.0 - smoothstep(0.28, 0.92, k)
	_burned(k)
	_fire_look(heat, k)
	# A log gives way, once, with a little shower of sparks. Close enough to
	# hear it, and to see the ash jump.
	if not _settled and k >= SETTLE_AT:
		_settled = true
		Sfx.play("step", -9.0, 0.5)
		_spark_burst()
		if _reach == null:
			_reach = get_tree().get_first_node_in_group("reach_root")
		if _reach and _reach.player and _reach.hud and global_position.distance_to(_reach.player.global_position) < 14.0:
			_reach.hud.caption("A log gives way and settles into the ash.", 2.6)
	# Its light only matters to what is near it: off from the air, or the
	# far side of the valley, it is a whole village light saved.
	var cam := get_viewport().get_camera_3d()
	var lit := true
	if cam:
		var d := cam.global_position.distance_to(global_position)
		lit = d < 62.0
		# Faded out with distance, not switched off at it.
		far_k = smoothstep(62.0, 45.0, d)
	_light.visible = lit
	if lit:
		# A gentle breathing, not a flicker that lights the whole village.
		_light.light_energy = (0.25 + 1.95 * heat) * far_k * (1.0 + 0.07 * sin(_t * 4.1) * sin(_t * 1.7 + 1.0) + 0.03 * sin(_t * 9.0))
		_light.light_color = Color(1.0, 0.62, 0.32).lerp(Color(1.0, 0.27, 0.1), 1.0 - heat)
		_light.omni_range = 4.0 + 5.0 * heat
	if _crackle:
		_crackle.volume_db = -60.0 if heat <= 0.02 else -8.0 + 9.0 * log(heat)

## The logs, twigs and ash as they burn: twigs go first, the logs char and
## sink into the bed, the ash spreads, and the glow in it cools.
func _burned(k: float) -> void:
	var eaten := smoothstep(0.04, 0.92, k)
	var char := smoothstep(0.04, 0.78, k)
	var sink := Vector3(1.0, lerpf(1.0, 0.46, eaten), 1.0)
	sink.x = lerpf(1.0, 0.86, eaten)
	sink.z = sink.x
	if _logs:
		_logs.transform = Transform3D(_logs_home.basis * Basis.from_scale(sink), _logs_home.origin - Vector3(0, 0.03 * eaten, 0))
	if _ends:
		_ends.transform = Transform3D(_ends_home.basis * Basis.from_scale(sink), _ends_home.origin - Vector3(0, 0.03 * eaten, 0))
	if _twigs:
		var left := 1.0 - smoothstep(0.0, 0.26, k)
		_twigs.visible = left > 0.02
		_twigs.transform = Transform3D(_twigs_home.basis * Basis.from_scale(Vector3.ONE * maxf(left, 0.02)), _twigs_home.origin)
	if _ash:
		var spread := lerpf(0.92, 1.14, eaten)
		_ash.transform = Transform3D(_ash_home.basis * Basis.from_scale(Vector3(spread, 1.0, spread)), _ash_home.origin)
		_tint(_ash_mat, _ash_base, Color(0.62, 0.55, 0.5), char)
	_tint(_log_mat, _log_base, Color(0.3, 0.26, 0.23), char)
	# The ends keep their own hot glow for longer than the bark does.
	_tint(_ends_mat, _ends_base, Color(0.24, 0.19, 0.16), smoothstep(0.2, 0.95, k))

static func _tint(m: ShaderMaterial, base: Color, to: Color, k: float) -> void:
	if m:
		var c := Color(base.r, base.g, base.b).lerp(Color(base.r * to.r, base.g * to.g, base.b * to.b), k)
		m.set_shader_parameter("tint", c)

## Flames, embers, sparks and smoke at a given heat: a full fire at 1, a
## bed of embers at 0.
func _fire_look(heat: float, k: float) -> void:
	if _outer:
		_outer.emitting = heat > 0.05
		_outer.scale = Vector3.ONE * (0.4 + 0.6 * heat)
	if _core:
		_core.emitting = heat > 0.12
		_core.scale = Vector3.ONE * (0.35 + 0.65 * heat)
	if _ember_mat:
		_ember_mat.albedo_color = Color(3.0, 0.9, 0.25) * (0.3 + 0.7 * heat)
	if _ember:
		_ember.scale = Vector3.ONE * (0.78 + 0.22 * heat)
	if _smoke:
		_smoke.emitting = heat > 0.03
		_smoke.scale = Vector3.ONE * (0.7 + 0.3 * heat)
	if _sparks and heat > 0.35 and not _sparks.emitting:
		# A thin continuous stream while it is hot; one-shot puffs still add.
		_sparks.emitting = true
	elif _sparks and heat <= 0.35:
		_sparks.emitting = false

## The little shower when a log drops: a one-shot puff beside the stream.
func _spark_burst() -> void:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.045, 0.045)
	q.material = Fx._spark
	p.mesh = q
	p.amount = 18
	p.lifetime = 1.8
	p.one_shot = true
	p.explosiveness = 0.9
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 30.0
	p.gravity = Vector3(0.2, 0.4, 0.0)
	p.initial_velocity_min = 1.2
	p.initial_velocity_max = 2.6
	p.color_ramp = Fx._ramp([Color(4, 2, 0.6, 1), Color(3, 0.8, 0.2, 0.7), Color(1, 0.2, 0, 0)])
	p.position = Vector3(0, 0.45, 0)
	add_child(p)
	p.emitting = true
	get_tree().create_timer(3.0).timeout.connect(p.queue_free)

## Crackle: sparse sharp pops over a soft roar, looping.
static func _crackle_stream() -> AudioStreamWAV:
	var rate := 22050
	var n := rate * 4
	var data := PackedByteArray()
	data.resize(n * 2)
	var lp := 0.0
	var pop := 0.0
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in n:
		lp += (rng.randf() * 2.0 - 1.0 - lp) * 0.04
		if rng.randf() < 0.0009:
			pop = rng.randf_range(0.4, 1.0)
		pop *= 0.986
		var v := lp * 0.5 + (rng.randf() * 2.0 - 1.0) * pop * 0.6
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 26000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s
