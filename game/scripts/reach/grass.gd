class_name Grass
## Grass round the places people live: thousands of small tufts (five thin
## blades each, a few with a flower), in one draw, bending in a slow wind.
## Stood on the sphere along its up; kept off paths and out of buildings.

static var _mesh: ArrayMesh
static var _flower: ArrayMesh
static var _mat: ShaderMaterial

static func _tuft(flower: bool) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7 if flower else 3
	var blades := 3 if flower else 10
	for i in blades:
		var a := rng.randf() * TAU
		var lean := Vector3(cos(a), 0, sin(a)) * rng.randf_range(0.05, 0.18)
		var h := rng.randf_range(0.22, 0.42)
		var w := rng.randf_range(0.018, 0.03)
		var base := Vector3(rng.randf_range(-0.13, 0.13), 0, rng.randf_range(-0.13, 0.13))
		var side := Vector3(-sin(a), 0, cos(a)) * w
		var tip := base + Vector3(0, h, 0) + lean
		var dark := Color(0.16, 0.26, 0.1, 0.0)
		var light := Color(0.48, 0.62, 0.26, 1.0).lerp(Color(0.62, 0.6, 0.3, 1.0), rng.randf() * 0.5)
		# One face (the material draws both sides); alpha carries height for
		# the wind.
		st.set_normal(Vector3(cos(a), 0.5, sin(a)).normalized())
		st.set_color(dark)
		st.add_vertex(base - side)
		st.set_color(dark)
		st.add_vertex(base + side)
		st.set_color(light)
		st.add_vertex(tip)
	if flower:
		# A small bloom on a stem: a flat star of petals.
		var top := Vector3(0, 0.36, 0)
		var col: Color = [Color(0.95, 0.85, 0.35, 1.0), Color(0.9, 0.45, 0.35, 1.0), Color(0.75, 0.6, 0.95, 1.0), Color(0.98, 0.95, 0.9, 1.0)][rng.randi() % 4]
		for k in 5:
			var a0 := TAU * k / 5.0
			var p0 := top + Vector3(cos(a0), 0.02, sin(a0)) * 0.045
			var p1 := top + Vector3(cos(a0 + 0.6), 0.0, sin(a0 + 0.6)) * 0.03
			st.set_normal(Vector3.UP)
			for v in [top, p0, p1]:
				st.set_color(Color(col.r, col.g, col.b, 1.0))
				st.add_vertex(v)
	return st.commit()

static func material() -> ShaderMaterial:
	if _mat:
		return _mat
	var s := Shader.new()
	s.code = """shader_type spatial;
render_mode cull_disabled;
// Grass: vertex colour, darker at the root; the tips (alpha) sway in a slow
// wind that rolls across the field.
void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float t = TIME * 1.3 + o.x * 0.11 + o.z * 0.07 + o.y * 0.05;
	float w = sin(t) * 0.6 + sin(t * 2.7 + o.x) * 0.25;
	VERTEX.x += w * 0.07 * COLOR.a;
	VERTEX.z += cos(t * 0.8) * 0.04 * COLOR.a;
}
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.85;
	SPECULAR = 0.15;
	BACKLIGHT = COLOR.rgb * 0.35;
}"""
	_mat = ShaderMaterial.new()
	_mat.shader = s
	return _mat

## A field round a site's frame origin: `count` tufts within `radius`
## metres, not within any [point, radius] in `keep_clear` (body space).
## `chunked` puts a frame between four equal batches: the browser can still
## paint while a field is made.
static func field(site: Site, frame: Transform3D, radius: float, count: int, keep_clear: Array, seed: int, chunked := false) -> void:
	if not _mesh:
		_mesh = _tuft(false)
		_flower = _tuft(true)
	# The light renderer (the browser, weak PCs): half as many, a little
	# bigger.
	var lite := Flow.lite()
	if lite:
		count = count / 2
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var grass: Array[Transform3D] = []
	var blooms: Array[Transform3D] = []
	var tries := 0
	var batch := maxi(1, count / 4)
	while grass.size() + blooms.size() < count and tries < count * 3:
		tries += 1
		if chunked and tries % batch == 0:
			await site.get_tree().process_frame
		# Thickest near the middle, thinning outward.
		var r := radius * pow(rng.randf(), 0.72)
		var a := rng.randf() * TAU
		var g := site.ground(Vector2(cos(a), sin(a)) * r, frame)
		var ok := true
		for c in keep_clear:
			if g.origin.distance_to(c[0]) < float(c[1]):
				ok = false
				break
		# Not in the water, not on bare rock.
		var d := g.origin.normalized()
		if Worlds.height(site.body.key, d, site.body.radius) < site.body.sea + 0.4:
			ok = false
		if not ok:
			continue
		var b := g.basis.rotated(g.basis.y, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(1.0, 1.9) * (1.25 if lite else 1.0))
		var xf := Transform3D(b, g.origin - g.basis.y * 0.02)
		if rng.randf() < 0.07:
			blooms.append(xf)
		else:
			grass.append(xf)
	for pair in [[_mesh, grass], [_flower, blooms]]:
		var list: Array = pair[1]
		if list.is_empty():
			continue
		# Instances relative to the field's middle (visibility is measured
		# to the node).
		var mid := frame.origin
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = pair[0]
		mm.instance_count = list.size()
		for i in list.size():
			var xf: Transform3D = list[i]
			mm.set_instance_transform(i, Transform3D(xf.basis, xf.origin - mid))
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = material()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = mid
		mi.visibility_range_end = radius + 120.0
		site.add_child(mi)

static func clear_cache() -> void:
	_mesh = null
	_flower = null
	_mat = null
