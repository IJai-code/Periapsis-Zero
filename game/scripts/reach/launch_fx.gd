class_name LaunchFx
extends Node3D
## The dust and smoke of a lift-off. A blast of grit thrown off the deck, a
## slow column of smoke that hangs where she stood, sparks, and a light on
## the ground: the things that make 4,000 tonnes leaving feel like it.
##
## CPU particles and billboards throughout, so the browser draws the same
## thing. One node, freed by itself when it has burned out.

const LIFE := 7.0

static var _dust: StandardMaterial3D
static var _hot: StandardMaterial3D

## Billboards that catch the light (the deck's, the engine's own): dust is
## darker at night, warm in the Lantern's last hour.
static func dust_material() -> StandardMaterial3D:
	if _dust:
		return _dust
	_dust = StandardMaterial3D.new()
	_dust.albedo_texture = _soft()
	_dust.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_dust.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_dust.vertex_color_use_as_albedo = true
	_dust.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_dust.disable_receive_shadows = true
	_dust.roughness = 1.0
	return _dust

static func hot_material() -> StandardMaterial3D:
	if _hot:
		return _hot
	_hot = StandardMaterial3D.new()
	_hot.albedo_texture = _soft()
	_hot.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_hot.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_hot.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_hot.vertex_color_use_as_albedo = true
	_hot.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_hot.disable_receive_shadows = true
	return _hot

## A soft round puff, made once: a hard-edged particle quad is the thing
## that reads as a placeholder.
static var _puff: GradientTexture2D

static func _soft() -> GradientTexture2D:
	if _puff:
		return _puff
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.45, 0.78, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.72), Color(1, 1, 1, 0.22), Color(1, 1, 1, 0)])
	_puff = GradientTexture2D.new()
	_puff.gradient = g
	_puff.fill = GradientTexture2D.FILL_RADIAL
	_puff.fill_from = Vector2(0.5, 0.5)
	_puff.fill_to = Vector2(1.0, 0.5)
	_puff.width = 64
	_puff.height = 64
	return _puff

