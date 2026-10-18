class_name WorldLook
extends Node3D
## What makes each world itself from across the Reach, the way every world
## in Outer Wilds is known by its silhouette: Hearthstone's and Verdance's
## clouds; Ashfall's columns of ash from its vents (its lava cracks are in
## the planet shader); the Phantom's breathing violet shimmer; the
## Wanderer's two tails streaming away from the Lantern, long only near it,
## and the jets off its sunward side. Hung on the Planet, so it moves with
## the world and nothing slides.

var planet: Planet
var body: ReachBody
var _clouds: ShaderMaterial
var _tails: Array[MeshInstance3D] = []
var _tail_mats: Array[ShaderMaterial] = []
var _jets: CPUParticles3D

static var _noise: NoiseTexture2D

static func attach(p: Planet) -> WorldLook:
	var w := WorldLook.new()
	w.planet = p
	w.body = p.body
	w.name = "WorldLook"
	p.add_child(w)
	return w

static func noise() -> NoiseTexture2D:
	if _noise:
		return _noise
	var fn := FastNoiseLite.new()
	fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	fn.frequency = 0.012
	fn.fractal_type = FastNoiseLite.FRACTAL_FBM
	fn.fractal_octaves = 5
	fn.seed = 7
	_noise = NoiseTexture2D.new()
	_noise.width = 512
	_noise.height = 512
	_noise.seamless = true
	_noise.generate_mipmaps = true
	_noise.noise = fn
	return _noise

func _ready() -> void:
	match body.key:
		"hearthstone":
			_cloud_deck(body.radius + 95.0, 0.47, 0.6, 0.0, Color(1.0, 0.98, 0.95, 0.82))
		"verdance":
			_cloud_deck(body.radius + 150.0, 0.5, 0.5, 0.6, Color(0.97, 1.0, 0.98, 0.88))
		"ashfall":
			for k in 3:
				_plume(k)
		"phantom":
			_aura(body.radius * 1.16, Color(0.62, 0.42, 1.0), 1.1, 0.35)
		"wanderer":
			_aura(body.radius * 1.6, Color(0.55, 0.85, 1.0), 0.9, 0.2)
			_tail(Color(0.45, 0.75, 1.0), 2600.0, 70.0, 0.0)
			_tail(Color(1.0, 0.85, 0.6), 1700.0, 150.0, 0.35)
			_jet_spray()

func _cloud_deck(r: float, coverage: float, scale: float, bands: float, color: Color) -> void:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 64
	s.rings = 32
	mi.mesh = s
	_clouds = ShaderMaterial.new()
	_clouds.shader = load("res://shaders/reach/clouds.gdshader")
	_clouds.set_shader_parameter("noise_tex", noise())
	_clouds.set_shader_parameter("coverage", coverage)
	_clouds.set_shader_parameter("scale", scale)
	_clouds.set_shader_parameter("bands", bands)
	_clouds.set_shader_parameter("color", color)
	_clouds.set_shader_parameter("radius", r)
	_clouds.render_priority = 2
	mi.material_override = _clouds
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

## A column of ash from a vent: dark, rising, spreading, long-lived; the
## vent's glow at its foot.
func _plume(k: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 40 + k
	var d := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized()
	# Clear of the wreck and Vex's camp.
	for name in ["wreck", "vex", "vault"]:
		var l: Vector3 = Worlds.landmarks("ashfall")[name][0]
		if d.dot(l) > 0.8:
			d = (-d).normalized()
	var at := d * (body.radius + Worlds.height(body.key, d, body.radius))
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(34.0, 34.0)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = Falls._puff()
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	q.material = m
	p.mesh = q
	p.amount = 48
	p.lifetime = 14.0
	p.preprocess = 14.0
	p.local_coords = true
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 4.0
	p.direction = Vector3.UP
	p.spread = 12.0
	p.gravity = Vector3(0.6, 0.4, 0.0)
	p.initial_velocity_min = 9.0
	p.initial_velocity_max = 15.0
	p.damping_min = 0.3
	p.damping_max = 0.6
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.3
	var c := Curve.new()
	c.add_point(Vector2(0.0, 0.3))
	c.add_point(Vector2(1.0, 4.5))
	p.scale_amount_curve = c
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.08, 0.5, 1.0])
	g.colors = PackedColorArray([Color(1.0, 0.45, 0.15, 0.0), Color(0.45, 0.32, 0.26, 0.9), Color(0.22, 0.2, 0.2, 0.75), Color(0.18, 0.17, 0.17, 0.0)])
	p.color_ramp = g
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-120, -10, -120), Vector3(240, 260, 240))
	add_child(p)
	p.transform = Transform3D(Site.upright(d, d.cross(Vector3.UP)), at)
	var glow := OmniLight3D.new()
	glow.light_color = Color(1.0, 0.45, 0.15)
	glow.light_energy = 3.0
	glow.omni_range = 40.0
	glow.shadow_enabled = false
	glow.position = at + d * 3.0
	add_child(glow)

