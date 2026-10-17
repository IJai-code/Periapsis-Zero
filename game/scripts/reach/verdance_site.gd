class_name VerdanceSite
extends Site
## Verdance: Renn's camp under the falls (a tent, a fire, Renn), her escape
## pod in the clearing to the east, and the Choir's pillar city: sandstone
## pillars round a dais, a gateway, columns, a songline wall, and one
## pillar taller than the rest with stepping stones floating up round it
## to a second songline on its top. Rocks float over the city.

const PILLAR_MAT := "res://shaders/reach/pillar.gdshader"
var _pillar_mat: ShaderMaterial

static func make(b: ReachBody) -> VerdanceSite:
	var v := VerdanceSite.new(b, "renn")
	v.name = "Verdance"
	return v

func _ready() -> void:
	_camp()
	_pod()
	_city()

# --- Renn's camp -----------------------------------------------------------------

func _camp() -> void:
	center = Worlds.place(body, "renn")
	# The cliff to the north, its falls into a pool, the camp below.
	var cliff := put("site-cliff", Vector2.ZERO, Vector2(0, -10))
	var sheet := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(3.0, 12.8)
	sheet.mesh = q
	var wm := ShaderMaterial.new()
	wm.shader = load("res://shaders/reach/waterfall.gdshader")
	sheet.material_override = wm
	sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Over the notch's lip (12.5 m up, 18 m back), down the gorge.
	sheet.transform = Transform3D(Basis(Vector3.RIGHT, -0.08), Vector3(0, 6.3, -18.0))
	cliff.add_child(sheet)
	var pool := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 2.9
	c.bottom_radius = 2.9
	c.height = 0.12
	c.radial_segments = 32
	var water := StandardMaterial3D.new()
	water.albedo_color = Color(0.16, 0.34, 0.4, 0.82)
	water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	water.roughness = 0.05
	water.metallic_specular = 0.9
	c.material = water
	pool.mesh = c
	pool.transform = Transform3D(Basis().scaled(Vector3(1.15, 1.0, 0.85)), Vector3(0, 0.12, -16.2))
	cliff.add_child(pool)
	cliff.add_child(_mist(Vector3(0, 0.4, -17.0)))
	var roar := AudioStreamPlayer3D.new()
	roar.stream = ReachSounds.falls()
	roar.unit_size = 6.0
	roar.max_distance = 70.0
	roar.volume_db = -8.0
	roar.position = Vector3(0, 2.0, -16.5)
	roar.autoplay = true
	cliff.add_child(roar)
	# Camp: a tent, the fire, her kit, a lamp, Renn.
	put("site-tent", Vector2(-5.0, 2.5), Vector2(1.0, -1.5))
	var fire := Campfire.new()
	add_child(fire)
	fire.transform = ground(Vector2(1.0, -1.5))
	put("village-crate", Vector2(-3.2, 4.4), Vector2(1.0, -1.5))
	put("village-barrel", Vector2(-2.5, 5.1), Vector2.ZERO)
	put("village-bench", Vector2(1.0, 1.2), Vector2(1.0, -1.5), false)
	lamp(put("village-lamp", Vector2(-1.6, -4.0), Vector2(1.0, -1.5)), Vector3(0, 1.9, 0.55))
	person("renn", "renn", Vector2(3.2, -0.6), Vector2(1.0, -1.5))
	var clear := footprints()
	clear.append([ground(Vector2(1.0, -1.5)).origin, 3.0])
	clear.append([center.origin - center.basis.z * 15.0, 10.0])
	Grass.field(self, center, 34.0, 5000, clear, 23)

## Spray at the foot of the falls.
static func _mist(at: Vector3) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	# Up is the world's up where it stands, not the frame's.
	p.local_coords = true
	p.amount = 28
	p.lifetime = 3.5
	p.position = at
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(2.0, 0.2, 1.0)
	p.direction = Vector3(0, 1, 0.3)
	p.spread = 40.0
	p.gravity = Vector3(0, 0.25, 0)
	p.initial_velocity_min = 0.6
	p.initial_velocity_max = 1.4
	p.scale_amount_min = 1.2
	p.scale_amount_max = 2.6
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.0)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.albedo_color = Color(0.9, 0.95, 1.0, 0.16)
	m.vertex_color_use_as_albedo = true
	q.material = m
	p.mesh = q
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0.0))
	ramp.add_point(0.25, Color(1, 1, 1, 1.0))
	ramp.set_color(ramp.get_point_count() - 1, Color(1, 1, 1, 0.0))
	p.color_ramp = ramp
	return p

# --- The pod ------------------------------------------------------------------------

func _pod() -> void:
	center = Worlds.place(body, "pod")
	var pod := put("site-pod", Vector2.ZERO, Vector2(-10, -6), true, 1.0, 0.45)
	pod.rotate_object_local(Vector3.FORWARD, 0.16)
	pod.rotate_object_local(Vector3.RIGHT, -0.08)
	put("site-debris_plate", Vector2(-6.5, 3.0), Vector2.ZERO, true, 0.55)
	put("site-debris_plate", Vector2(-12.0, 5.5), Vector2(0, 10), true, 0.4)
	var smoke := _mist(Vector3(0.4, 1.6, 0.0))
	smoke.amount = 18
	smoke.lifetime = 6.0
	smoke.gravity = Vector3(0, 0.6, 0)
	smoke.scale_amount_max = 3.5
	((smoke.mesh as QuadMesh).material as StandardMaterial3D).albedo_color = Color(0.25, 0.24, 0.23, 0.22)
	pod.add_child(smoke)

