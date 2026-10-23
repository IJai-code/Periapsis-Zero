class_name Planet
extends Node3D
## A body of the Reach as drawn: its baked surface (detailed while it is the
## frame's body, simple from afar), collision (only while it is the frame's
## body: nothing else is ever stood on), the sea, the air, and its plants
## and rocks in chunks that draw only near the camera.

var body: ReachBody
var hi: MeshInstance3D
var lo: MeshInstance3D
var water: MeshInstance3D
var air_shell: MeshInstance3D
var _solid: StaticBody3D
var _shape: CollisionShape3D
var _near_mat: ShaderMaterial
var _far_mat: ShaderMaterial
var _air_mat: ShaderMaterial
var _deco: Array[GeometryInstance3D] = []
var sites: Array[Site] = []
var is_ref := false
## Trunks and rocks made solid (one physics body, many shapes, made the
## first time this is the frame's body): [kind, transform in body space].
var _solids: Array = []
var _solid_body := RID()
var _solid_shapes: Array = []

## Solid size of each kind at scale 1: [shape, radius, height] (a trunk is
## a cylinder up to the boughs; a rock a sphere).
const SOLID := {"pine": ["cyl", 0.62, 18.0], "stump": ["cyl", 0.42, 0.7], "tree": ["cyl", 0.45, 9.0], "giant": ["cyl", 1.3, 18.0],
	"palm": ["cyl", 0.32, 8.0], "rock": ["ball", 0.82, 0.0], "shard": ["cyl", 0.38, 2.4]}

static func make(b: ReachBody) -> Planet:
	var p := Planet.new()
	p.body = b
	p.name = "Planet"
	return p

func _ready() -> void:
	var hq := Flow.high_quality()
	var mesh_hi: ArrayMesh = load("res://art/planets/%s-hi.res" % body.key)
	var mesh_lo: ArrayMesh = load("res://art/planets/%s-lo.res" % body.key)
	_near_mat = ShaderMaterial.new()
	_near_mat.shader = load("res://shaders/reach/planet.gdshader")
	_far_mat = ShaderMaterial.new()
	_far_mat.shader = load("res://shaders/reach/planet_far.gdshader")
	var ground := "Ground037"
	var rock := "Rock030"
	if body.key in ["ashfall", "phantom", "wanderer"]:
		ground = "Rock044"
	for m: ShaderMaterial in [_near_mat, _far_mat]:
		m.set_shader_parameter("ground_map", Surfaces._tex(ground, "Color"))
		m.set_shader_parameter("rock_map", Surfaces._tex(rock, "Color"))
	var vein := {"ashfall": [Color(1.0, 0.36, 0.08), 1.4], "phantom": [Color(0.72, 0.48, 1.0), 0.75]}
	if vein.has(body.key):
		for m: ShaderMaterial in [_near_mat, _far_mat]:
			m.set_shader_parameter("vein_color", vein[body.key][0])
			m.set_shader_parameter("vein_amount", vein[body.key][1])
	_far_mat.set_shader_parameter("air_color", body.sky_day)
	_far_mat.set_shader_parameter("air", 1.0 if body.atmo > 0.0 else 0.0)
	hi = MeshInstance3D.new()
	hi.mesh = mesh_hi
	hi.material_override = _near_mat
	add_child(hi)
	lo = MeshInstance3D.new()
	lo.mesh = mesh_lo
	lo.material_override = _far_mat
	lo.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(lo)
	_solid = StaticBody3D.new()
	_shape = CollisionShape3D.new()
	var shell := mesh_hi.create_trimesh_shape()
	# Solid from underneath too. A single-sided shell is a trap: step out of
	# a ship with one foot under a rise and there is nothing to stop you
	# falling through the world, into the dark inside it.
	shell.backface_collision = true
	_shape.shape = shell
	_solid.add_child(_shape)
	add_child(_solid)
	if body.sea != 0.0:
		water = MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = body.radius + body.sea
		s.height = s.radius * 2.0
		s.radial_segments = 96 if hq else 64
		s.rings = 48 if hq else 32
		var wm := ShaderMaterial.new()
		wm.shader = load("res://shaders/reach/sea.gdshader")
		wm.set_shader_parameter("sky_tint", body.sky_day)
		s.material = wm
		water.mesh = s
		water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(water)
	if body.atmo > 0.0:
		air_shell = MeshInstance3D.new()
		var a := SphereMesh.new()
		a.radius = body.atmo
		a.height = body.atmo * 2.0
		a.radial_segments = 48
		a.rings = 24
		_air_mat = ShaderMaterial.new()
		_air_mat.shader = load("res://shaders/reach/atmosphere.gdshader")
		_air_mat.set_shader_parameter("planet_r", body.radius)
		_air_mat.set_shader_parameter("air_r", body.atmo)
		_air_mat.set_shader_parameter("day", body.sky_day)
		_air_mat.set_shader_parameter("dusk", body.sky_dusk)
		# Thin air: the nebulae and the stars stay in the sky by day.
		_air_mat.set_shader_parameter("veil", 0.24)
		_air_mat.set_shader_parameter("steps", 6 if hq else 4)
		_air_mat.render_priority = 1
		a.material = _air_mat
		air_shell.mesh = a
		air_shell.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(air_shell)
	_decorate(mesh_hi.get_meta("deco", {}))
	look = WorldLook.attach(self)
	set_ref(false)