## `at` is the deck under the nozzles; `up` the way she is pointed.
static func make(world: Node3D, at: Vector3, up: Vector3, size := 1.0) -> LaunchFx:
	var f := LaunchFx.new()
	f.add_to_group("launch_fx")
	world.add_child(f)
	var y := up.normalized()
	var x := y.cross(Vector3.RIGHT if absf(y.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD).normalized()
	f.global_transform = Transform3D(Basis(x, y, x.cross(y).normalized()), at)
	f._build(size)
	f.get_tree().create_timer(LIFE).timeout.connect(f.queue_free)
	return f

func _build(size: float) -> void:
	var lo := Flow.fx_low()
	var k := size
	# Grit thrown off the deck: fast, flat, settling.
	var dust := _emitter(self, dust_material(), int(46 * (0.5 if lo else 1.0) * k), 2.6, Vector3(6.0, 0.6, 2.4), 26.0, 1.5, k)
	dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	dust.emission_sphere_radius = 1.9 * k
	dust.flatness = 1.0
	dust.direction = Vector3.UP
	dust.spread = 82.0
	dust.initial_velocity_min = 9.0 * k
	dust.initial_velocity_max = 22.0 * k
	dust.gravity = Vector3(0, -2.2, 0)
	dust.damping_min = 6.0
	dust.damping_max = 13.0
	dust.scale_amount_min = 0.8
	dust.scale_amount_max = 1.7
	dust.color_ramp = _ramp([Color(0.62, 0.53, 0.42, 0.0), Color(0.62, 0.53, 0.42, 0.55),
		Color(0.52, 0.45, 0.37, 0.34), Color(0.42, 0.37, 0.32, 0.0)])
	# The column that stays behind: slower, higher, longer lived.
	var smoke := _emitter(self, dust_material(), int(18 * (0.55 if lo else 1.0) * k), 4.6, Vector3(1.2, 3.2, 1.2), 7.0, 3.0, k)
	smoke.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	smoke.emission_sphere_radius = 2.3 * k
	smoke.flatness = 0.8
	smoke.direction = Vector3.UP
	smoke.spread = 34.0
	smoke.initial_velocity_min = 1.4
	smoke.initial_velocity_max = 4.6
	smoke.gravity = Vector3(0, 0.5, 0)
	smoke.damping_min = 0.4
	smoke.damping_max = 1.2
	smoke.scale_amount_min = 1.2
	smoke.scale_amount_max = 2.4
	smoke.color_ramp = _ramp([Color(0.5, 0.46, 0.42, 0.0), Color(0.46, 0.42, 0.38, 0.4),
		Color(0.36, 0.34, 0.32, 0.26), Color(0.3, 0.29, 0.28, 0.0)])
	# Sparks: what the grit catches of the plume.
	var sparks := _emitter(self, hot_material(), int(22 * k), 1.5, Vector3(3, 1, 3), 17.0, 0.16, k)
	sparks.spread = 70.0
	sparks.direction = Vector3.UP
	sparks.initial_velocity_min = 8.0
	sparks.initial_velocity_max = 24.0
	sparks.gravity = Vector3(0, -6.0, 0)
	sparks.color_ramp = _ramp([Color(5.0, 2.6, 1.0, 1.0), Color(3.0, 0.9, 0.16, 0.9), Color(1.0, 0.2, 0.0, 0.0)])
	# The deck, scorched where she sat (it is a timber deck: it would).
	var scorch := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(3.4, 3.4) * k
	var m := StandardMaterial3D.new()
	m.albedo_texture = _soft()
	m.albedo_color = Color(0.06, 0.05, 0.045, 0.0)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.disable_receive_shadows = true
	q.material = m
	scorch.mesh = q
	scorch.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scorch.rotation = Vector3(-PI / 2.0, 0, 0)
	scorch.position = Vector3(0, 0.05, 0)
	add_child(scorch)
	create_tween().tween_property(m, "albedo_color:a", 0.55, 0.35)
	create_tween().tween_property(m, "albedo_color:a", 0.0, 5.0).set_delay(2.0)

## Setting down: a ring of grit thrown out from under the gear and a low
## puff that settles. Small, quick and gone — a lift-off seen backwards.
## `strength` follows how hard she came down.
static func land(world: Node3D, at: Vector3, up: Vector3, strength := 1.0) -> void:
	var f := LaunchFx.new()
	f.add_to_group("launch_fx")
	world.add_child(f)
	var y := up.normalized()
	var x := y.cross(Vector3.RIGHT if absf(y.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD).normalized()
	f.global_transform = Transform3D(Basis(x, y, x.cross(y).normalized()), at)
	var k := clampf(strength, 0.2, 2.0)
	var lo := Flow.fx_low()
	var ring := f._emitter(f, dust_material(), int(20 * (0.5 if lo else 1.0) * k), 1.9, Vector3(0.7, -0.35, 0.7), 4.4 * k, 0.55 * k, k)
	ring.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	ring.emission_ring_axis = Vector3.UP
	ring.emission_ring_radius = 1.5 * k
	ring.emission_ring_inner_radius = 0.7 * k
	ring.emission_ring_height = 0.1
	ring.flatness = 0.9
	ring.direction = Vector3.UP
	ring.spread = 88.0
	ring.initial_velocity_min = 2.2 * k
	ring.initial_velocity_max = 6.5 * k
	ring.damping_min = 2.4
	ring.damping_max = 4.2
	ring.scale_amount_min = 0.4
	ring.scale_amount_max = 1.0
	ring.color_ramp = _ramp([Color(0.6, 0.53, 0.44, 0.0), Color(0.6, 0.53, 0.44, 0.5),
		Color(0.5, 0.45, 0.38, 0.22), Color(0.45, 0.41, 0.36, 0.0)])
	f.get_tree().create_timer(2.4).timeout.connect(f.queue_free)

## A one-shot burst: the shared shape of every puff here.
func _emitter(parent: Node3D, mat: Material, amount: int, life: float, gravity: Vector3, speed: float, size: float, k: float) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * size
	q.material = mat
	p.mesh = q
	p.amount = maxi(amount, 3)
	p.lifetime = life
	p.one_shot = true
	p.explosiveness = 0.92
	p.local_coords = false
	p.gravity = gravity
	p.angle_min = 0.0
	p.angle_max = 360.0
	p.initial_velocity_min = speed * 0.35
	p.initial_velocity_max = speed
	var c := Curve.new()
	c.add_point(Vector2(0.0, 0.35))
	c.add_point(Vector2(0.22, 1.0))
	c.add_point(Vector2(1.0, 2.1))
	p.scale_amount_curve = c
	p.emitting = true
	parent.add_child(p)
	return p

static func _ramp(colors: Array) -> Gradient:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array(range(colors.size()).map(func(i): return float(i) / maxf(colors.size() - 1, 1)))
	g.colors = PackedColorArray(colors)
	return g

## Compile the shaders and the particle materials before the first lift-off
## needs them: in a browser the first draw of a new material is a stall of a
## tenth of a second or worse, and it would land exactly at ignition. Tiny
## and out of the way, on screen, for a fifth of a second.
static func warm(world: Node3D, at: Vector3) -> void:
	var f := make(world, at, Vector3.UP, 0.03)
	# Its dust and its landing ring too, so a touchdown costs nothing new.
	land(world, at + Vector3.UP * 0.02, Vector3.UP, 0.03)
	f.get_tree().create_timer(0.2).timeout.connect(f.queue_free)

