class_name Crystals
## Crystal clusters for the worlds that have them (art/godot/crystals.py):
## quartz-like prisms grown from a scanned boulder (Poly Haven), each world
## its own colour (the Phantom's violet, Ashfall's smoky amber), lit from
## inside by shaders/reach/crystal.gdshader. One mesh a variant, for the
## planets' multimeshes.

const LOOK := {
	"phantom": [Color(0.62, 0.42, 1.0), 0.7, Color(0.55, 0.5, 0.65)],
	"ashfall": [Color(1.0, 0.55, 0.22), 0.6, Color(0.42, 0.36, 0.33)],
}

static var _meshes := {}

## Variant "a", "b" or "c" for a world.
static func mesh(variant: String, world: String) -> ArrayMesh:
	var key := "%s/%s" % [variant, world]
	if _meshes.has(key):
		return _meshes[key]
	var look: Array = LOOK.get(world, LOOK["phantom"])
	var out := ArrayMesh.new()
	# The boulder they grow from, half sunk, in the world's rock colour.
	var rock := KenneyKit.mesh("ph/ph-namaqualand_boulder_03", look[2])
	var rock_xf := Transform3D(Basis.from_scale(Vector3(0.6, 0.55, 0.6)), Vector3(0, -0.2, 0))
	_add(out, rock, rock_xf, null)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/reach/crystal.gdshader")
	mat.set_shader_parameter("tint", look[0])
	mat.set_shader_parameter("glow", look[1])
	var scene: Node3D = load("res://art/crystals-%s.glb" % variant).instantiate()
	for mi: MeshInstance3D in scene.find_children("*", "MeshInstance3D", true, false):
		_add(out, mi.mesh, mi.transform, mat)
	scene.free()
	_meshes[key] = out
	return out

static func _add(out: ArrayMesh, src: Mesh, xf: Transform3D, mat: Material) -> void:
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var vs: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var ns: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		for i in vs.size():
			vs[i] = xf * vs[i]
			if ns.size() > i:
				ns[i] = (xf.basis * ns[i]).normalized()
		arrays[Mesh.ARRAY_VERTEX] = vs
		arrays[Mesh.ARRAY_NORMAL] = ns
		arrays[Mesh.ARRAY_TANGENT] = null
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		out.surface_set_material(out.get_surface_count() - 1, mat if mat else src.surface_get_material(s))

static func clear_cache() -> void:
	_meshes.clear()
