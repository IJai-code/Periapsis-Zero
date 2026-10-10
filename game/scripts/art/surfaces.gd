class_name Surfaces
## Every surface in Periapsis Zero's own models is named for a material (the
## Blender scripts in art/godot/). Here those names become real materials:
## ambientCG's CC0 photo-scanned maps, drawn triplanar in world space, so
## nothing needs UVs and the texel density is the same on every wall.
##
## Colours keep to the game's palette: void, bone, ember, ion.

const BONE := Color("#f4e8cf")
const EMBER := Color("#ff6b2c")
const ION := Color("#2fd3ff")

static var _cache := {}

static func apply(root: Node) -> void:
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i)
			if src == null:
				continue
			var m := get_material(src.resource_name)
			if m:
				mi.set_surface_override_material(i, m)
		# Single-sided shells still have to stop the Sun from outside; glass must not.
		var glass := mi.mesh.get_surface_count() > 0 and mi.mesh.surface_get_material(0) and mi.mesh.surface_get_material(0).resource_name == "glass"
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if glass else GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED

static func get_material(name: String) -> Material:
	if _cache.has(name):
		return _cache[name]
	var m: Material = _make(name)
	_cache[name] = m
	return m

static func _make(name: String) -> Material:
	match name:
		"hull": return _pbr("MetalPlates006", 0.5, Color(0.55, 0.56, 0.58), true)
		"wall": return _pbr("MetalPlates013", 0.9, Color(1.5, 1.48, 1.42), true)
		"frame": return _pbr("PaintedMetal004", 0.7, BONE.darkened(0.12), true)
		"panel": return _pbr("Plastic013A", 0.8, BONE.darkened(0.05), true)
		"door": return _pbr("PaintedMetal004", 0.6, Color(0.36, 0.38, 0.42), true)
		"floor": return _pbr("DiamondPlate008C", 1.2, Color(0.8, 0.8, 0.8))
		"trim": return _pbr("Metal027", 1.5, Color(0.85, 0.85, 0.85))
		"pipe_steel": return _pbr("Metal027", 2.0, Color(0.7, 0.72, 0.75))
		"pipe_ember": return _pbr("PaintedMetal004", 2.0, EMBER, true)
		"pipe_ion": return _pbr("PaintedMetal004", 2.0, ION.darkened(0.2), true)
		"light": return _glow(Color(1.0, 0.9, 0.78), 2.5)
		"light_floor": return _glow(ION, 4.0)
		"glass": return _glass()
		"grate": return _grate()
		"hazard": return _hazard()
	return null

static func _tex(id: String, map: String) -> Texture2D:
	var p := "res://assets/materials/%s/%s_2K-JPG_%s.jpg" % [id, id, map]
	return load(p) if ResourceLoader.exists(p) else null

## `paint`: the scan's own colour is taken out (kept as light and dark: the
## wear, scratches and grime) so `tint` alone sets the colour. Any ambientCG
## material can then wear the palette.
static func _pbr(id: String, scale: float, tint: Color, paint := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = _grey(id) if paint else _tex(id, "Color")
	m.albedo_color = tint
	m.normal_enabled = true
	m.normal_texture = _tex(id, "NormalGL")
	m.roughness_texture = _tex(id, "Roughness")
	m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	var metal := _tex(id, "Metalness")
	if metal:
		m.metallic = 1.0
		m.metallic_texture = metal
		m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	var ao := _tex(id, "AmbientOcclusion")
	if ao:
		m.ao_enabled = true
		m.ao_texture = ao
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_triplanar_sharpness = 4.0
	m.uv1_scale = Vector3.ONE * scale
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

static func _grey(id: String) -> Texture2D:
	var key := "grey:" + id
	if _cache.has(key):
		return _cache[key]
	var img := _tex(id, "Color").get_image()
	if img.is_compressed():
		img.decompress()
	img.adjust_bcs(1.0, 1.0, 0.0)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_cache[key] = t
	return t

static func _glow(c: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = energy
	return m

static func _glass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.6, 0.75, 0.85, 0.08)
	m.roughness = 0.03
	m.metallic_specular = 0.9
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

static func _grate() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/grate.gdshader")
	var id := "MetalWalkway014"
	m.set_shader_parameter("color_map", _tex(id, "Color"))
	m.set_shader_parameter("normal_map", _tex(id, "NormalGL"))
	m.set_shader_parameter("rough_map", _tex(id, "Roughness"))
	m.set_shader_parameter("metal_map", _tex(id, "Metalness"))
	m.set_shader_parameter("opacity_map", _tex(id, "Opacity"))
	return m

static func _hazard() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/hazard.gdshader")
	var id := "PaintedMetal004"
	m.set_shader_parameter("rough_map", _tex(id, "Roughness"))
	m.set_shader_parameter("normal_map", _tex(id, "NormalGL"))
	return m
