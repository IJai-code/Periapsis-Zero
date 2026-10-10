class_name AsterCorridor
extends Node3D
## Deck 2 of the Aster, the crew corridor, built from art/godot/aster_corridor.py:
## ceiling lights in pools down its length, the Sun through the one port
## window into haze, Earth's limb outside it. Walkable: every surface collides.
##
## Runs along -Z from the aft bulkhead (z = 0) to the fore door (z = -16).

const SUN_DIR := Vector3(-0.8, 0.42, -0.42) # toward the Sun: in through the port window, across the deck
const EARTH_DIR := Vector3(-0.6, -0.8, 0.0) # the ship lies on her side to the planet
const BAY := 2.0
const BAYS := 8
const H := 2.9
const LENGTH := BAY * BAYS
const WINDOW_Z := -(5.5 * BAY)

func _ready() -> void:
	var hq := Flow.high_quality()
	var corridor: Node3D = load("res://art/aster_corridor.glb").instantiate()
	add_child(corridor)
	Surfaces.apply(corridor)
	for mi: MeshInstance3D in corridor.find_children("*", "MeshInstance3D", true, false):
		mi.create_trimesh_collision()
	_environment(hq)
	_lights(hq)
	_signs()
	if hq:
		_haze()
	else:
		_shaft()
	add_child(Earth.toward(EARTH_DIR, 420_000.0, SUN_DIR))

func _environment(hq: bool) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.55, 0.65)
	env.ambient_light_energy = 0.12 if hq else 0.35
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.45
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.03
	env.glow_hdr_threshold = 1.0
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.sdfgi_min_cell_size = 0.1
		env.sdfgi_energy = 1.2
		env.ssao_enabled = true
		env.ssao_radius = 0.8
		env.ssao_intensity = 2.5
		env.ssil_enabled = true
		env.ssr_enabled = true
		env.ssr_max_steps = 96
		# Haze only inside the hull (a FogVolume): fog outside, in full Sun,
		# would bleed through the walls at froxel resolution.
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = 0.0
		env.volumetric_fog_albedo = Color(0.9, 0.9, 0.95)
		env.volumetric_fog_anisotropy = 0.55
		env.volumetric_fog_length = 24.0
		env.volumetric_fog_sky_affect = 0.0
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.08
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

func _lights(hq: bool) -> void:
	var sun := DirectionalLight3D.new()
	sun.light_energy = 6.0
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.shadow_enabled = true
	sun.shadow_bias = 0.01
	sun.shadow_normal_bias = 0.4
	sun.directional_shadow_max_distance = 40.0
	sun.light_volumetric_fog_energy = 4.0
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	for k in BAYS:
		var z := -(k + 0.5) * BAY
		var s := SpotLight3D.new()
		s.position = Vector3(0.0, H - 0.12, z)
		s.rotation_degrees = Vector3(-90.0, 0.0, 0.0)
		s.spot_angle = 62.0
		s.spot_range = 4.5
		s.spot_attenuation = 0.8
		s.light_energy = 2.2
		s.light_color = Color(1.0, 0.86, 0.7)
		# The browser's renderer pays per shadowed light: every other one there.
		s.shadow_enabled = hq or k % 2 == 0
		s.light_volumetric_fog_energy = 0.6
		add_child(s)
		if k % 2 == 0:
			var o := OmniLight3D.new()
			o.position = Vector3(0.0, 0.12, z)
			o.omni_range = 1.6
			o.light_energy = 0.8
			o.light_color = Surfaces.ION
			add_child(o)

func _haze() -> void:
	var fv := FogVolume.new()
	fv.shape = RenderingServer.FOG_VOLUME_SHAPE_BOX
	fv.size = Vector3(2.2, H - 0.5, LENGTH - 0.2)
	fv.position = Vector3(0.0, H / 2.0, -LENGTH / 2.0)
	var fm := FogMaterial.new()
	fm.density = 0.06
	fm.albedo = Color(0.92, 0.92, 0.95)
	fm.edge_fade = 0.3
	fv.material = fm
	add_child(fv)

## Without volumetric fog, the window's beam is a soft additive prism.
func _shaft() -> void:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_color = Color(1.0, 0.95, 0.85, 0.07)
	m.no_depth_test = false
	var b := BoxMesh.new()
	b.size = Vector3(1.0, 1.3, 4.0)
	b.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = b
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# From the window, along the sunlight, into the deck.
	var into := -SUN_DIR.normalized()
	mi.basis = Basis.looking_at(into, Vector3.UP)
	mi.position = Vector3(-1.4, 1.55, WINDOW_Z) + into * 2.0

func _signs() -> void:
	_sign("DECK 2  ·  CREW", Vector3(1.32, 2.0, -3.0), -90.0, 0.0012)
	_sign("ASTER", Vector3(1.32, 1.82, -3.0), -90.0, 0.0016)
	_sign("FORWARD  ›  FLIGHT DECK", Vector3(0.0, 2.25, -15.85), 0.0, 0.0022)
	for k in range(1, BAYS):
		_sign("FR %02d" % (k + 10), Vector3(-1.23, 2.25, -k * BAY + 0.135), 0.0, 0.0012)

func _sign(text: String, at: Vector3, yaw: float, size: float) -> void:
	var l := Label3D.new()
	l.text = text
	l.font = Style.mono_bold
	l.pixel_size = size
	l.font_size = 96
	l.outline_size = 0
	l.modulate = Surfaces.BONE.darkened(0.15)
	l.shaded = true
	l.double_sided = false
	l.position = at
	l.rotation_degrees = Vector3(0.0, yaw, 0.0)
	add_child(l)
