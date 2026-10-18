class_name Flora
## Plants from art/godot/flora.py, made ready to draw by the thousand: each
## species' parts are merged into one mesh (one surface per material) for a
## MultiMesh, the bark given its scan, the leaves their cards.

const CARDS := {
	"leaf_broad": "broad", "leaf_dense": "dense", "leaf_fern": "fern", "leaf_palm": "palm", "leaf_vine": "vine",
}

static var _meshes := {}
static var _mats := {}

## One species as a single mesh, cached.
static func mesh(species: String) -> ArrayMesh:
	if _meshes.has(species):
		return _meshes[species]
	var scene: Node3D = load("res://art/flora-%s.glb" % species).instantiate()
	var out := ArrayMesh.new()
	for mi: MeshInstance3D in scene.find_children("*", "MeshInstance3D", true, false):
		var xf := _to_root(mi, scene)
		for s in mi.mesh.get_surface_count():
			var arrays := mi.mesh.surface_get_arrays(s)
			var vs: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var ns: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			for i in vs.size():
				vs[i] = xf * vs[i]
				if ns.size() > i:
					ns[i] = (xf.basis * ns[i]).normalized()
			arrays[Mesh.ARRAY_VERTEX] = vs
			arrays[Mesh.ARRAY_NORMAL] = ns
			# Tangents and the like are not needed and would not survive the move.
			arrays[Mesh.ARRAY_TANGENT] = null
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			var src := mi.mesh.surface_get_material(s)
			out.surface_set_material(out.get_surface_count() - 1, material(src.resource_name if src else "bark"))
	scene.free()
	_meshes[species] = out
	return out

## A species as seen from a few hundred metres: its trunk a six-sided post,
## its crown a lumpy low ball the colour of its leaves, a few dozen
## triangles instead of thousands. Shaped from the near mesh's own bounds.
static var _far := {}

