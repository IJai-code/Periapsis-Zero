class_name KenneyKit
## Kenney's Nature Kit (CC0, kenney.nl; game/art/kenney): trees, pines,
## bushes, rocks, grass, flowers, logs. Each model is merged into one mesh
## (a surface per material) so thousands can be drawn as a multimesh. Their
## flat colours are kept; `tint` multiplies them (Ashfall's rocks go dark).

static var _meshes := {}

## The model's meshes as one, cached. Origin at its foot.
static func mesh(name: String, tint := Color(1, 1, 1)) -> ArrayMesh:
	var key := "%s/%s" % [name, tint.to_html()]
	if _meshes.has(key):
		return _meshes[key]
	# Poly Haven's scanned models (art/godot/polyhaven.py) come through here
	# too, as "ph/<id>": their own textured materials kept, tinted.
	var file := "res://art/%s.glb" % name if name.begins_with("ph/") else "res://art/kenney/%s.glb" % name
	# The pines are glTF beside their shared textures (art/godot/pines.py).
	if not ResourceLoader.exists(file) and ResourceLoader.exists(file.trim_suffix(".glb") + ".gltf"):
		file = file.trim_suffix(".glb") + ".gltf"
	var scene: Node3D = load(file).instantiate()
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
			arrays[Mesh.ARRAY_TANGENT] = null
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			out.surface_set_material(out.get_surface_count() - 1, _material(mi.mesh.surface_get_material(s), tint))
	scene.free()
	_meshes[key] = out
	return out

static var _mats := {}

const PALETTE := {
	"leafsDark": Color(0.17, 0.3, 0.17), "leafsGreen": Color(0.3, 0.46, 0.2), "leafsFall": Color(0.62, 0.38, 0.16),
	"woodBark": Color(0.4, 0.28, 0.19), "woodBarkDark": Color(0.3, 0.22, 0.16), "woodInner": Color(0.78, 0.6, 0.42),
	"grass": Color(0.34, 0.5, 0.21), "dirt": Color(0.44, 0.35, 0.27), "stone": Color(0.56, 0.54, 0.5),
	"_defaultMat": Color(0.5, 0.48, 0.45), "colorYellow": Color(0.95, 0.8, 0.3), "colorRed": Color(0.85, 0.32, 0.25),
	"colorPurple": Color(0.62, 0.45, 0.85),
}

## A material per Kenney material name, in the valley's palette.
static func _material(src: Material, tint: Color) -> Material:
	var base := Color(0.7, 0.7, 0.7)
	var name := "?"
	if src is BaseMaterial3D and (src as BaseMaterial3D).albedo_texture != null:
		var tk := "%d/%s" % [src.get_instance_id(), tint.to_html()]
		if not _mats.has(tk):
			var d := src.duplicate() as BaseMaterial3D
			d.albedo_color = d.albedo_color * tint
			# Cut-out cards (the pines' boughs): clipped, not blended, so
			# they sort and shadow as solids; lit through from behind.
			if d.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
				d.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				d.alpha_scissor_threshold = 0.4
				d.cull_mode = BaseMaterial3D.CULL_DISABLED
				d.backlight_enabled = true
				d.backlight = Color(0.16, 0.22, 0.1)
				d.roughness = 0.9
				d.metallic_specular = 0.2
			_mats[tk] = d
		return _mats[tk]
	if src is BaseMaterial3D:
		base = (src as BaseMaterial3D).albedo_color
		name = src.resource_name
	var key := "%s/%s" % [name, tint.to_html()]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	# Kenney's own palette is teal and orange (a toy look); their shapes
	# wear the valley's colours instead, by what the material is.
	if PALETTE.has(name):
		base = PALETTE[name]
	var c := base * tint
	m.albedo_color = Color(c.r, c.g, c.b, 1.0)
	m.roughness = 0.88
	# Leaves and grass are thin: lit from behind too.
	if name.begins_with("leafs") or name == "grass":
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.backlight_enabled = true
		m.backlight = Color(0.18, 0.24, 0.1)
	_mats[key] = m
	return m

## For the grass shader (Grass): one mesh, its colour baked into the
## vertices from its materials, darker at the root, and alpha = how high up
## the blade the vertex is (how far the wind moves it).
static func baked(name: String, scale: float) -> ArrayMesh:
	var key := "baked/%s/%.2f" % [name, scale]
	if _meshes.has(key):
		return _meshes[key]
	var src := mesh(name)
	var box := src.get_aabb()
	var h := maxf(box.size.y, 0.001)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var vs: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var ns: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var col := (src.surface_get_material(s) as StandardMaterial3D).albedo_color
		var order := idx if idx.size() > 0 else PackedInt32Array(range(vs.size()))
		for i in order:
			var k := clampf((vs[i].y - box.position.y) / h, 0.0, 1.0)
			var c := col * lerpf(0.45, 1.1, k)
			st.set_color(Color(c.r, c.g, c.b, k))
			st.set_normal(ns[i] if ns.size() > i else Vector3.UP)
			st.add_vertex(vs[i] * scale)
	var out := st.commit()
	_meshes[key] = out
	return out

static func _to_root(n: Node3D, root: Node3D) -> Transform3D:
	var xf := Transform3D()
	var at: Node = n
	while at and at != root:
		xf = (at as Node3D).transform * xf
		at = at.get_parent()
	return xf

static func clear() -> void:
	_meshes.clear()
	_mats.clear()
