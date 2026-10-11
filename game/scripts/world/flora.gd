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
