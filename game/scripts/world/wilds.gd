class_name Wilds
extends Node3D
## Earth's surface, two centuries after people left it: the sandstone pillar
## country of Wulingyuan, a river valley gone back to jungle. Built when the
## scene loads, from noise, so it costs almost nothing to download:
##
##   the valley, its river and the hills (one heightmap: a mesh to see and a
##   heightfield to hit); a forest of pillars hundreds of metres tall; a
##   stone arch across the valley; a drowned city of overgrown towers, one
##   fallen across the river; a cliff with a waterfall and a plateau above
##   it; jungle everywhere; banks of mist; birds wheeling; a low gold sun.
##
## The route through it (`gates`) is laid first and everything solid is kept
## clear of it, so the line is always flyable, close to rock but never in it.
## Godot's -Z is "downstream": the route runs from z = +800 to the plateau.

const SUN := Vector3(0.78, 0.36, -0.28)
const CLIFF_Z := -7330.0        # the cliff face begins here, the plateau beyond
const PLATEAU_Y := 270.0
const PAD_Z := -7860.0
const WATER_Y := -1.0

var hq := true
## The route: each gate's centre, in order.
var gates: Array[Vector3] = []
var pad := Vector3.ZERO
var shuttle_spot := Vector3.ZERO
var fallen_gate := 12            # the gate under the fallen tower
var rockfall_tower: Node3D
var _noise := FastNoiseLite.new()
var _big := FastNoiseLite.new()
var _route2d: PackedVector2Array

## The river's line across the valley at a given z.
static func centre_x(z: float) -> float:
	return 320.0 * sin(z / 1500.0) + 140.0 * sin(z / 560.0 + 1.3)

func _init() -> void:
	_noise.seed = 3091
	_noise.frequency = 0.004
	_noise.fractal_octaves = 4
	_big.seed = 214
	_big.frequency = 0.0009
	_big.fractal_octaves = 3

func _ready() -> void:
	hq = Flow.high_quality()
	var t := Time.get_ticks_msec()
	for step in [_lay_route, _terrain, _water, _pillars, _arch, _city, _falls, _forest, _mist, _birds]:
		step.call()
		if "--timing" in OS.get_cmdline_user_args():
			printerr("wilds %s %d ms" % [step.get_method(), Time.get_ticks_msec() - t])
			t = Time.get_ticks_msec()

# --- The route --------------------------------------------------------------

func _lay_route() -> void:
	# z, offset from the river, height above the valley floor.
	var plan := [
		[-300.0, 0.0, 430.0], [-900.0, 40.0, 210.0], [-1350.0, -60.0, 110.0], [-1800.0, 70.0, 90.0],
		[-2250.0, -50.0, 120.0], [-2700.0, 60.0, 80.0], [-3150.0, -40.0, 140.0], [-3600.0, 50.0, 90.0],
		[-4050.0, 0.0, 110.0], [-4400.0, 0.0, 95.0],
		[-4900.0, 30.0, 60.0], [-5350.0, -40.0, 45.0], [-5800.0, 0.0, 20.0], [-6250.0, 35.0, 50.0],
		[-6700.0, -30.0, 40.0], [-7120.0, 0.0, 40.0],
		[-7200.0, 0.0, 120.0], [-7280.0, 0.0, 255.0], [-7385.0, 0.0, 352.0],
	]
	for p in plan:
		var z: float = p[0]
		var x := centre_x(z) + float(p[1])
		gates.append(Vector3(x, float(p[2]), z))
	pad = Vector3(centre_x(PAD_Z) + 40.0, PLATEAU_Y, PAD_Z)
	shuttle_spot = pad + Vector3(34.0, 0.0, -18.0)
	_route2d = PackedVector2Array()
	_route2d.append(Vector2(centre_x(900.0), 900.0))
	for g in gates:
		_route2d.append(Vector2(g.x, g.z))
	_route2d.append(Vector2(pad.x, pad.z))

## Horizontal distance from a point to the route line.
func route_clearance(x: float, z: float) -> float:
	var best := 1e9
	var p := Vector2(x, z)
	for i in _route2d.size() - 1:
		var a := _route2d[i]
		var b := _route2d[i + 1]
		var ab := b - a
		var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.001), 0.0, 1.0)
		best = minf(best, p.distance_to(a + ab * t))
	return best

# --- Ground -------------------------------------------------------------------