## A place on this body (Site): solid only while this is the frame's body.
func add_site(s: Site) -> Site:
	add_child(s)
	sites.append(s)
	set_ref(is_ref)
	return s

## Whether this is the frame's body: detail, collision and plants on.
func set_ref(on: bool) -> void:
	is_ref = on
	hi.visible = on
	lo.visible = not on
	_shape.disabled = not on
	# Everything solid on this body (buildings, wrecks) only while stood on.
	prepare()
	for cs: CollisionShape3D in _shapes:
		if is_instance_valid(cs):
			cs.disabled = not on
	if water:
		water.visible = on
	for d in _deco:
		d.visible = on
	_solid_on(on)
	_wake_sites()

## The trunks and rocks, solid while this is the frame's body (its node
## then sits at the world's origin and does not move).
## Ready to be arrived at, done once and early (Reach._prewarm, behind the
## morning's black): the list of everything solid here, and the trunks'
## and rocks' one body with all its shapes. Built the moment a world is
## reached, in a browser, that is a stall a pilot feels at 200 m/s.
var _shapes: Array[CollisionShape3D] = []
var _prepared := false

func prepare() -> void:
	if _prepared:
		return
	_prepared = true
	for cs: CollisionShape3D in find_children("*", "CollisionShape3D", true, false):
		if cs != _shape:
			_shapes.append(cs)
	_solid_build()

func _solid_on(on: bool) -> void:
	if _solids.is_empty() or not is_inside_tree():
		return
	_solid_build()
	if _solid_body.is_valid():
		PhysicsServer3D.body_set_space(_solid_body, get_world_3d().space if on else RID())
		PhysicsServer3D.body_set_state(_solid_body, PhysicsServer3D.BODY_STATE_TRANSFORM, global_transform)

func _solid_build() -> void:
	if _solids.is_empty() or _solid_body.is_valid():
		return
	_solid_body = PhysicsServer3D.body_create()
	PhysicsServer3D.body_set_mode(_solid_body, PhysicsServer3D.BODY_MODE_STATIC)
	PhysicsServer3D.body_set_collision_layer(_solid_body, 1)
	PhysicsServer3D.body_set_collision_mask(_solid_body, 0)
	# Shapes shared by size (scale quantised to a tenth).
	var shared := {}
	for item in _solids:
		var kind: String = item[0]
		var xf: Transform3D = item[1]
		var spec: Array = SOLID[kind]
		var sc := snappedf(xf.basis.get_scale().y, 0.1)
		var key := "%s/%.1f" % [kind, sc]
		if not shared.has(key):
			var shape := RID()
			if spec[0] == "ball":
				shape = PhysicsServer3D.sphere_shape_create()
				PhysicsServer3D.shape_set_data(shape, float(spec[1]) * sc)
			else:
				shape = PhysicsServer3D.cylinder_shape_create()
				PhysicsServer3D.shape_set_data(shape, {"radius": float(spec[1]) * sc, "height": float(spec[2]) * sc})
			shared[key] = shape
			_solid_shapes.append(shape)
		var up := xf.basis.y.normalized()
		var at := xf.origin + (up * float(spec[2]) * sc * 0.5 if spec[0] == "cyl" else up * float(spec[1]) * sc * 0.35)
		PhysicsServer3D.body_add_shape(_solid_body, shared[key], Transform3D(Site.upright(up, up.cross(Vector3.RIGHT) if absf(up.x) < 0.9 else up.cross(Vector3.UP)), at))

