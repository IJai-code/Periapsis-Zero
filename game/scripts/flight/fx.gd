class_name Fx
## Explosions, sparks and debris, in CPU particles so the browser build draws
## them too. Every effect cleans itself up.

static var _puff: Texture2D

static func _texture() -> Texture2D:
	if _puff:
		return _puff
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	g.add_point(0.35, Color(1, 1, 1, 0.65))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 64
	t.height = 64
	_puff = t
	return t

static func _material(additive: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = _texture()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.no_depth_test = false
	return m

static func _burst(parent: Node3D, amount: int, life: float, speed: float, size: float, ramp: Gradient, additive: bool, spread := 180.0) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * size
	q.material = _material(additive)
	p.mesh = q
	p.amount = amount
	p.lifetime = life
	p.one_shot = true
	p.explosiveness = 0.92
	p.spread = spread
	p.direction = Vector3.UP
	p.initial_velocity_min = speed * 0.3
	p.initial_velocity_max = speed
	p.damping_min = speed * 0.4
	p.damping_max = speed * 0.8
	p.gravity = Vector3.ZERO
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.6
	var c := Curve.new()
	c.add_point(Vector2(0, 0.4))
	c.add_point(Vector2(0.25, 1.0))
	c.add_point(Vector2(1, 1.4))
	p.scale_amount_curve = c
	p.color_ramp = ramp
	p.emitting = true
	parent.add_child(p)
	return p

static func _ramp(colors: Array) -> Gradient:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array(range(colors.size()).map(func(i): return float(i) / (colors.size() - 1)))
	g.colors = PackedColorArray(colors)
	return g

## A ship-sized blast. `size` is roughly the fireball's radius in metres.
static func explode(world: Node3D, at: Vector3, size := 8.0, loud := true) -> void:
	var n := Node3D.new()
	world.add_child(n)
	n.global_position = at
	_burst(n, 28, 1.1, size * 2.2, size * 0.9, _ramp([Color(4, 3.2, 2.2, 1), Color(3, 1.2, 0.3, 0.9), Color(0.6, 0.15, 0.05, 0.4), Color(0, 0, 0, 0)]), true)
	_burst(n, 18, 3.2, size * 1.2, size * 1.1, _ramp([Color(0.25, 0.22, 0.2, 0.0), Color(0.18, 0.16, 0.15, 0.55), Color(0.1, 0.1, 0.1, 0.0)]), false)
	_burst(n, 40, 1.6, size * 9.0, size * 0.12, _ramp([Color(6, 4, 2, 1), Color(3, 1, 0.2, 1), Color(1, 0.2, 0, 0)]), true)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.6, 0.3)
	light.light_energy = 16.0
	light.omni_range = size * 6.0
	n.add_child(light)
	n.create_tween().tween_property(light, "light_energy", 0.0, 0.9)
	n.get_tree().create_timer(4.0).timeout.connect(n.queue_free)
	if loud:
		Sfx.play("boom" if size < 20.0 else "big", 0.0 if size < 20.0 else 4.0, randf_range(0.85, 1.15))

## Sparks where a bolt hits a hull.
static func sparks(world: Node3D, at: Vector3, color := Color(4, 2.5, 1.2)) -> void:
	var n := Node3D.new()
	world.add_child(n)
	n.global_position = at
	_burst(n, 14, 0.5, 30.0, 0.5, _ramp([color, Color(color, 0.0)]), true)
	n.get_tree().create_timer(1.0).timeout.connect(n.queue_free)

## Tumbling wreckage flung out from a point.
static func debris(world: Node3D, at: Vector3, count: int, size: float, speed: float, material: Material) -> void:
	for i in count:
		var f := Fragment.new()
		var b := BoxMesh.new()
		b.size = Vector3(randf_range(0.3, 1.0), randf_range(0.1, 0.5), randf_range(0.4, 1.4)) * size
		b.material = material
		f.mesh = b
		world.add_child(f)
		f.global_position = at + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * size
		var dir := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized()
		f.velocity = dir * speed * randf_range(0.3, 1.0)
		f.spin = Vector3(randf_range(-2, 2), randf_range(-2, 2), randf_range(-2, 2))