## The land's height at (x, z): a river valley between hills, the river cut
## into its floor, and beyond the cliff a plateau with the landing pad.
func height(x: float, z: float) -> float:
	var c := centre_x(z)
	var d := absf(x - c)
	var n := _noise.get_noise_2d(x, z)
	var big := _big.get_noise_2d(x, z)
	var floor_h := 9.0 + n * 7.0
	# Mountains wall the valley in, higher than anything flies, so the
	# world's edge is never seen; they close both ends too.
	var ends := maxf(_ease((z - 300.0) / 1000.0), _ease((-8500.0 - z) / 1100.0))
	var hills := 70.0 + 820.0 * _ease((d - 320.0) / 1500.0) + big * 170.0 + n * 50.0
	var h := lerpf(floor_h, hills, _ease((d - 230.0) / 520.0))
	h = lerpf(-8.0, h, _ease((d - 32.0) / 34.0))
	# The cliff and the plateau above it.
	var t := _ease((CLIFF_Z - z) / 34.0)
	if t > 0.0:
		var top := PLATEAU_Y + n * 5.0 + maxf(0.0, (d - 500.0) * 0.25)
		top = lerpf(PLATEAU_Y - 9.0, top, _ease((d - 26.0) / 20.0))   # the upper river
		h = lerpf(h, maxf(h, top), t)
	h = lerpf(h, maxf(h, 900.0 + big * 150.0), ends * _ease((d - 120.0) / 400.0))
	# The pad: flat.
	var to_pad := Vector2(x - pad.x, z - pad.z).length()
	if to_pad < 140.0:
		h = lerpf(PLATEAU_Y, h, _ease((to_pad - 70.0) / 70.0))
	return h

