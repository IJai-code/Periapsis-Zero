class_name Props
## Small things made in code, cheap enough to draw by the thousand: a
## stylised pine (a trunk and stacked cones), a lumpy rock, a crystal shard,
## a stump. Vertex-coloured, sharing one material.

static var _cache := {}

static func mesh(kind: String) -> Mesh:
	if _cache.has(kind):
		return _cache[kind]
	var m: Mesh
	match kind:
		"pine": m = _pine()
		"rock": m = _rock(11, Color(0.48, 0.46, 0.44))
		"shard": m = _shard()
		"stump": m = _stump()
		"bush": m = _bush()
		_: m = _rock(3, Color(0.5, 0.5, 0.5))
	_cache[kind] = m
	return m

static func material() -> Material:
	if _cache.has("_mat"):
		return _cache["_mat"]
	var s := Shader.new()
	s.code = """shader_type spatial;
render_mode cull_back;
// Props: vertex colour, a little sway for anything leafy (alpha > 0).
uniform float sway = 1.0;
varying float leafy;
void vertex() {
	leafy = COLOR.a;
	vec3 o = MODEL_MATRIX[3].xyz;
	float t = TIME * 0.8 + o.x * 0.05 + o.z * 0.04;
	VERTEX.x += sin(t) * VERTEX.y * VERTEX.y * 0.0015 * sway * COLOR.a;
}
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.9;
	SPECULAR = 0.2;
	BACKLIGHT = COLOR.rgb * 0.25 * leafy;
}"""
	var m := ShaderMaterial.new()
	m.shader = s
	_cache["_mat"] = m
	return m

## One triangle facing `n` (Godot draws clockwise faces: the vertices are
## put in whichever order makes that so).
static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, n: Vector3, ca: Color, cb: Color, cc: Color) -> void:
	if (b - a).cross(c - a).dot(n) > 0.0:
		var t := b
		b = c
		c = t
		var tc := cb
		cb = cc
		cc = tc
	st.set_normal(n)
	st.set_color(ca)
	st.add_vertex(a)
	st.set_color(cb)
	st.add_vertex(b)
	st.set_color(cc)
	st.add_vertex(c)

static func _cone(st: SurfaceTool, base: float, top: float, r: float, sides: int, col: Color, phase: float) -> void:
	var c2 := col.darkened(0.25)
	for i in sides:
		var a0 := TAU * i / sides + phase
		var a1 := TAU * (i + 1) / sides + phase
		var p0 := Vector3(cos(a0) * r, base, sin(a0) * r)
		var p1 := Vector3(cos(a1) * r, base, sin(a1) * r)
		var apex := Vector3(0, top, 0)
		var out := Vector3(cos((a0 + a1) / 2.0), r / maxf(top - base, 0.1), sin((a0 + a1) / 2.0)).normalized()
		_tri(st, p0, apex, p1, out, c2, col, c2)
		# Underside, so a cone seen from below is not hollow.
		var under := c2.darkened(0.4)
		_tri(st, p0, p1, Vector3(0, base, 0), Vector3.DOWN, under, under, under)

## A pine about 9 m tall at scale 1: four cones over a short trunk.
static func _pine() -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var bark := Color(0.32, 0.22, 0.15, 0.0)
	_trunk(st, 0.32, 0.18, 2.2, 6, bark)
	var greens := [Color(0.14, 0.3, 0.18, 1.0), Color(0.16, 0.34, 0.2, 1.0), Color(0.18, 0.37, 0.21, 1.0), Color(0.2, 0.4, 0.22, 1.0)]
	var y := 1.6
	var r := 2.6
	for k in 4:
		_cone(st, y, y + 3.2 - k * 0.35, r, 7, greens[k], k * 0.4)
		y += 1.75
		r *= 0.74
	return st.commit()

