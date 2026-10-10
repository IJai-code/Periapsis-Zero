class_name Fx
## Explosions, impacts and wreckage. Fire is billboards torn by noise
## (shaders/fireball.gdshader), smoke is lit puffs, shockwaves are rings;
## ships come apart along their modelled pieces. CPU particles throughout,
## so the browser build draws the same thing.

static var _puff: Texture2D
static var _fire: ShaderMaterial
static var _smoke: ShaderMaterial
static var _spark: StandardMaterial3D

static func _materials() -> void:
	if _fire:
		return
	_fire = ShaderMaterial.new()
	_fire.shader = load("res://shaders/fireball.gdshader")
	_smoke = ShaderMaterial.new()
	_smoke.shader = load("res://shaders/smoke.gdshader")
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 32
	t.height = 32
	_puff = t
	_spark = StandardMaterial3D.new()
	_spark.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_spark.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_spark.vertex_color_use_as_albedo = true
	_spark.albedo_texture = _puff
	_spark.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_spark.blend_mode = BaseMaterial3D.BLEND_MODE_ADD

static func _ramp(colors: Array) -> Gradient:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array(range(colors.size()).map(func(i): return float(i) / (colors.size() - 1)))
	g.colors = PackedColorArray(colors)
	return g

static func _emitter(parent: Node3D, mat: Material, amount: int, life: float, speed: float, size: float, ramp: Gradient, one_shot := true) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * size
	q.material = mat
	p.mesh = q
	p.amount = amount
	p.lifetime = life
	p.one_shot = one_shot
	p.explosiveness = 0.95 if one_shot else 0.0
	p.spread = 180.0
	p.initial_velocity_min = speed * 0.25
	p.initial_velocity_max = speed
	p.damping_min = speed * 0.5
	p.damping_max = speed
	p.gravity = Vector3.ZERO
	p.angle_min = 0.0
	p.angle_max = 360.0
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.5
	var c := Curve.new()
	c.add_point(Vector2(0, 0.3))
	c.add_point(Vector2(0.2, 1.0))
	c.add_point(Vector2(1, 1.6))
	p.scale_amount_curve = c
	p.color_ramp = ramp
	p.emitting = true
	parent.add_child(p)
	return p

## A blast. `size` is the fireball's radius in metres; 6-10 a fighter,
## 40+ a freighter's reactor.
static func explode(world: Node3D, at: Vector3, size := 8.0, loud := true) -> void:
	_materials()
	var n := Node3D.new()
	world.add_child(n)
	n.global_position = at
	# The flash, the fireball, the sparks, the smoke. Big blasts stack more
	# additive layers on screen, so each layer is dimmer.
	var k := clampf(12.0 / size, 0.35, 1.0)
	_emitter(n, _fire, 3, 0.2, size * 0.4, size * 1.8, _ramp([Color(3.2 * k, 2.6 * k, 2.0 * k, 1), Color(2.4, 1.4, 0.6, 0)]))
	_emitter(n, _fire, 34, 1.5, size * 2.2, size * 1.2, _ramp([Color(2.6 * k, 1.7 * k, 0.8 * k, 1), Color(2.2 * k, 0.75 * k, 0.16 * k, 0.95), Color(1.1 * k, 0.24 * k, 0.04 * k, 0.7), Color(0.3, 0.05, 0.01, 0.35), Color(0.0, 0.0, 0.0, 0)]))
	_emitter(n, _spark, 90, 1.8, size * 10.0, clampf(size * 0.03, 0.18, 0.7), _ramp([Color(8, 5, 2, 1), Color(4, 1.4, 0.3, 1), Color(1, 0.2, 0, 0)]))
	var sm := _emitter(n, _smoke, 22, 5.5, size * 1.1, size * 1.6, _ramp([Color(0.12, 0.1, 0.09, 0.0), Color(0.09, 0.085, 0.08, 0.85), Color(0.07, 0.07, 0.07, 0.6), Color(0.05, 0.05, 0.05, 0.0)]))
	sm.explosiveness = 0.75
	_shockwave(n, size)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.65, 0.35)
	light.light_energy = 22.0
	light.omni_range = size * 7.0
	n.add_child(light)
	n.create_tween().tween_property(light, "light_energy", 0.0, 1.1).set_ease(Tween.EASE_OUT)
	n.get_tree().create_timer(6.0).timeout.connect(n.queue_free)
	if loud:
		Sfx.play("boom" if size < 20.0 else "big", 0.0 if size < 20.0 else 4.0, randf_range(0.85, 1.15))

