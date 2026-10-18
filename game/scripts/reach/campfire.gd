class_name Campfire
extends Node3D
## A campfire: a ring of stones, crossed logs, flames that lick and flicker,
## sparks going up, a warm light that breathes. Placed with its up along
## the body's up.

var _light: OmniLight3D
var _solid: CollisionShape3D

## Solid only while its world is the frame's (it moves with the world when
## not, and nothing could walk into it then).
func solid(on: bool) -> void:
	if _solid:
		_solid.set_deferred("disabled", not on)
var _t := 0.0

func _ready() -> void:
	# Stones blackened inside, a bed of ash and char, split logs leaned into
	# a cone and burnt toward their tops (art/godot/hearth_valley.py).
	var model: Node3D = load("res://art/valley-campfire.glb").instantiate()
	Surfaces.apply(model)
	add_child(model)
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
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
	var embers := StandardMaterial3D.new()
	embers.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	embers.albedo_color = Color(3.0, 0.9, 0.25)
	var glow := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.22
	s.height = 0.18
	s.material = embers
	glow.mesh = s
	glow.position = Vector3(0, 0.08, 0)
	add_child(glow)
	_flames()
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.6, 0.3)
	_light.light_energy = 2.2
	_light.omni_range = 9.0
	_light.position = Vector3(0, 0.9, 0)
	_light.shadow_enabled = false
	add_child(_light)
	var crackle := AudioStreamPlayer3D.new()
	crackle.stream = _crackle()
	crackle.unit_size = 3.0
	crackle.max_distance = 22.0
	crackle.volume_db = -8.0
	crackle.position = Vector3(0, 0.4, 0)
	add_child(crackle)
	crackle.play()
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
	# Sit by it (FireRest): roast a marshmallow, or sleep.
	var use := Usable.sphere("Sit by the fire", 1.3)
	use.reach = 3.6
	use.position = Vector3(0, 0.5, 0)
	add_child(use)
	use.used.connect(func(by: Node): FireRest.sit(self, by as Explorer))

## The fire: a body of flame (many short-lived tongues, dimmer than the
## tonemapper's clipping point, so it reads as fire and not a white blob)
## and a hotter heart inside it.
func _flames() -> void:
	Fx._materials()
	var outer := _flame_emitter(22, 0.9, Vector2(0.42, 0.62))
	outer.color_ramp = Fx._ramp([Color(0.95, 0.44, 0.13, 0.85), Color(0.8, 0.26, 0.05, 0.7),
		Color(0.42, 0.1, 0.02, 0.36), Color(0.06, 0.02, 0.0, 0.0)])
	var core := _flame_emitter(7, 0.45, Vector2(0.24, 0.34))
	core.color_ramp = Fx._ramp([Color(1.5, 0.78, 0.3, 0.8), Color(1.15, 0.45, 0.1, 0.6), Color(0.2, 0.05, 0.0, 0.0)])
	core.position = Vector3(0, 0.18, 0)
	# The light it throws on the ground, as a soft disc: fire is a lamp.
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
	var sparks := CPUParticles3D.new()
	var sq := QuadMesh.new()
	sq.size = Vector2(0.04, 0.04)
	sq.material = Fx._spark
	sparks.mesh = sq
	sparks.amount = 10
	sparks.lifetime = 2.2
	sparks.local_coords = true
	sparks.direction = Vector3.UP
	sparks.spread = 18.0
	sparks.gravity = Vector3(0.1, 0.6, 0)
	sparks.initial_velocity_min = 0.8
	sparks.initial_velocity_max = 1.8
	sparks.color_ramp = Fx._ramp([Color(4, 2, 0.6, 1), Color(3, 0.8, 0.2, 0.8), Color(1, 0.2, 0, 0)])
	sparks.position = Vector3(0, 0.4, 0)
	add_child(sparks)

func _process(dt: float) -> void:
	_t += dt
	# Its light only matters to what is near it: off from the air, or the
	# far side of the valley, it is a whole village light saved.
	var cam := get_viewport().get_camera_3d()
	var lit := true
	if cam:
		lit = cam.global_position.distance_squared_to(global_position) < 3600.0
	_light.visible = lit
	if lit:
		_light.light_energy = 2.0 + 0.35 * sin(_t * 7.3) * sin(_t * 3.1 + 1.0) + 0.15 * sin(_t * 17.0)

## Crackle: sparse sharp pops over a soft roar, looping.
static func _crackle() -> AudioStreamWAV:
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