static func _trunk(st: SurfaceTool, r0: float, r1: float, h: float, sides: int, col: Color) -> void:
	for i in sides:
		var a0 := TAU * i / sides
		var a1 := TAU * (i + 1) / sides
		var b0 := Vector3(cos(a0) * r0, -0.5, sin(a0) * r0)
		var b1 := Vector3(cos(a1) * r0, -0.5, sin(a1) * r0)
		var t0 := Vector3(cos(a0) * r1, h, sin(a0) * r1)
		var t1 := Vector3(cos(a1) * r1, h, sin(a1) * r1)
		var n := Vector3(cos((a0 + a1) / 2.0), 0, sin((a0 + a1) / 2.0))
		_tri(st, b0, t0, b1, n, col, col, col)
		_tri(st, b1, t0, t1, n, col, col, col)

static func _stump() -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_trunk(st, 0.4, 0.36, 0.6, 7, Color(0.36, 0.26, 0.18, 0.0))
	return st.commit()

## A rounded clump of leaves on a stub.
static func _bush() -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sphere := SphereMesh.new()
	sphere.radius = 1.0
	sphere.height = 1.5
	sphere.radial_segments = 8
	sphere.rings = 4
	var arr := sphere.get_mesh_arrays()
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var ns: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var ix: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	for k in range(0, ix.size(), 3):
		var tri := []
		var cols := []
		for j in 3:
			var v := vs[ix[k + j]]
			tri.append(v * Vector3(1.0, 0.8, 1.0) + Vector3(0, 0.55, 0))
			cols.append(Color(0.2, 0.36, 0.18, 1.0).lerp(Color(0.32, 0.46, 0.2, 1.0), clampf(v.y + 0.5, 0.0, 1.0)))
		var nn: Vector3 = (ns[ix[k]] + ns[ix[k + 1]] + ns[ix[k + 2]]).normalized()
		_tri(st, tri[0], tri[1], tri[2], nn, cols[0], cols[1], cols[2])
	return st.commit()

## A lumpy rock: an icosphere pushed about by noise, flat-shaded.
static func _rock(seed: int, col: Color) -> Mesh:
	var sphere := SphereMesh.new()
	sphere.radius = 1.0
	sphere.height = 2.0
	sphere.radial_segments = 9
	sphere.rings = 5
	var arr := sphere.get_mesh_arrays()
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var ix: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var n := FastNoiseLite.new()
	n.seed = seed
	n.frequency = 0.9
	for i in vs.size():
		var v := vs[i]
		vs[i] = v * (1.0 + 0.35 * n.get_noise_3dv(v * 2.0)) * Vector3(1.2, 0.7, 1.0)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in range(0, ix.size(), 3):
		var a := vs[ix[k]]
		var b := vs[ix[k + 1]]
		var c := vs[ix[k + 2]]
		var nn := (b - a).cross(c - a).normalized()
		if nn.dot(a + b + c) < 0.0:
			nn = -nn
		var shade := 0.85 + 0.15 * nn.y
		var sc := Color(col.r * shade, col.g * shade, col.b * shade, 0.0)
		_tri(st, a, b, c, nn, sc, sc, sc)
	return st.commit()

## A crystal shard: a tall hexagonal prism with a point.
static func _shard() -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var col := Color(0.62, 0.78, 0.95, 0.0)
	var sides := 6
	for i in sides:
		var a0 := TAU * i / sides
		var a1 := TAU * (i + 1) / sides
		var b0 := Vector3(cos(a0) * 0.5, -0.4, sin(a0) * 0.5)
		var b1 := Vector3(cos(a1) * 0.5, -0.4, sin(a1) * 0.5)
		var t0 := Vector3(cos(a0) * 0.4, 2.6, sin(a0) * 0.4)
		var t1 := Vector3(cos(a1) * 0.4, 2.6, sin(a1) * 0.4)
		var apex := Vector3(0, 3.6, 0)
		var n := Vector3(cos((a0 + a1) / 2.0), 0.1, sin((a0 + a1) / 2.0)).normalized()
		var dk := col.darkened(0.2)
		_tri(st, b0, t0, b1, n, dk, dk, dk)
		_tri(st, b1, t0, t1, n, dk, dk, dk)
		_tri(st, t0, apex, t1, (n + Vector3.UP).normalized(), col, col, col)
	return st.commit()