static func _ease(t: float) -> float:
	t = clampf(t, 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

func _terrain() -> void:
	var s := 16.0 if hq else 24.0
	var x0 := -2200.0
	var z0 := 1400.0
	var nx := int(4400.0 / s) + 1
	var nz := int(11400.0 / s) + 1
	var hs := PackedFloat32Array()
	hs.resize(nx * nz)
	for j in nz:
		var z := z0 - j * s
		for i in nx:
			hs[j * nx + i] = height(x0 + i * s, z)
	# The mesh.
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	verts.resize(nx * nz)
	norms.resize(nx * nz)
	for j in nz:
		for i in nx:
			var k := j * nx + i
			verts[k] = Vector3(x0 + i * s, hs[k], z0 - j * s)
			var hl := hs[k - 1] if i > 0 else hs[k]
			var hr := hs[k + 1] if i < nx - 1 else hs[k]
			var hd := hs[k - nx] if j > 0 else hs[k]
			var hu := hs[k + nx] if j < nz - 1 else hs[k]
			norms[k] = Vector3(hl - hr, 2.0 * s, hu - hd).normalized()
	# Tiles of 32 cells, so what is behind the ship or off to the side is
	# skipped, and what is deep in the haze is not drawn at all.
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/terrain.gdshader")
	m.set_shader_parameter("ground_map", Surfaces._tex("Ground037", "Color"))
	m.set_shader_parameter("ground_normal", Surfaces._tex("Ground037", "NormalGL"))
	m.set_shader_parameter("rock_map", Surfaces._tex("Rock030", "Color"))
	m.set_shader_parameter("rock_normal", Surfaces._tex("Rock030", "NormalGL"))
	m.set_shader_parameter("water_level", WATER_Y)
	m.set_shader_parameter("canopy_map", load("res://art/foliage/dense.png"))
	var tile := 32
	for tj in range(0, nz - 1, tile):
		for ti in range(0, nx - 1, tile):
			var cw := mini(tile, nx - 1 - ti)
			var ch := mini(tile, nz - 1 - tj)
			var tv := PackedVector3Array()
			var tn := PackedVector3Array()
			tv.resize((cw + 1) * (ch + 1))
			tn.resize((cw + 1) * (ch + 1))
			for j in ch + 1:
				for i in cw + 1:
					var k := (tj + j) * nx + ti + i
					tv[j * (cw + 1) + i] = verts[k]
					tn[j * (cw + 1) + i] = norms[k]
			var idx := PackedInt32Array()
			idx.resize(cw * ch * 6)
			var w := 0
			for j in ch:
				for i in cw:
					var a := j * (cw + 1) + i
					var b := a + 1
					var c := a + cw + 1
					var d := c + 1
					# Clockwise from above: Godot's front faces.
					idx[w] = a; idx[w + 1] = c; idx[w + 2] = b
					idx[w + 3] = b; idx[w + 4] = c; idx[w + 5] = d
					w += 6
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = tv
			arrays[Mesh.ARRAY_NORMAL] = tn
			arrays[Mesh.ARRAY_INDEX] = idx
			var mesh := ArrayMesh.new()
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			mesh.surface_set_material(0, m)
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.visibility_range_end = 5200.0
			add_child(mi)
	# The heightfield to hit: uniform scale (heights divided by the spacing).
	var hm := HeightMapShape3D.new()
	hm.map_width = nx
	hm.map_depth = nz
	# The shape's rows run toward +Z; ours were laid toward -Z, so the rows go
	# in reversed (a mirrored shape would be the other way, and physics
	# engines dislike negative scale).
	var data := PackedFloat32Array()
	data.resize(nx * nz)
	for r in nz:
		var j := nz - 1 - r
		for i in nx:
			data[r * nx + i] = hs[j * nx + i] / s
	hm.map_data = data
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = hm
	body.add_child(cs)
	add_child(body)
	# The heightfield is centred on its node, its rows running +Z.
	body.scale = Vector3.ONE * s
	body.position = Vector3(x0 + (nx - 1) * s / 2.0, 0.0, z0 - (nz - 1) * s / 2.0)

func _water() -> void:
	var p := PlaneMesh.new()
	p.size = Vector2(4400, 11400)
	p.subdivide_width = 4
	p.subdivide_depth = 8
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/water.gdshader")
	p.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = p
	mi.position = Vector3(0, WATER_Y, -4300)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# The upper river, on the plateau.
	var up := MeshInstance3D.new()
	var p2 := PlaneMesh.new()
	p2.size = Vector2(1400, 2300)
	p2.material = m
	up.mesh = p2
	up.position = Vector3(centre_x(-8400.0), PLATEAU_Y - 4.0, -8460)
	up.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(up)

func _rock_material() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/rock.gdshader")
	m.set_shader_parameter("rock_map", Surfaces._tex("Rock030", "Color"))
	m.set_shader_parameter("rock_normal", Surfaces._tex("Rock030", "NormalGL"))
	m.set_shader_parameter("moss_map", Surfaces._tex("Ground037", "Color"))
	return m

# --- Pillars --------------------------------------------------------------------

## A sandstone pillar, unit radius and height: ridged, banded, flaring a
## little at the foot, crowned with a rounded top.
func _pillar_mesh(seed: int) -> ArrayMesh:
	var n := FastNoiseLite.new()
	n.seed = seed
	n.frequency = 1.3
	var seg := 22
	var rings := 30
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := []
	for r in rings + 1:
		var y := float(r) / rings
		var row := []
		var flare := 1.0 + 0.3 * pow(1.0 - y, 6.0)
		var crown := 1.0 - pow(maxf(0.0, (y - 0.9) / 0.1), 2.0) * 0.55
		for k in seg:
			var a := TAU * k / seg
			var rr := (1.0 + 0.22 * n.get_noise_3d(cos(a) * 1.5, y * 6.0, sin(a) * 1.5) + 0.06 * sin(a * 7.0 + seed)) * flare * crown
			row.append(Vector3(cos(a) * rr, y, sin(a) * rr))
		pts.append(row)
	for r in rings:
		for k in seg:
			var k2 := (k + 1) % seg
			var a: Vector3 = pts[r][k]
			var b: Vector3 = pts[r][k2]
			var c: Vector3 = pts[r + 1][k]
			var d: Vector3 = pts[r + 1][k2]
			st.add_vertex(a); st.add_vertex(c); st.add_vertex(b)
			st.add_vertex(b); st.add_vertex(c); st.add_vertex(d)
	# The top, a shallow dome.
	var top := Vector3(0, 1.04, 0)
	for k in seg:
		st.add_vertex(pts[rings][k]); st.add_vertex(top); st.add_vertex(pts[rings][(k + 1) % seg])
	st.index()
	st.generate_normals()
	return st.commit()

var _pillar_tops: Array = []    # [top centre, radius] for trees
var _pillar_sides: Array = []   # [base centre, radius, height] for ledge plants and vines

## The first mesh in a model from Blender.
func _glb_mesh(path: String) -> Mesh:
	var scene: Node = load(path).instantiate()
	var mi: MeshInstance3D = scene.find_children("*", "MeshInstance3D", true, false)[0]
	var m := mi.mesh
	scene.free()
	return m

func _pillars() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	# Sculpted in Blender (art/godot/pillars.py): 300 m tall, 25 m radius.
	var variants := 4
	var meshes: Array[Mesh] = []
	for v in variants:
		meshes.append(_glb_mesh("res://art/pillar-%d.glb" % v))
	var xforms: Array = []
	for v in variants:
		xforms.append([])
	var placed: Array = []
	# Gateways: a pair of pillars either side of some markers, the gap just
	# wide enough to thread at speed.
	for gi in [2, 4, 5, 7]:
		var g: Vector3 = gates[gi]
		var prev: Vector3 = gates[gi - 1]
		var along := Vector2(g.x - prev.x, g.z - prev.z).normalized()
		var across := Vector2(-along.y, along.x)
		for sgn in [-1.0, 1.0]:
			var r := rng.randf_range(20.0, 30.0)
			var at: Vector2 = Vector2(g.x, g.z) + across * float(sgn) * (r + 26.0)
			var base := height(at.x, at.y) - 20.0
			var tall := rng.randf_range(260.0, 380.0)
			placed.append([at.x, at.y, r])
			var v := rng.randi() % variants
			(xforms[v] as Array).append(Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3(r / 25.0, tall / 300.0, r / 25.0)), Vector3(at.x, base, at.y)))
			_pillar_tops.append([Vector3(at.x, base + tall, at.y), r * 0.75])
			_pillar_sides.append([Vector3(at.x, base, at.y), r, tall])
			var body := StaticBody3D.new()
			var cs := CollisionShape3D.new()
			var cyl := CylinderShape3D.new()
			cyl.radius = r * 0.93
			cyl.height = tall
			cs.shape = cyl
			body.add_child(cs)
			add_child(body)
			body.position = Vector3(at.x, base + tall / 2.0, at.y)
	var tries := 0
	var want := 150 if hq else 110
	while placed.size() < want and tries < 6000:
		tries += 1
		var z := rng.randf_range(-4300.0, -600.0)
		var spread := rng.randf_range(-1.0, 1.0)
		var x := centre_x(z) + spread * absf(spread) * 900.0
		var r := rng.randf_range(16.0, 46.0)
		# Clear of the route, with room for close calls but not for crashes.
		var clear := route_clearance(x, z)
		if clear < r * 1.02 + 22.0:
			continue
		var ok := true
		for q in placed:
			if Vector2(x, z).distance_to(Vector2(q[0], q[1])) < r + float(q[2]) + 18.0:
				ok = false
				break
		if not ok:
			continue
		var base := height(x, z) - 20.0
		var tall := rng.randf_range(190.0, 430.0) * (0.75 if clear > 500.0 else 1.0)
		placed.append([x, z, r])
		var v := rng.randi() % variants
		var b := Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3(r / 25.0, tall / 300.0, r / 25.0))
		(xforms[v] as Array).append(Transform3D(b, Vector3(x, base, z)))
		_pillar_tops.append([Vector3(x, base + tall * 1.0, z), r * 0.75])
		_pillar_sides.append([Vector3(x, base, z), r, tall])
		# Solid: a cylinder a little inside the rock (bumps stand proud of it).
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var cyl := CylinderShape3D.new()
		cyl.radius = r * 0.93
		cyl.height = tall
		cs.shape = cyl
		body.add_child(cs)
		add_child(body)
		body.position = Vector3(x, base + tall / 2.0, z)
	# In 600 m squares, so distant ones use the simpler levels of detail
	# Godot made on import and the ones behind are skipped.
	var mat := _rock_material()
	var groups := {}
	for v in variants:
		for xf: Transform3D in xforms[v]:
			var key := "%d|%d_%d" % [v, int(floor(xf.origin.x / 600.0)), int(floor(xf.origin.z / 600.0))]
			if not groups.has(key):
				groups[key] = []
			(groups[key] as Array).append(xf)
	for key in groups:
		var list: Array = groups[key]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = meshes[int(String(key).get_slice("|", 0))]
		mm.instance_count = list.size()
		for i in list.size():
			mm.set_instance_transform(i, list[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mat
		add_child(mmi)

# --- The arch -------------------------------------------------------------------

func _arch() -> void:
	var z := -4400.0
	var cx := centre_x(z)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := FastNoiseLite.new()
	n.seed = 9
	n.frequency = 2.0
	var along := 48
	var around := 16
	var big_r := 210.0
	var pts := []
	for i in along + 1:
		var t := PI * float(i) / along
		var centre := Vector3(cx - cos(t) * big_r, sin(t) * big_r * 1.05 - 30.0, z)
		var tangent := Vector3(sin(t), cos(t) * 1.05, 0.0).normalized()
		var side := Vector3(0, 0, 1)
		var up := tangent.cross(side).normalized()
		var row := []
		var thick := 30.0 + 14.0 * pow(absf(cos(t)), 3.0)
		for k in around:
			var a := TAU * k / around
			var rr := thick * (1.0 + 0.25 * n.get_noise_2d(i * 0.3, k * 0.6))
			row.append(centre + (up * cos(a) + side * sin(a) * 0.8) * rr)
		pts.append(row)
	for i in along:
		for k in around:
			var k2 := (k + 1) % around
			st.add_vertex(pts[i][k]); st.add_vertex(pts[i][k2]); st.add_vertex(pts[i + 1][k])
			st.add_vertex(pts[i][k2]); st.add_vertex(pts[i + 1][k2]); st.add_vertex(pts[i + 1][k])
	st.index()
	st.generate_normals()
	var mesh := st.commit()
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _rock_material()
	add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = mesh.create_trimesh_shape()
	body.add_child(cs)
	add_child(body)
	for k in 6:
		var t := PI * (0.3 + 0.4 * k / 5.0)
		_pillar_tops.append([Vector3(cx - cos(t) * big_r, sin(t) * big_r * 1.05 - 30.0 + 30.0, z), 14.0])

# --- The drowned city -------------------------------------------------------------

func _ruin_material() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/ruin.gdshader")
	m.set_shader_parameter("moss_map", Surfaces._tex("Ground037", "Color"))
	m.set_shader_parameter("rock_map", Surfaces._tex("Rock030", "Color"))
	return m

func _tower(at: Vector3, size: Vector3, tilt: Vector3, mat: Material) -> Node3D:
	var root := Node3D.new()
	add_child(root)
	root.position = at
	root.rotation = tilt
	# A modelled ruin (art/godot/ruins.py: 30 x 150 x 24 m), scaled to fit.
	var mi := MeshInstance3D.new()
	mi.mesh = _ruins[randi() % _ruins.size()]
	mi.material_override = mat
	mi.scale = Vector3(size.x / 30.0, size.y / 151.0, size.z / 24.0)
	root.add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	body.add_child(cs)
	body.position.y = size.y / 2.0
	root.add_child(body)
	return root

var _ruins: Array[Mesh] = []

func _city() -> void:
	for k in 3:
		_ruins.append(_glb_mesh("res://art/ruin-%d.glb" % k))
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var mat := _ruin_material()
	var side := 1.0
	var z := -4720.0
	while z > -7000.0:
		var cx := centre_x(z)
		var w := rng.randf_range(28.0, 52.0)
		var off := rng.randf_range(70.0, 190.0)
		var x := cx + side * off
		if route_clearance(x, z) > w * 0.8 + 32.0:
			var tall := rng.randf_range(80.0, 230.0)
			var t := _tower(Vector3(x, height(x, z) - 6.0, z), Vector3(w, tall, rng.randf_range(28.0, 50.0)),
				Vector3(rng.randf_range(-0.07, 0.07), rng.randf_range(-0.4, 0.4), rng.randf_range(-0.07, 0.07)), mat)
			_pillar_tops.append([t.position + Vector3(0, tall, 0), w * 0.4])
			if absf(z + 6620.0) < 130.0 and rockfall_tower == null:
				rockfall_tower = t
		side = -side
		z -= rng.randf_range(95.0, 150.0)
	# The fallen tower across the river: fly under it.
	var g: Vector3 = gates[fallen_gate]
	var fallen := _tower(Vector3(g.x - 150.0, g.y + 28.0, g.z + 40.0), Vector3(36.0, 320.0, 36.0), Vector3(0.0, 0.25, -1.5), mat)
	fallen.name = "FallenTower"

# --- The falls ----------------------------------------------------------------

func _falls() -> void:
	var x := centre_x(CLIFF_Z)
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/waterfall.gdshader")
	# Three sheets, the front one widest, each poured from the lip and
	# bowing out a little as it falls, like a real curtain of water.
	for layer in 3:
		var w := 58.0 - layer * 12.0
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var rows := 24
		var cols := 8
		for j in rows:
			for i in cols:
				for c in [[i, j], [i + 1, j], [i, j + 1], [i + 1, j], [i + 1, j + 1], [i, j + 1]]:
					var u := float(c[0]) / cols
					var v := float(c[1]) / rows
					var y := PLATEAU_Y + 2.0 - v * (PLATEAU_Y + 4.0)
					# Out over the cliff face (34 m of run from lip to foot), and a
					# little more in the middle of the fall.
					var bow := v * 40.0 + sin(v * PI) * (7.0 - layer * 2.0)
					st.set_uv(Vector2(u, v))
					st.add_vertex(Vector3((u - 0.5) * w * (1.0 + v * 0.25), y, -bow))
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = Vector3(x + (layer - 1) * 6.0, 0.0, CLIFF_Z - 34.0 - 1.0 + layer * 1.5)
		mi.rotation.y = PI
		add_child(mi)
	# The cliff itself: sculpted rock buttresses set into the face, so it is
	# fissured, ledged and mossy like the pillars, not a smooth slope. A gap
	# is left for the falls and the climb.
	var mats := _rock_material()
	var rng := RandomNumberGenerator.new()
	rng.seed = 404
	var groups := {}
	var off := -900.0
	while off < 900.0:
		var bx := x + off
		var w := rng.randf_range(22.0, 36.0)
		off += w * 1.5
		if absf(bx - x) < w + 32.0:
			continue
		var bz := CLIFF_Z - 17.0 + rng.randf_range(-6.0, 6.0)
		var base := height(bx, CLIFF_Z + 20.0) - 25.0
		var tall := PLATEAU_Y - base + rng.randf_range(4.0, 26.0)
		var v := rng.randi() % 4
		if not groups.has(v):
			groups[v] = []
		(groups[v] as Array).append(Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3(w / 25.0, tall / 300.0, w / 25.0 * 0.8)), Vector3(bx, base, bz)))
		_pillar_tops.append([Vector3(bx, base + tall, bz), w * 0.6])
		_pillar_sides.append([Vector3(bx, base, bz), w, tall])
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var cyl := CylinderShape3D.new()
		cyl.radius = w * 0.85
		cyl.height = tall
		cs.shape = cyl
		body.add_child(cs)
		add_child(body)
		body.position = Vector3(bx, base + tall / 2.0, bz)
	for v in groups:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = _glb_mesh("res://art/pillar-%d.glb" % v)
		mm.instance_count = groups[v].size()
		for i in mm.instance_count:
			mm.set_instance_transform(i, groups[v][i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mats
		add_child(mmi)
	# Spray and mist where it lands, rising up the face.
	var spray := GPUParticles3D.new() if hq else null
	if spray:
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		pm.emission_box_extents = Vector3(30, 2, 8)
		pm.direction = Vector3(0, 1, 0.4)
		pm.spread = 40.0
		pm.initial_velocity_min = 8.0
		pm.initial_velocity_max = 22.0
		pm.gravity = Vector3(0, -1.5, 0)
		pm.scale_min = 10.0
		pm.scale_max = 26.0
		pm.color = Color(1, 1, 1, 0.35)
		spray.process_material = pm
		spray.amount = 90
		spray.lifetime = 6.0
		var q := QuadMesh.new()
		q.size = Vector2(1, 1)
		var sm := StandardMaterial3D.new()
		sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		sm.vertex_color_use_as_albedo = true
		var g := GradientTexture2D.new()
		var gr := Gradient.new()
		gr.set_color(0, Color(1, 1, 1, 1))
		gr.set_color(1, Color(1, 1, 1, 0))
		g.gradient = gr
		g.fill = GradientTexture2D.FILL_RADIAL
		g.fill_from = Vector2(0.5, 0.5)
		g.fill_to = Vector2(1.0, 0.5)
		sm.albedo_texture = g
		q.material = sm
		spray.draw_pass_1 = q
		spray.visibility_aabb = AABB(Vector3(-80, -10, -60), Vector3(160, 200, 120))
		add_child(spray)
		spray.position = Vector3(x, 2.0, CLIFF_Z + 6.0)
	for k in 7:
		_mist_at(Vector3(x + randf_range(-55, 55), 14.0 + k * 30.0, CLIFF_Z + randf_range(4.0, 40.0)), Vector2(150, 70), 0.9)
	# The plunge pool's foam.
	var foam := MeshInstance3D.new()
	var fp := PlaneMesh.new()
	fp.size = Vector2(110, 70)
	var fm := ShaderMaterial.new()
	fm.shader = load("res://shaders/foam.gdshader")
	fp.material = fm
	foam.mesh = fp
	foam.position = Vector3(x, WATER_Y + 0.15, CLIFF_Z + 18.0)
	foam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(foam)

# --- Jungle -------------------------------------------------------------------

## One jungle tree, unit height: a short trunk under a wide, lumpy crown
## (crowns packed together read as canopy from the air). Two surfaces, bark
## and leaves, so one multimesh draws whole trees; about 130 triangles.
func _tree_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var seg := 5
	for k in seg:
		var a := TAU * k / seg
		var b := TAU * (k + 1) / seg
		var p0 := Vector3(cos(a) * 0.04, 0, sin(a) * 0.04)
		var p1 := Vector3(cos(b) * 0.04, 0, sin(b) * 0.04)
		var p2 := Vector3(cos(a) * 0.02, 0.6, sin(a) * 0.02)
		var p3 := Vector3(cos(b) * 0.02, 0.6, sin(b) * 0.02)
		st.add_vertex(p0); st.add_vertex(p1); st.add_vertex(p2)
		st.add_vertex(p1); st.add_vertex(p3); st.add_vertex(p2)
	st.generate_normals()
	var bark := StandardMaterial3D.new()
	bark.albedo_color = Color(0.2, 0.16, 0.12)
	bark.roughness = 1.0
	bark.cull_mode = BaseMaterial3D.CULL_DISABLED
	st.set_material(bark)
	var mesh := st.commit()
	var lv := SurfaceTool.new()
	lv.begin(Mesh.PRIMITIVE_TRIANGLES)
	var blobs := [[Vector3(0, 0.74, 0), 0.5], [Vector3(0.22, 0.62, 0.1), 0.36]]
	var n := FastNoiseLite.new()
	n.frequency = 2.5
	for bl in blobs:
		var c: Vector3 = bl[0]
		var r: float = bl[1]
		var sp := SphereMesh.new()
		sp.radius = r
		sp.height = r * 1.7
		sp.radial_segments = 6
		sp.rings = 3
		var arr := sp.get_mesh_arrays()
		var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var ix: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
		for i in ix.size():
			var v: Vector3 = vs[ix[i]]
			v *= 1.0 + 0.3 * n.get_noise_3dv(v * 3.0 + c * 7.0)
			lv.set_color(Color(1, 1, 1).lerp(Color(0.62, 0.72, 0.5), clampf(0.3 - v.y * 2.5, 0.0, 1.0)))
			lv.add_vertex(c + v)
	lv.index()
	lv.generate_normals()
	var leaves := ShaderMaterial.new()
	leaves.shader = load("res://shaders/foliage.gdshader")
	lv.set_material(leaves)
	return lv.commit(mesh)

func _forest() -> void:
	if "--notrees" in OS.get_cmdline_user_args():
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	# Species, their real height (for the far stand-in) and crown width.
	var spec := {"giant": [30.0, 22.0], "tree": [15.0, 11.0], "tree2": [19.0, 13.0], "palm": [13.0, 10.0], "shrub": [2.5, 3.0]}
	var count := 42000 if hq else 12000
	var near_far := 400.0 if hq else 320.0
	var plants := []        # [species, transform, tint]
	var tries := 0
	while plants.size() < count and tries < count * 5:
		tries += 1
		var z := rng.randf_range(-9200.0, 1100.0)
		# Thickest near the river, where the ship flies; thinning up the hills
		# (the canopy texture on the ground carries the forest on from there).
		var spread := rng.randf_range(-1.0, 1.0)
		var x := centre_x(z) + spread * absf(spread) * 650.0
		if not plants.is_empty() and rng.randf() < 0.75:
			var near: Vector3 = (plants[rng.randi() % plants.size()][1] as Transform3D).origin
			x = near.x + rng.randf_range(-11.0, 11.0)
			z = near.z + rng.randf_range(-11.0, 11.0)
		var d := absf(x - centre_x(z))
		if d < 48.0 and z > CLIFF_Z or (z < CLIFF_Z and d < 34.0):
			continue
		if Vector2(x - pad.x, z - pad.z).length() < 95.0 or Vector2(x - shuttle_spot.x, z - shuttle_spot.z).length() < 40.0:
			continue
		var h := height(x, z)
		var slope := absf(height(x + 6.0, z) - h) + absf(height(x, z + 6.0) - h)
		if slope > 8.0 or h < WATER_Y + 1.0:
			continue
		var roll := rng.randf()
		var sp := ""
		if d < 150.0 and z > CLIFF_Z:
			sp = "palm" if roll < 0.35 else ("tree" if roll < 0.75 else "shrub")
		else:
			sp = "giant" if roll < 0.1 else ("tree" if roll < 0.55 else ("tree2" if roll < 0.9 else ("palm" if roll < 0.95 else "shrub")))
		var sc := rng.randf_range(0.8, 1.25)
		var xf := Transform3D(Basis.from_euler(Vector3(rng.randf_range(-0.05, 0.05), rng.randf() * TAU, rng.randf_range(-0.05, 0.05))).scaled(Vector3.ONE * sc), Vector3(x, h - 0.6, z))
		var hue := rng.randf()
		plants.append([sp, xf, Color(0.82, 0.9, 0.78).lerp(Color(1.15, 1.08, 0.75), hue * hue) * rng.randf_range(0.8, 1.08)])
	# Crowns on the pillar tops, the arch and the towers.
	for top in _pillar_tops:
		var c: Vector3 = top[0]
		var r: float = top[1]
		for k in (7 if hq else 4):
			var a := rng.randf() * TAU
			var p := c + Vector3(cos(a), 0, sin(a)) * rng.randf_range(0.0, r)
			var sp := "tree" if rng.randf() < 0.5 else "shrub"
			plants.append([sp, Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3.ONE * rng.randf_range(0.6, 1.0)), p - Vector3(0, 1.5, 0)), Color(0.9, 1.0, 0.85)])
	# Vines down the pillar faces from the crown, plants on the ledges.
	for side in _pillar_sides:
		var c: Vector3 = side[0]
		var r: float = side[1]
		var tall: float = side[2]
		for k in (7 if hq else 3):
			var a := rng.randf() * TAU
			var out := Vector3(cos(a), 0, sin(a))
			var y := tall * rng.randf_range(0.9, 0.97)
			plants.append(["vine", Transform3D(Basis.looking_at(out, Vector3.UP).scaled(Vector3.ONE * rng.randf_range(1.0, 1.8)), c + out * r * 0.98 + Vector3(0, y, 0)), Color(0.9, 1.0, 0.85)])
		for k in (10 if hq else 4):
			var a := rng.randf() * TAU
			var out := Vector3(cos(a), 0, sin(a))
			var y := tall * rng.randf_range(0.15, 0.85)
			plants.append(["fern" if rng.randf() < 0.5 else "shrub", Transform3D(Basis.looking_at(out, Vector3.UP).rotated(out.cross(Vector3.UP).normalized(), 0.5).scaled(Vector3.ONE * rng.randf_range(1.5, 2.8)), c + out * r * 0.95 + Vector3(0, y, 0)), Color(0.9, 1.0, 0.85)])
	# Near: the real plants, by species and by 500 m square. Far: the cheap
	# crowns in the same places, from where the real ones stop.
	var near := {}
	var far := {}
	for pl in plants:
		var xf: Transform3D = pl[1]
		var key := "%d_%d" % [int(floor(xf.origin.x / 500.0)), int(floor(xf.origin.z / 500.0))]
		var nk: String = pl[0] + "|" + key
		if not near.has(nk):
			near[nk] = [[], []]
		near[nk][0].append(xf)
		near[nk][1].append(pl[2])
		if spec.has(pl[0]) and pl[0] != "shrub":
			var size: Array = spec[pl[0]]
			var s := xf.basis.get_scale().x
			var b := Basis.from_euler(Vector3(0, xf.basis.get_euler().y, 0)).scaled(Vector3(size[1] * s * 0.55, size[0] * s, size[1] * s * 0.55))
			if not far.has(key):
				far[key] = [[], []]
			far[key][0].append(Transform3D(b, xf.origin))
			far[key][1].append(pl[2])
	for nk in near:
		Flora.batch(self, String(nk).get_slice("|", 0), near[nk][0], near[nk][1], 0.0, near_far, hq and Flow.settings.cinematic)
	var blob := _tree_mesh()
	for key in far:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = blob
		mm.instance_count = far[key][0].size()
		for i in mm.instance_count:
			mm.set_instance_transform(i, far[key][0][i])
			mm.set_instance_color(i, far[key][1][i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.visibility_range_begin = near_far - 60.0
		mmi.visibility_range_end = 3200.0
		add_child(mmi)
	_undergrowth(rng)

## Ferns and bushes on the jungle floor, only near the ship (they are what
## makes the ground read as jungle when flying low).
func _undergrowth(rng: RandomNumberGenerator) -> void:
	var count := 45000 if hq else 12000
	var cells := {}
	for i in count:
		var z := rng.randf_range(-7300.0, 1000.0)
		var spread := rng.randf_range(-1.0, 1.0)
		var x := centre_x(z) + spread * absf(spread) * 900.0
		var d := absf(x - centre_x(z))
		if d < 40.0:
			continue
		var h := height(x, z)
		if h < WATER_Y + 0.8:
			continue
		var sp := "fern" if rng.randf() < 0.7 else "shrub"
		var key := "%s|%d_%d" % [sp, int(floor(x / 250.0)), int(floor(z / 250.0))]
		if not cells.has(key):
			cells[key] = [[], []]
		var sc := rng.randf_range(0.9, 2.0) if sp == "fern" else rng.randf_range(0.8, 1.6)
		cells[key][0].append(Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3.ONE * sc), Vector3(x, h - 0.2, z)))
		cells[key][1].append(Color(0.85, 0.95, 0.8) * rng.randf_range(0.75, 1.05))
	for key in cells:
		Flora.batch(self, String(key).get_slice("|", 0), cells[key][0], cells[key][1], 0.0, 230.0 if hq else 160.0)

