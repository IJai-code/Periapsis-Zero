class_name Campfire
extends Node3D
## A campfire: a ring of stones, crossed logs, flames that lick and flicker,
## sparks going up, a warm light that breathes. Placed with its up along
## the body's up.

var _light: OmniLight3D
var _t := 0.0

func _ready() -> void:
	var stone := Props.mesh("rock")
	for i in 9:
		var a := TAU * i / 9.0
		var mi := MeshInstance3D.new()
		mi.mesh = stone
		mi.material_override = Props.material()
		mi.position = Vector3(cos(a) * 0.75, 0.05, sin(a) * 0.75)
		mi.scale = Vector3(0.24, 0.2, 0.22)
		mi.rotation.y = a * 1.7
		add_child(mi)
	var bark := StandardMaterial3D.new()
	bark.albedo_color = Color(0.28, 0.18, 0.12)
	bark.roughness = 0.95
	for k in 4:
		var log := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.08
		c.bottom_radius = 0.1
		c.height = 1.0
		c.radial_segments = 7
		c.material = bark
		log.mesh = c
		var a := TAU * k / 4.0 + 0.4
		log.position = Vector3(cos(a) * 0.18, 0.28, sin(a) * 0.18)
		log.basis = Basis(Vector3(sin(a), 0, -cos(a)), 1.05) * Basis(Vector3.UP, a)
		add_child(log)
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

func _flames() -> void:
	Fx._materials()
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.55, 0.75)
	q.material = Fx._fire
	p.mesh = q
	p.amount = 16
	p.lifetime = 0.9
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
	c.add_point(Vector2(0, 0.6))
	c.add_point(Vector2(0.3, 1.0))
	c.add_point(Vector2(1, 0.2))
	p.scale_amount_curve = c
	p.color_ramp = Fx._ramp([Color(1.3, 0.75, 0.3, 0.9), Color(1.1, 0.42, 0.1, 0.75), Color(0.6, 0.14, 0.03, 0.4), Color(0.1, 0.03, 0.0, 0.0)])
	p.position = Vector3(0, 0.25, 0)
	add_child(p)
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
