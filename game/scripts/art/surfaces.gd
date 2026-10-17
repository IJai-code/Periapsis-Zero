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
		if (skip != "" and mi.name.begins_with(skip)) or mi.has_meta("plume"):
			continue
		mi.create_trimesh_collision()
		for cs: CollisionShape3D in mi.find_children("*", "CollisionShape3D", true, false):
			var shape := cs.shape as ConcavePolygonShape3D
			if shape:
				shape.backface_collision = true

## Take a set's own (closed, merged) door mesh out, collision and all, so
## an AutoDoor can stand in its place.
static func remove_named(root: Node, name: String) -> void:
	for n in root.find_children(name, "MeshInstance3D", true, false):
		n.get_parent().remove_child(n)
		n.queue_free()

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
		"paint_bone": return _pbr("PaintedMetal004", 1.6, Color(0.7, 0.68, 0.64), true)
		"paint_dark": return _pbr("MetalPlates013", 1.4, Color(0.42, 0.43, 0.47), true)
		"paint_grey": return _pbr("PaintedMetal004", 1.6, Color(0.44, 0.45, 0.48), true)
		"seam": return _pbr("Metal027", 2.0, Color(0.16, 0.16, 0.17))
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
		"nav_white": return _strobe(Color(1.0, 1.0, 1.0), 8.0)
		"light": return _glow(Color(1.0, 0.9, 0.78), 2.5)
		"wall_clean": return _plain(Color(0.78, 0.81, 0.84), 0.6)
		"shopglass": return _shopglass()
		"solar": return _solar()
		"sign_glow": return _glow(Color(1.0, 0.62, 0.35), 2.2)
		"plant": return _plain(Color(0.16, 0.32, 0.17), 0.8)
		"light_soft": return _glow(Color(0.92, 0.96, 1.0), 0.7)
		"floor_clean": return _floor_clean()
		"linen": return _pbr("Plastic013A", 2.5, Color(0.93, 0.93, 0.95), true)
		"blanket": return _pbr("Rubber004", 1.5, Color(0.32, 0.42, 0.5), true)
		"curtain": return _cloth(Color(0.55, 0.68, 0.7))
		"light_floor": return _glow(ION, 4.0)
		"grate": return _grate()
		"hazard": return _hazard()
		# Lowdeck (art/godot/lowdeck.py).
		"asphalt": return _wet("Asphalt025C", 0.35, Color(0.62, 0.62, 0.68), 0.7, 0.5)
		"sidewalk": return _wet("Tiles074", 1.4, Color(0.42, 0.42, 0.46), 0.55, 0.62)
		"concrete": return _pbr("Concrete034", 0.4, Color(0.5, 0.49, 0.52), true)
		"facade": return _building()
		"brick": return _pbr("Bricks076C", 0.5, Color(0.42, 0.34, 0.31))
		"shop_back": return _shop_light()
		"shop_wall": return _plain(Color(0.72, 0.7, 0.66), 0.6)
		"floor_shop": return _pbr("Tiles074", 1.0, Color(0.62, 0.62, 0.64))
		"counter": return _plain(Color(0.2, 0.18, 0.17), 0.35)
		"shelf": return _plain(Color(0.55, 0.55, 0.58), 0.5)
		"shutter": return _pbr("CorrugatedSteel005", 0.5, Color(0.42, 0.42, 0.45), true)
		"signband": return _plain(Color(0.05, 0.05, 0.06), 0.7)
		"awning_ember": return _cloth(EMBER.darkened(0.35))
		"awning_ion": return _cloth(ION.darkened(0.55))
		"awning_bone": return _cloth(BONE.darkened(0.45))
		"awning_dark": return _cloth(Color(0.12, 0.12, 0.14))
		"marking": return _plain(Color(0.62, 0.6, 0.52), 0.55)
		"metal_dark": return _pbr("Metal027", 1.5, Color(0.2, 0.2, 0.22))
		"lamp": return _glow(Color(0.85, 0.92, 1.0), 5.0)
		"vending": return _glow(Color(0.55, 0.85, 1.0), 2.2)
		"cable": return _plain(Color(0.025, 0.025, 0.03), 0.6)
		"rubber": return _pbr("Rubber004", 1.0, Color(0.1, 0.1, 0.11))
		"vent": return _plain(Color(0.18, 0.18, 0.2), 0.7)
		"ringfloor": return _pbr("Asphalt025C", 0.05, Color(0.3, 0.3, 0.34))
		"streetglow": return _glow(Color(1.0, 0.6, 0.3), 3.0)
		"bulkhead": return _two_sided(_pbr_std(Color(0.16, 0.16, 0.19), 0.6, 0.6))
		"ringwindows": return _two_sided(_glow(Color(0.7, 0.85, 1.0), 1.6))
		"axis_light": return _glow(Color(0.55, 0.62, 0.95), 1.6)
		"neon_ember": return _glow(EMBER, 6.0)
		# Hearth village, in the Reach (art/godot/hearth_village.py).
		"wood_siding": return _obj(_pbr("WoodSiding008", 0.5, Color(0.86, 0.72, 0.58)))
		"roof_tiles": return _obj(_pbr("RoofingTiles006", 0.45, Color(0.85, 0.62, 0.55)))
		"planks": return _obj(_pbr("Planks037A", 0.6, Color(0.95, 0.85, 0.72)))
		"beam": return _obj(_pbr("Wood067", 0.8, Color(0.62, 0.5, 0.4)))
		"stone": return _obj(_pbr("Rock030", 0.5, Color(0.78, 0.76, 0.72)))
		"bark": return _obj(_pbr("Bark012", 0.8, Color(0.7, 0.6, 0.5)))
		"lantern": return _glow(Color(1.0, 0.72, 0.38), 4.0)
		# The valley's cliffs (art/godot/hearth_valley.py): blue-grey strata
		# and warmer bands.
		"cliff": return _obj(_pbr("Rock030", 0.22, Color(0.62, 0.66, 0.72)))
		"path_dirt": return _path_dirt()
		"dome_glass": return _dome_glass()
		"bobber": return _plain(Color(0.86, 0.12, 0.08), 0.35)
		"rope": return _obj(_pbr("Bark012", 2.4, Color(0.86, 0.74, 0.52)))
		"cork": return _plain(Color(0.66, 0.5, 0.34), 0.9)
		"cane": return _plain(Color(0.78, 0.62, 0.36), 0.5)
		"fish": return _plain(Color(0.62, 0.68, 0.72), 0.25)
		"canvas": return _cloth(Color(0.5, 0.38, 0.22))
		"boat_paint": return _obj(_pbr("Planks037A", 0.7, Color(0.62, 0.42, 0.3)))
		"cliff_warm": return _obj(_pbr("Rock030", 0.22, Color(0.82, 0.72, 0.6)))
		# The Choir's stonework, their glowing writing, a core (art/godot/reach_sites.py).
		"choir_stone": return _obj(_pbr("Rock030", 0.35, Color(0.92, 0.86, 0.78)))
		"choir_glyph": return _glow(Color(0.5, 0.78, 1.0), 1.4)
		"core_glow": return _glow(Color(0.7, 0.9, 1.0), 9.0)
		"neon_ion": return _glow(ION, 6.0)
	return null