func _exit_tree() -> void:
	if _solid_body.is_valid():
		PhysicsServer3D.free_rid(_solid_body)
		_solid_body = RID()
	for shape in _solid_shapes:
		PhysicsServer3D.free_rid(shape)
	_solid_shapes.clear()

## Sites are drawn while this is the frame's body or the camera is within
## a few radii of it, and run only while it is the frame's.
func _wake_sites() -> void:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var near := cam != null and cam.global_position.distance_to(global_position) < body.radius * 4.0 + 300.0
	for s in sites:
		s.awake(is_ref, near)

## Each frame: where the Lantern is, for the hand-lit far surface and the air.
var look: WorldLook

func light(star_world: Vector3, star_power: float) -> void:
	if look:
		look.light(star_world)
	if not is_ref and not sites.is_empty():
		_wake_sites()
	_far_mat.set_shader_parameter("star_pos", star_world)
	_far_mat.set_shader_parameter("star_power", star_power)
	if _air_mat:
		_air_mat.set_shader_parameter("center", global_position)
		_air_mat.set_shader_parameter("star_pos", star_world)
		_air_mat.set_shader_parameter("star_power", star_power)

# --- Plants and rocks ----------------------------------------------------------

## Chunks of a kind by direction (a 3 x 3 grid on each cube face), so only
## those near the camera are drawn.
func _decorate(deco: Dictionary) -> void:
	for kind in deco:
		var data: PackedFloat32Array = deco[kind]
		var chunks := {}
		for i in range(0, data.size(), 8):
			var p := Vector3(data[i], data[i + 1], data[i + 2])
			var up := Vector3(data[i + 3], data[i + 4], data[i + 5])
			# The pines in smaller patches (4 x 4 a face), so the trees near
			# you switch to their close-up shape and those beyond do not.
			var key := _chunk(up, 2)
			if not chunks.has(key):
				chunks[key] = []
			var fwd := up.cross(Vector3.RIGHT if absf(up.y) > 0.9 else Vector3.UP).normalized()
			var b := Basis(fwd.cross(up).normalized(), up, -fwd).orthonormalized()
			b = b.rotated(up, data[i + 6]).scaled(Vector3.ONE * data[i + 7])
			chunks[key].append(Transform3D(b, p))
			if SOLID.has(kind):
				_solids.append([kind, Transform3D(b, p)])
		var range_end := _range(kind)
		for key in chunks:
			var xfs: Array = chunks[key]
			# The chunk's node sits at its middle (visibility ranges are
			# measured to it), its plants relative to that.
			var centre := Vector3.ZERO
			for xf: Transform3D in xfs:
				centre += xf.origin
			centre /= xfs.size()
			# Kenney's Nature Kit (KenneyKit): a few shapes of each kind,
			# the instances dealt among them. A couple of hundred triangles a
			# tree, so each is drawn whole as far as it is drawn at all.
			var shapes := _kenney(kind)
			if not shapes.is_empty():
				for v in shapes.size():
					var some: Array = []
					for k in xfs.size():
						if k % shapes.size() == v:
							var xf: Transform3D = xfs[k]
							some.append(Transform3D(xf.basis.scaled(Vector3.ONE * float(shapes[v][1])), xf.origin))
					if not some.is_empty():
						var shape_name: String = shapes[v][0]
						var m: Mesh = Crystals.mesh(shape_name.trim_prefix("crystal:"), body.key) if shape_name.begins_with("crystal:") else KenneyKit.mesh(shape_name, _kenney_tint(kind))
						_deco_mm(m, some, centre, null, 0.0, range_end, not kind in ["fern", "bush", "stump"])
				continue
			var mat: Material = Props.material() if kind in ["rock", "shard", "stump", "bush"] and not (kind == "bush" and body.key == "verdance") else null
			_deco_mm(_mesh_for(kind), xfs, centre, mat, 0.0, range_end, not kind in ["fern", "bush", "stump", "rock"])

