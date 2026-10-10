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

## Make every mesh under `root` solid, from both sides: a room seen from
## inside must stop the player whichever way its faces point.
static func collide(root: Node, skip := "") -> void:
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		if skip != "" and mi.name.begins_with(skip):
			continue
		mi.create_trimesh_collision()
		for cs: CollisionShape3D in mi.find_children("*", "CollisionShape3D", true, false):
			var shape := cs.shape as ConcavePolygonShape3D
			if shape:
				shape.backface_collision = true

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
		# Ships (art/godot/ships.py).
		"paint_bone": return _pbr("PaintedMetal004", 1.6, Color(0.84, 0.82, 0.78), true)
		"paint_dark": return _pbr("MetalPlates013", 1.4, Color(0.42, 0.43, 0.47), true)
		"paint_grey": return _pbr("PaintedMetal004", 1.6, Color(0.44, 0.45, 0.48), true)
		"seam": return _pbr("Metal027", 2.0, Color(0.08, 0.08, 0.09))
		"paint_ember": return _pbr("PaintedMetal004", 1.6, EMBER.darkened(0.08), true)
		"paint_hollow": return _pbr("MetalPlates013", 0.5, Color(0.36, 0.34, 0.3), true)
		"rust": return _pbr("DiamondPlate008C", 0.6, Color(0.55, 0.45, 0.38))
		"metal": return _pbr("Metal027", 1.2, Color(0.8, 0.8, 0.82))
		"engine": return _pbr("Metal027", 1.0, Color(0.32, 0.28, 0.27))
		"radiator": return _pbr("MetalPlates013", 0.35, Color(0.72, 0.72, 0.74), true)
		"container_bone": return _pbr("CorrugatedSteel005", 0.22, Color(0.78, 0.74, 0.66), true)
		"container_ember": return _pbr("CorrugatedSteel005", 0.22, Color(0.72, 0.36, 0.18), true)
		"container_ion": return _pbr("CorrugatedSteel005", 0.22, Color(0.2, 0.42, 0.52), true)
		"container_grey": return _pbr("CorrugatedSteel005", 0.22, Color(0.46, 0.47, 0.5), true)
		"container_dark": return _pbr("CorrugatedSteel005", 0.22, Color(0.2, 0.2, 0.23), true)
		"glass": return _glass()
		"canopy": return _canopy()
		"screen": return _screen(false)
		"screen_round": return _screen(true)
		"glow_engine": return _glow(Color(0.55, 0.85, 1.0), 6.0)
		"glow_reactor": return _glow(Color(1.0, 0.45, 0.15), 5.0)
		"glow_hollow": return _glow(Color(1.0, 0.3, 0.1), 6.0)
		"window_glow": return _glow(Color(1.0, 0.85, 0.6), 3.0)
		"nav_red": return _glow(Color(1.0, 0.1, 0.05), 8.0)
		"nav_green": return _glow(Color(0.1, 1.0, 0.3), 8.0)
		"nav_white": return _glow(Color(1.0, 1.0, 1.0), 8.0)
		"light": return _glow(Color(1.0, 0.9, 0.78), 2.5)
		"wall_clean": return _plain(Color(0.78, 0.81, 0.84), 0.6)
		"light_soft": return _glow(Color(0.92, 0.96, 1.0), 0.7)
		"floor_clean": return _pbr("MetalPlates013", 0.7, Color(0.72, 0.74, 0.76), true)
		"linen": return _pbr("Plastic013A", 2.5, Color(0.93, 0.93, 0.95), true)
		"blanket": return _pbr("Rubber004", 1.5, Color(0.32, 0.42, 0.5), true)
		"light_floor": return _glow(ION, 4.0)
		"grate": return _grate()
		"hazard": return _hazard()
	return null

static func _tex(id: String, map: String) -> Texture2D:
	var p := "res://assets/materials/%s/%s_2K-JPG_%s.jpg" % [id, id, map]
	return load(p) if ResourceLoader.exists(p) else null

## `paint`: the scan's own colour is taken out (kept as light and dark: the
## wear, scratches and grime) so `tint` alone sets the colour. Any ambientCG
## material can then wear the palette. Colours above 1 brighten.
static func _pbr(id: String, scale: float, tint: Color, paint := false) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/surface.gdshader")
	var gain := maxf(1.0, maxf(tint.r, maxf(tint.g, tint.b)))
	m.set_shader_parameter("albedo_map", _tex(id, "Color"))
	m.set_shader_parameter("normal_map", _tex(id, "NormalGL"))
	m.set_shader_parameter("rough_map", _tex(id, "Roughness"))
	var metal := _tex(id, "Metalness")
	m.set_shader_parameter("metal_map", metal)
	m.set_shader_parameter("metal", 1.0 if metal else 0.0)
	m.set_shader_parameter("tint", Color(tint.r / gain, tint.g / gain, tint.b / gain))
	m.set_shader_parameter("tint_gain", gain)
	m.set_shader_parameter("paint", 1.0 if paint else 0.0)
	m.set_shader_parameter("scale", scale)
	return m

## A clean painted surface: no scan, one colour, one sheen.
static func _plain(c: Color, roughness: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = roughness
	return m

static func _glow(c: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = energy
	return m

## Window glass: clear, a faint tint and a sharp reflection.
static func _glass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.6, 0.72, 0.82, 0.07)
	m.roughness = 0.02
	m.metallic = 0.2
	m.metallic_specular = 1.0
	m.rim_enabled = true
	m.rim = 0.4
	m.cull_mode = BaseMaterial3D.CULL_BACK
	return m

## A console display, drawn by shaders/screen.gdshader.
static func _screen(round: bool) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/screen.gdshader")
	m.set_shader_parameter("round", 1.0 if round else 0.0)
	return m

## A ship's canopy from outside: dark, mirror-smooth, the sky in it.
static func _canopy() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.02, 0.035, 0.05)
	m.metallic = 0.9
	m.roughness = 0.06
	m.rim_enabled = true
	m.rim = 0.3
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