# --- Air ------------------------------------------------------------------------

var _mist_mat: ShaderMaterial

func _mist_at(at: Vector3, size: Vector2, density := 0.75) -> void:
	if not _mist_mat:
		_mist_mat = ShaderMaterial.new()
		_mist_mat.shader = load("res://shaders/mist.gdshader")
		_mist_mat.set_shader_parameter("sun_dir", SUN)
	var q := QuadMesh.new()
	q.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = _mist_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = at
	add_child(mi)

func _mist() -> void:
	if "--nomist" in OS.get_cmdline_user_args():
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 21
	# Banks lying in the valley among the pillars and the city.
	for k in (46 if hq else 26):
		var z := rng.randf_range(-7000.0, -500.0)
		var x := centre_x(z) + rng.randf_range(-700.0, 700.0)
		_mist_at(Vector3(x, height(x, z) + rng.randf_range(25.0, 90.0), z), Vector2(rng.randf_range(220, 420), rng.randf_range(60, 120)))
	# The cloud deck the ship comes down through.
	for k in (36 if hq else 20):
		var z := rng.randf_range(-1700.0, 900.0)
		var x := centre_x(z) + rng.randf_range(-1100.0, 1100.0)
		_mist_at(Vector3(x, rng.randf_range(560.0, 820.0), z), Vector2(rng.randf_range(500, 900), rng.randf_range(160, 280)))