## The Kenney shapes for a kind of plant or rock on this world, and the
## scale each is drawn at (their models are about a metre tall).
func _kenney(kind: String) -> Array:
	var bare := body.key in ["ashfall", "phantom", "wanderer"]
	# Verdance's forest is Flora's: trunks of scanned bark carrying cards
	# of scanned leaves (art/godot/flora.py), a few hundred triangles each,
	# not Kenney's blobs.
	if body.key == "verdance" and kind in ["tree", "giant", "palm", "fern", "bush"]:
		return []
	match kind:
		"pine":
			# Poly Haven's scanned fir, made into tall pines (art/godot/pines.py).
			return [["ph/ph-pine_a", 1.0], ["ph/ph-pine_b", 1.0], ["ph/ph-pine_c", 1.0]]
		"bush":
			return [["plant_bushDetailed", 4.5], ["plant_bushLarge", 5.5]]
		"shard":
			# The comet has no crystals, as a real one would not: ridges of
			# dirty ice (scanned rock, frosted pale). The Phantom and Ashfall
			# grow quartz-like clusters (Crystals).
			if body.key == "wanderer":
				return [["ph/ph-moon_rock_03", 20.0], ["ph/ph-moon_rock_05", 30.0], ["ph/ph-namaqualand_boulder_03", 1.6]]
			return [["crystal:a", 1.0], ["crystal:b", 1.1], ["crystal:c", 0.9]]
		"rock":
			if bare:
				# Poly Haven's scanned moon rocks (a hand's width as scanned).
				return [["ph/ph-moon_rock_01", 14.0], ["ph/ph-moon_rock_02", 11.0], ["ph/ph-moon_rock_03", 26.0], ["ph/ph-moon_rock_05", 34.0]]
			return [["rock_largeA", 3.2], ["rock_tallA", 2.6]]
		"stump":
			return [["stump_old", 3.5], ["log", 4.0]]
		"giant":
			return [["tree_oak", 16.0], ["tree_detailed", 15.0], ["tree_fat", 15.0]]
		"tree":
			return [["tree_default", 9.0], ["tree_oak", 10.0], ["tree_tall", 9.0]]
		"palm":
			return [["tree_palmTall", 7.0], ["tree_palmBend", 7.0], ["tree_palmDetailedTall", 7.5]]
		"fern":
			return [["plant_flatTall", 4.0], ["plant_flatShort", 4.0]]
	return []

func _kenney_tint(kind: String) -> Color:
	if kind == "shard" and body.key == "wanderer":
		# Dirty ice: the scans frosted pale and blue.
		return Color(1.35, 1.5, 1.75)
	if kind == "rock":
		match body.key:
			"ashfall": return Color(0.55, 0.45, 0.42)
			"phantom": return Color(0.85, 0.72, 1.1)
			"wanderer": return Color(0.95, 1.05, 1.2)
	return Color(1, 1, 1)

## One drawing of many plants (a chunk's worth), seen between two distances.
func _deco_mm(mesh: Mesh, xfs: Array, centre: Vector3, mat: Material, begin: float, end: float, shadow: bool) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for k in xfs.size():
		var xf: Transform3D = xfs[k]
		mm.set_instance_transform(k, Transform3D(xf.basis, xf.origin - centre))
	var mi := MultiMeshInstance3D.new()
	mi.position = centre
	mi.multimesh = mm
	if mat:
		mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_begin = begin
	mi.visibility_range_end = end
	mi.visibility_range_end_margin = 30.0
	mi.visibility_range_begin_margin = 30.0
	mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
	add_child(mi)
	_deco.append(mi)
	return mi

## Which chunk of a face a direction falls in. Two by two, not three by
## three: the browser submits every chunk as its own draw call, and the
## trees that matter are all within a couple of hundred metres anyway.
func _chunk(d: Vector3, n := 2) -> String:
	var a := d.abs()
	var face := 0
	var u := 0.0
	var v := 0.0
	if a.x >= a.y and a.x >= a.z:
		face = 0 if d.x > 0.0 else 1
		u = d.y / a.x
		v = d.z / a.x
	elif a.y >= a.z:
		face = 2 if d.y > 0.0 else 3
		u = d.x / a.y
		v = d.z / a.y
	else:
		face = 4 if d.z > 0.0 else 5
		u = d.x / a.z
		v = d.y / a.z
	var h := n * 0.5
	return "%d_%d_%d" % [face, clampi(int((u + 1.0) * h * 0.999), 0, n - 1), clampi(int((v + 1.0) * h * 0.999), 0, n - 1)]

func _range(kind: String) -> float:
	match kind:
		"fern", "bush", "stump":
			return 220.0
		"rock":
			return 400.0
	return 1400.0

func _mesh_for(kind: String) -> Mesh:
	match kind:
		"giant", "tree", "palm", "fern":
			return Flora.mesh(kind)
		"bush":
			if body.key == "verdance":
				return Flora.mesh("shrub")
	return Props.mesh(kind)