static func _shockwave(n: Node3D, size: float) -> void:
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/ring.gdshader")
	q.material = m
	var ring := MeshInstance3D.new()
	ring.mesh = q
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(ring)
	var cam := n.get_viewport().get_camera_3d()
	if cam:
		ring.look_at(cam.global_position)
	ring.rotate_object_local(Vector3.RIGHT, randf_range(-0.5, 0.5))
	var t := n.create_tween().set_parallel()
	t.tween_property(ring, "scale", Vector3.ONE * size * 9.0, 0.7).from(Vector3.ONE * size).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	t.tween_method(func(v: float): m.set_shader_parameter("fade", v), 1.0, 0.0, 0.7)

## Where a bolt meets a hull: a spray of sparks and a quick hot spot.
static func sparks(world: Node3D, at: Vector3, color := Color(4, 2.5, 1.2)) -> void:
	_materials()
	var n := Node3D.new()
	world.add_child(n)
	n.global_position = at
	_emitter(n, _spark, 18, 0.45, 40.0, 0.35, _ramp([color * 1.5, Color(color, 0.0)]))
	_emitter(n, _fire, 2, 0.18, 2.0, 1.6, _ramp([Color(color.r, color.g, color.b, 1.0), Color(color, 0.0)]))
	n.get_tree().create_timer(1.0).timeout.connect(n.queue_free)

## A muzzle flash, parented to the gun so it moves with it.
static func muzzle(parent: Node3D, local: Vector3, color: Color) -> void:
	_materials()
	var n := Node3D.new()
	parent.add_child(n)
	n.position = local
	_emitter(n, _fire, 2, 0.07, 1.0, 1.4, _ramp([Color(color.r * 2.0, color.g * 2.0, color.b * 2.0, 1.0), Color(color, 0.0)]))
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = 3.0
	l.omni_range = 6.0
	n.add_child(l)
	n.get_tree().create_timer(0.08).timeout.connect(n.queue_free)

## A shield taking the hit: a shell round the ship, bright where it was struck.
static func shield_hit(ship: Node3D, radius: float, at: Vector3) -> void:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0
	s.radial_segments = 24
	s.rings = 12
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/shield.gdshader")
	m.set_shader_parameter("hit", ship.global_basis.inverse() * (at - ship.global_position))
	s.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = s
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ship.add_child(mi)
	var t := mi.create_tween()
	t.tween_method(func(v: float): m.set_shader_parameter("fade", v), 1.0, 0.0, 0.25)
	t.tween_callback(mi.queue_free)

## Smoke and fire streaming from a damaged ship (or a piece of one).
static func trail(parent: Node3D, fire := true) -> CPUParticles3D:
	_materials()
	var p := _emitter(parent, _smoke, 30, 2.6, 2.0, 2.4, _ramp([Color(0.25, 0.2, 0.18, 0.0), Color(0.15, 0.14, 0.14, 0.5), Color(0.1, 0.1, 0.1, 0.0)]), false)
	p.local_coords = false
	if fire:
		var f := _emitter(parent, _fire, 14, 0.5, 1.5, 1.6, _ramp([Color(3, 1.8, 0.6, 1), Color(1.5, 0.4, 0.05, 0.6), Color(0.2, 0.05, 0, 0)]), false)
		f.local_coords = false
	return p

## A ship coming apart: its modelled pieces (the children of the model's
## root) fly outward from the blast, tumbling, some trailing fire.
static func shatter(world: Node3D, model: Node3D, velocity: Vector3, force: float) -> void:
	var root := model
	while root.get_child_count() == 1 and root.get_child(0) is Node3D:
		root = root.get_child(0)
	var centre := model.global_position
	for piece: Node in root.get_children():
		if not piece is Node3D:
			continue
		var p := piece as Node3D
		var xf := p.global_transform
		p.get_parent().remove_child(p)
		world.add_child(p)
		p.global_transform = xf
		var d := Drift.new()
		var out := (p.global_position - centre)
		if out.length() < 0.5:
			out = Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1))
		d.velocity = velocity * 0.6 + out.normalized() * force * randf_range(0.5, 1.2)
		d.spin = Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * randf_range(0.6, 2.4)
		d.life = randf_range(14.0, 24.0)
		p.add_child(d)
		if randf() < 0.55:
			var t := trail(p, true)
			p.get_tree().create_timer(randf_range(1.5, 4.0)).timeout.connect(func():
				if is_instance_valid(t):
					t.emitting = false)
	model.queue_free()

## A moment of slow motion on a kill: the hit lands, then time resumes.
static func hitstop(tree: SceneTree, seconds := 0.07, scale := 0.15) -> void:
	Engine.time_scale = scale
	await tree.create_timer(seconds, true, false, true).timeout
	Engine.time_scale = 1.0