func _birds() -> void:
	var q := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1, 0.1, 0.2), Vector3(0, 0, -0.4), Vector3(0, 0, 0.3), Vector3(1, 0.1, 0.2), Vector3(0, 0, 0.3), Vector3(0, 0, -0.4)])
	q.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/birds.gdshader")
	q.surface_set_material(0, m)
	var rng := RandomNumberGenerator.new()
	rng.seed = 33
	for f in 7:
		var z := rng.randf_range(-6800.0, -900.0)
		var centre := Vector3(centre_x(z) + rng.randf_range(-300, 300), height(centre_x(z), z) + rng.randf_range(90, 220), z)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = q
		mm.instance_count = 28
		for i in 28:
			mm.set_instance_transform(i, Transform3D())
			mm.set_instance_custom_data(i, Color(rng.randf_range(40, 140), rng.randf_range(-20, 40), rng.randf_range(0.15, 0.35) * (1.0 if rng.randf() < 0.8 else -1.0), rng.randf()))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.custom_aabb = AABB(Vector3(-200, -60, -200), Vector3(400, 160, 400))
		mmi.position = centre
		add_child(mmi)

# --- Light ----------------------------------------------------------------------

## Golden hour: a low sun ahead down the valley, sky blue overhead and warm
## at the horizon, haze that turns distance blue and fills the valley floor.
static func environment(parent: Node) -> DirectionalLight3D:
	var hq := Flow.high_quality()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.26, 0.45, 0.78)
	sm.sky_horizon_color = Color(0.98, 0.8, 0.6)
	sm.sky_curve = 0.12
	sm.ground_horizon_color = Color(0.85, 0.74, 0.62)
	sm.ground_bottom_color = Color(0.2, 0.26, 0.18)
	sm.sun_angle_max = 18.0
	sm.sun_curve = 0.08
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.75 if hq else 0.95
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.05 if hq else 0.85
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.06
	env.fog_enabled = true
	env.fog_light_color = Color(0.82, 0.8, 0.78)
	env.fog_density = 0.00022
	env.fog_sky_affect = 0.25
	env.fog_sun_scatter = 0.45
	env.fog_aerial_perspective = 0.55
	env.fog_height = 40.0
	env.fog_height_density = 0.0025
	if hq:
		env.ssao_enabled = true
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = 0.004
		env.volumetric_fog_albedo = Color(0.95, 0.9, 0.82)
		env.volumetric_fog_length = 600.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.02
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.86, 0.68)
	sun.light_energy = 2.3
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 450.0 if hq else 300.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	parent.add_child(sun)
	sun.basis = Basis.looking_at(-SUN.normalized(), Vector3.UP)
	return sun