## The observatory's dome: tinted glass, seen from inside and out.
static func _dome_glass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.55, 0.78, 0.9, 0.32)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 0.08
	m.metallic_specular = 0.9
	m.rim_enabled = true
	m.rim = 0.6
	m.rim_tint = 0.3
	return m

## A worn dirt path: brown, soft-edged so it fades into the grass.
static func _path_dirt() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled;
uniform sampler2D ground : source_color, filter_linear_mipmap, repeat_enable;
varying vec3 wpos;
void vertex() { wpos = VERTEX; }
void fragment() {
	vec3 g = texture(ground, wpos.xz * 0.18 + wpos.y * 0.05).rgb;
	vec3 dirt = mix(vec3(0.42, 0.33, 0.24), vec3(0.55, 0.45, 0.32), g.r);
	ALBEDO = dirt * (0.85 + 0.3 * g.g);
	ROUGHNESS = 0.95;
	float edge = smoothstep(0.0, 0.22, UV.x) * smoothstep(1.0, 0.78, UV.x);
	ALPHA = edge;
}"""
	m.shader = sh
	m.set_shader_parameter("ground", _tex("Ground037", "Color"))
	return m

## Mapped in the object's own space (for things on a small world).
static func _obj(m: ShaderMaterial) -> ShaderMaterial:
	m.set_shader_parameter("object_space", 1.0)
	return m

## The street at night, wet: puddles reflect the neon above (shaders/
## wet_street.gdshader).
static func _wet(id: String, scale: float, tint: Color, wet: float, puddles: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/wet_street.gdshader")
	m.set_shader_parameter("albedo_map", _tex(id, "Color"))
	m.set_shader_parameter("normal_map", _tex(id, "NormalGL"))
	m.set_shader_parameter("scale", scale)
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("wet", wet)
	m.set_shader_parameter("puddles", puddles)
	return m

## Towers: storeys of windows, some lit (shaders/building.gdshader).
static func _building() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/building.gdshader")
	m.set_shader_parameter("grime", _tex("Concrete034", "Color"))
	return m

## A shop's back wall, lit: warm, white, pink or cyan by where it is.
static func _shop_light() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode unshaded;
// A shop's back wall seen through the glass: shelves of goods in rows,
// bright strip lights over them, the wall's colour by shop.
varying vec3 w;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void vertex() { w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float h = hash(vec2(floor(w.z / 11.0), sign(w.x)));
	vec3 wall = h < 0.4 ? vec3(1.0, 0.8, 0.6) : (h < 0.65 ? vec3(0.92, 0.94, 1.0) : (h < 0.85 ? vec3(1.0, 0.5, 0.72) : vec3(0.4, 0.9, 1.0)));
	float row = floor(w.y / 0.62);
	float fy = fract(w.y / 0.62);
	// Goods: boxes and bottles of every colour, packed along each shelf.
	vec2 cell = vec2(floor(w.z * 3.2), row);
	float g = hash(cell + h * 17.0);
	float tall = 0.35 + 0.45 * hash(cell + 3.1);
	float good = step(fy, tall) * step(0.06, fract(w.z * 3.2)) * step(fract(w.z * 3.2), 0.92) * step(0.5, w.y) * step(w.y, 3.1);
	vec3 goods = mix(vec3(0.95, 0.3, 0.2), vec3(0.2, 0.6, 1.0), g);
	goods = mix(goods, vec3(1.0, 0.85, 0.3), step(0.7, hash(cell + 9.7)));
	float shelf = step(0.94, fy) * step(0.5, w.y);
	float strip = smoothstep(3.0, 3.35, w.y);
	vec3 c = wall * (0.55 + 0.25 * fy);
	c = mix(c, goods * 0.9, good * 0.85);
	c = mix(c, vec3(0.12), shelf);
	c += vec3(1.6) * strip;
	ALBEDO = c * 1.2;
}"""
	m.shader = sh
	return m