# --- The pillar city -------------------------------------------------------------

func _city() -> void:
	center = Worlds.place(body, "pillars")
	_pillar_mat = ShaderMaterial.new()
	_pillar_mat.shader = load(PILLAR_MAT)
	_pillar_mat.set_shader_parameter("rock_map", Surfaces._tex("Rock030", "Color"))
	_pillar_mat.set_shader_parameter("rock_normal", Surfaces._tex("Rock030", "NormalGL"))
	_pillar_mat.set_shader_parameter("moss_map", Surfaces._tex("Ground037", "Color"))
	put("site-platform", Vector2.ZERO, Vector2(0, -10))
	songline("pillars", Vector2(0, 8.5), Vector2.ZERO, "site-songline_wall")
	put("site-arch", Vector2(0, -16), Vector2(0, -40))
	put("site-arch", Vector2(0, -30), Vector2(0, -40))
	for k in 9:
		var a := TAU * (k + 0.5) / 10.0 - PI / 2.0
		put("site-column", Vector2(cos(a), sin(a)) * 12.5, Vector2.ZERO)
	var rng := RandomNumberGenerator.new()
	rng.seed = 41
	for spec in [[Vector2(-34, 18), 0.12], [Vector2(-26, -34), 0.1], [Vector2(36, -24), 0.11],
			[Vector2(46, 12), 0.13], [Vector2(6, 46), 0.12], [Vector2(-50, -6), 0.1], [Vector2(-14, 40), 0.09]]:
		_pillar(spec[0], spec[1], rng.randi() % 4, rng.randf() * TAU)
	# The tall one: stones floating up round it to a dais on top, and the
	# second songline there.
	var tall_at := Vector2(26, 32)
	var top := _pillar(tall_at, 0.16, 2, 0.6)
	var up := top.basis.y
	var dais := piece("site-platform", Transform3D(top.basis, top.origin + up * (300.0 * 0.16 - 2.2)), true, 0.62, 0.0)
	songline_at("pillar_top", Transform3D(top.basis, dais.position + up * 0.53 - top.basis.z * 0.4))
	var base := ground(tall_at)
	for k in 10:
		var a := 0.4 + k * 0.78
		var h := 3.0 + k * 4.3
		var r := 5.0 * 1.25 + 3.2
		var side := base.basis.x * cos(a) + base.basis.z * sin(a)
		_stone(base.origin + side * r + base.basis.y * h, base.basis, Vector3(2.0, 0.7, 1.7), 50 + k)
	# Rocks drifting over the city.
	for k in 6:
		var a := TAU * k / 6.0 + 0.3
		var g := ground(Vector2(cos(a), sin(a)) * rng.randf_range(18.0, 40.0))
		_stone(g.origin + g.basis.y * rng.randf_range(38.0, 70.0), g.basis, Vector3.ONE * rng.randf_range(5.0, 10.0) * Vector3(1.0, 0.6, 0.9), 80 + k)

## A sandstone pillar (art/godot/pillars.py, 300 m by 25 m, scaled) at
## (east, north); returns its foot's transform (up along the pillar).
func _pillar(at: Vector2, scale: float, variant: int, turn: float) -> Transform3D:
	var g := ground(at)
	var b := g.basis.rotated(g.basis.y, turn)
	var n := piece("pillar-%d" % variant, Transform3D(b, g.origin), false, scale, 3.0)
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		mi.material_override = _pillar_mat
	# Solid as a cylinder: cheap, and nothing climbs its ledges.
	var body3 := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = 25.0 * scale * 1.05
	cyl.height = 300.0 * scale
	cs.shape = cyl
	body3.add_child(cs)
	add_child(body3)
	body3.transform = Transform3D(b, g.origin + b.y * (150.0 * scale - 3.0))
	return Transform3D(b, g.origin - b.y * 3.0)

## A floating stone, solid (its hull built at its size: a scaled body is
## not reliably solid).
func _stone(at: Vector3, b: Basis, size: Vector3, seed: int) -> void:
	var turn := b.rotated(b.y, seed * 0.7)
	var mi := MeshInstance3D.new()
	mi.mesh = Props.mesh("rock")
	mi.material_override = Props.material()
	add_child(mi)
	mi.transform = Transform3D(turn * Basis.from_scale(size), at)
	var pts := PackedVector3Array()
	for v: Vector3 in (mi.mesh as ArrayMesh).surface_get_arrays(0)[Mesh.ARRAY_VERTEX]:
		pts.append(v * size)
	var hull := ConvexPolygonShape3D.new()
	hull.points = pts
	var sb := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = hull
	sb.add_child(cs)
	add_child(sb)
	sb.transform = Transform3D(turn, at)
