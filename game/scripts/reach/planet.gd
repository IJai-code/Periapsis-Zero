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
var is_ref := false

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
	_shape.shape = mesh_hi.create_trimesh_shape()
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
		_air_mat.render_priority = 1
		a.material = _air_mat
		air_shell.mesh = a
		air_shell.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(air_shell)
	_decorate(mesh_hi.get_meta("deco", {}))
	set_ref(false)

## Whether this is the frame's body: detail, collision and plants on.
func set_ref(on: bool) -> void:
	is_ref = on
	hi.visible = on
	lo.visible = not on
	_shape.disabled = not on
	if water:
		water.visible = on
	for d in _deco:
		d.visible = on

## Each frame: where the Lantern is, for the hand-lit far surface and the air.
func light(star_world: Vector3, star_power: float) -> void:
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
			var key := _chunk(up)
			if not chunks.has(key):
				chunks[key] = []
			var fwd := up.cross(Vector3.RIGHT if absf(up.y) > 0.9 else Vector3.UP).normalized()
			var b := Basis(fwd.cross(up).normalized(), up, -fwd).orthonormalized()
			b = b.rotated(up, data[i + 6]).scaled(Vector3.ONE * data[i + 7])
			chunks[key].append(Transform3D(b, p))
		var range_end := _range(kind)
		for key in chunks:
			var xfs: Array = chunks[key]
			# The chunk's node sits at its middle (visibility ranges are
			# measured to it), its plants relative to that.
			var centre := Vector3.ZERO
			for xf: Transform3D in xfs:
				centre += xf.origin
			centre /= xfs.size()
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = _mesh_for(kind)
			mm.instance_count = xfs.size()
			for k in xfs.size():
				var xf: Transform3D = xfs[k]
				mm.set_instance_transform(k, Transform3D(xf.basis, xf.origin - centre))
			var mi := MultiMeshInstance3D.new()
			mi.position = centre
			mi.multimesh = mm
			if kind in ["pine", "rock", "shard", "stump", "bush"]:
				mi.material_override = Props.material()
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if kind in ["fern", "bush", "stump", "rock"] else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			mi.visibility_range_end = range_end
			mi.visibility_range_end_margin = 30.0
			mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
			add_child(mi)
			_deco.append(mi)

func _chunk(d: Vector3) -> String:
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
	return "%d_%d_%d" % [face, clampi(int((u + 1.0) * 1.5), 0, 2), clampi(int((v + 1.0) * 1.5), 0, 2)]

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
	return Props.mesh(kind)