static func _two_sided(m: BaseMaterial3D) -> BaseMaterial3D:
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

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

## Solar cells: deep blue, glossy, a fine grid.
static func _solar() -> StandardMaterial3D:
	var m := _pbr_std(Color(0.06, 0.1, 0.22), 0.25, 0.6)
	return m

static func _pbr_std(c: Color, rough: float, metal: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	return m

## Shop windows: a dark tint, a strong reflection, a warm interior glow.
static func _shopglass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.1, 0.12, 0.14, 0.55)
	m.roughness = 0.05
	m.metallic = 0.5
	m.emission_enabled = true
	m.emission = Color(1.0, 0.75, 0.5)
	m.emission_energy_multiplier = 0.25
	return m

## Hanging cloth: matte, a little light through it, both sides drawn.
static func _cloth(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.95
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.backlight_enabled = true
	m.backlight = Color(c, 1.0) * 0.4
	return m

## Station flooring: the plate scan as paint, not bare metal, so it reads
## light in a renderer without reflections.
static func _floor_clean() -> ShaderMaterial:
	var m := _pbr("MetalPlates013", 0.7, Color(0.62, 0.64, 0.66), true)
	m.set_shader_parameter("metal", 0.15)
	return m

## A clean painted surface: no scan, one colour, one sheen.
static func _plain(c: Color, roughness: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = roughness
	return m

## A flashing running light (shaders/strobe.gdshader).
static func _strobe(c: Color, energy: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/strobe.gdshader")
	m.set_shader_parameter("color", c)
	m.set_shader_parameter("energy", energy)
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