func _aura(r: float, color: Color, strength: float, pulse: float) -> void:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 48
	s.rings = 24
	mi.mesh = s
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/reach/aura.gdshader")
	m.set_shader_parameter("color", color)
	m.set_shader_parameter("strength", strength)
	m.set_shader_parameter("pulse", pulse)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

## One tail: a long open cone from the nucleus away from the Lantern.
func _tail(color: Color, length: float, width: float, bend: float) -> void:
	var c := CylinderMesh.new()
	c.top_radius = width * 0.35
	c.bottom_radius = width * 3.2
	c.height = length
	c.radial_segments = 24
	c.rings = 8
	c.cap_top = false
	c.cap_bottom = false
	var mi := MeshInstance3D.new()
	mi.mesh = c
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/reach/tail.gdshader")
	m.set_shader_parameter("color", color)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.set_meta("length", length)
	mi.set_meta("bend", bend)
	mi.top_level = true
	add_child(mi)
	_tails.append(mi)
	_tail_mats.append(m)

func _jet_spray() -> void:
	_jets = CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(9.0, 9.0)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = Falls._puff()
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	q.material = m
	_jets.mesh = q
	_jets.amount = 40
	_jets.lifetime = 6.0
	_jets.local_coords = true
	_jets.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_jets.emission_sphere_radius = body.radius * 0.8
	_jets.direction = Vector3.UP
	_jets.spread = 25.0
	_jets.initial_velocity_min = 12.0
	_jets.initial_velocity_max = 30.0
	_jets.scale_amount_min = 0.6
	_jets.scale_amount_max = 2.0
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.15, 1.0])
	g.colors = PackedColorArray([Color(0.7, 0.9, 1.0, 0.0), Color(0.7, 0.9, 1.0, 0.35), Color(0.7, 0.9, 1.0, 0.0)])
	_jets.color_ramp = g
	_jets.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_jets)

## The Lantern's place (world space), each frame from Reach: the clouds lit
## from it, the tails and jets turned from it.
func light(star: Vector3) -> void:
	var at := global_position
	var from_star := (at - star)
	var dist := from_star.length()
	var away := from_star / maxf(dist, 1.0)
	if _clouds:
		_clouds.set_shader_parameter("sun_dir", -away)
	if not _tails.is_empty():
		# Long and bright near the Lantern, a wisp out at the edge.
		var k := clampf(smoothstep(9000.0, 2200.0, dist), 0.12, 1.0)
		for i in _tails.size():
			var t := _tails[i]
			var length: float = t.get_meta("length")
			var bend: float = t.get_meta("bend")
			var dir := away
			if bend > 0.0:
				var side := away.cross(Vector3.UP).normalized()
				dir = (away + side * bend).normalized()
			var len := length * k
			var b := Basis.looking_at(-dir, Vector3.UP if absf(dir.y) < 0.95 else Vector3.RIGHT)
			# The cylinder runs along its Y: turn Y onto the tail's direction.
			b = b * Basis(Vector3.RIGHT, -PI / 2.0)
			t.global_transform = Transform3D(b.scaled(Vector3(1.0, len / length, 1.0)), at + dir * len * 0.5)
			_tail_mats[i].set_shader_parameter("strength", 0.25 + 0.75 * k)
		if _jets:
			_jets.global_basis = Site.upright(-away, away.cross(Vector3.UP)).scaled(_jets.global_basis.get_scale())
			_jets.emitting = k > 0.25