static func far_mesh(species: String) -> ArrayMesh:
	if _far.has(species):
		return _far[species]
	var near := mesh(species)
	var crown := AABB()
	var trunk := AABB()
	var have_c := false
	var have_t := false
	for s in near.get_surface_count():
		var leafy := near.surface_get_material(s) is ShaderMaterial
		var vs: PackedVector3Array = near.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
		for v in vs:
			if leafy:
				crown = crown.expand(v) if have_c else AABB(v, Vector3.ZERO)
				have_c = true
			else:
				trunk = trunk.expand(v) if have_t else AABB(v, Vector3.ZERO)
				have_t = true
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(species)
	var leaf := Color(0.3, 0.48, 0.22) if species != "palm" else Color(0.38, 0.52, 0.22)
	# The crown: four or five lumpy clumps (each an icosahedron subdivided
	# once), bunched round the top of the trunk, lit from above and dark
	# underneath, so from a few hundred metres it reads as foliage, not a
	# ball on a stick.
	if have_c:
		var c0 := crown.get_center()
		var half := crown.size * 0.5
		var clumps := [[Vector3(0, 0.15, 0), 0.62]]
		for k in 4:
			var a := TAU * k / 4.0 + rng.randf_range(-0.4, 0.4)
			clumps.append([Vector3(cos(a) * 0.5, rng.randf_range(-0.45, 0.15), sin(a) * 0.5), rng.randf_range(0.45, 0.6)])
		for cl in clumps:
			var off: Vector3 = cl[0]
			var c := c0 + off * half
			var r := half * float(cl[1]) * Vector3(1.0, 1.05, 1.0)
			var t := (1.0 + sqrt(5.0)) / 2.0
			var ico := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
				Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
			var faces := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
				[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
			var bump := {}
			var shade := rng.randf_range(0.85, 1.12)
			var pt := func(d: Vector3) -> Vector3:
				var n := d.normalized()
				var key := "%.3f,%.3f,%.3f" % [n.x, n.y, n.z]
				if not bump.has(key):
					bump[key] = rng.randf_range(0.78, 1.12)
				return c + n * r * float(bump[key])
			for f in faces:
				var a: Vector3 = ico[f[0]]
				var b: Vector3 = ico[f[1]]
				var d: Vector3 = ico[f[2]]
				var ab := (a + b) * 0.5
				var bd := (b + d) * 0.5
				var da := (d + a) * 0.5
				for tri in [[a, ab, da], [ab, b, bd], [da, bd, d], [ab, bd, da]]:
					var p0: Vector3 = pt.call(tri[0])
					var p1: Vector3 = pt.call(tri[1])
					var p2: Vector3 = pt.call(tri[2])
					var n := (p1 - p0).cross(p2 - p0).normalized()
					if n.dot((p0 + p1 + p2) / 3.0 - c) < 0.0:
						var sw := p1
						p1 = p2
						p2 = sw
						n = -n
					for v in [p0, p1, p2]:
						var up := clampf(((v as Vector3) - c).normalized().y * 0.5 + 0.5, 0.0, 1.0)
						st.set_color(leaf * shade * lerpf(0.45, 1.2, up))
						st.set_normal(((v as Vector3) - c).normalized().lerp(n, 0.35).normalized())
						st.add_vertex(v)
	# The trunk: a six-sided post from the ground into the crown.
	if have_t:
		var base := Vector3(trunk.get_center().x, trunk.position.y, trunk.get_center().z)
		var top_y := crown.get_center().y if have_c else trunk.end.y
		var rad := clampf(minf(trunk.size.x, trunk.size.z) * 0.07, 0.12, 0.9)
		var bark := Color(0.32, 0.24, 0.17)
		for i in 6:
			var a0 := TAU * i / 6.0
			var a1 := TAU * (i + 1) / 6.0
			var d0 := Vector3(cos(a0), 0, sin(a0))
			var d1 := Vector3(cos(a1), 0, sin(a1))
			var q := [base + d0 * rad, base + d1 * rad, base + d1 * rad * 0.6 + Vector3(0, top_y - base.y, 0), base + d0 * rad * 0.6 + Vector3(0, top_y - base.y, 0)]
			for idx in [0, 2, 1, 0, 3, 2]:
				st.set_color(bark)
				st.set_normal(((d0 + d1) * 0.5).normalized())
				st.add_vertex(q[idx])
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.95
	st.set_material(m)
	var out := st.commit()
	_far[species] = out
	return out

static func _to_root(n: Node3D, root: Node3D) -> Transform3D:
	var xf := Transform3D()
	var at: Node = n
	while at and at != root:
		xf = (at as Node3D).transform * xf
		at = at.get_parent()
	return xf

static func material(name: String) -> Material:
	if _mats.has(name):
		return _mats[name]
	var m: Material
	if CARDS.has(name):
		var sm := ShaderMaterial.new()
		sm.shader = load("res://shaders/foliage_card.gdshader")
		sm.set_shader_parameter("card", load("res://art/foliage/%s.png" % CARDS[name]))
		sm.set_shader_parameter("sway", 0.35 if name == "leaf_vine" else 1.0)
		m = sm
	else:
		var b := StandardMaterial3D.new()
		b.albedo_texture = Surfaces._tex("Bark012", "Color")
		b.normal_enabled = true
		b.normal_texture = Surfaces._tex("Bark012", "NormalGL")
		b.roughness = 0.95
		b.albedo_color = Color(0.85, 0.78, 0.7)
		b.uv1_scale = Vector3(1.0, 1.0, 1.0)
		m = b
	_mats[name] = m
	return m

## A batch of plants in one draw: transforms and per-plant tints, visible
## between `near` and `far` metres from the camera (0 for no limit).
static func batch(parent: Node3D, species: String, xforms: Array, tints: Array, near := 0.0, far := 0.0, shadows := false) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh(species)
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		mm.set_instance_color(i, tints[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.visibility_range_begin = near
	mmi.visibility_range_end = far
	parent.add_child(mmi)
	return mmi
