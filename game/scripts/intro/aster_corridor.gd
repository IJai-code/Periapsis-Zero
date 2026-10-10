extends Node3D
## Deck 2 of the Aster, the crew corridor: where the game begins. Ceiling
## lights in pools down its length, the Sun coming through the one port-side
## window into a little haze, Earth below it.

const SUN_DIR := Vector3(-0.8, 0.42, -0.42) # toward the Sun: in through the port window, across the deck
const BAY := 2.0
const BAYS := 8
const H := 2.9

func _ready() -> void:
	var corridor: Node3D = load("res://art/aster_corridor.glb").instantiate()
	add_child(corridor)
	Surfaces.apply(corridor)
	_environment()
	_lights()
	_signs()
	_haze()
	add_child(Earth.below(420_000.0, SUN_DIR))
	var cam := Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.03
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(0.55, 1.85, -6.4)
	cam.look_at(Vector3(-0.9, 1.45, -12.5))

func _environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.55, 0.65)
	env.ambient_light_energy = 0.12
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.45
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
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.03
	env.glow_hdr_threshold = 1.0
	env.volumetric_fog_enabled = true
	# Haze only inside the hull (a FogVolume below): fog outside, in full Sun,
	# would bleed through the walls at froxel resolution.
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

func _lights() -> void:
	var sun := DirectionalLight3D.new()
	sun.light_energy = 6.0
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.shadow_enabled = true
	sun.shadow_bias = 0.03
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
		s.shadow_enabled = true
		s.light_volumetric_fog_energy = 0.6
		add_child(s)
		# The trench glows ion blue under the grating.
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
	fv.size = Vector3(2.2, H - 0.5, BAY * BAYS - 0.2)
	fv.position = Vector3(0.0, H / 2.0, -BAY * BAYS / 2.0)
	var fm := FogMaterial.new()
	fm.density = 0.06
	fm.albedo = Color(0.92, 0.92, 0.95)
	fm.edge_fade = 0.3
	fv.material = fm
	add_child(fv)

func _signs() -> void:
	_sign("DECK 2  ·  CREW", Vector3(1.32, 2.05, -3.0), -90.0, 0.0028)
	_sign("ASTER", Vector3(1.32, 1.82, -3.0), -90.0, 0.0018)
	_sign("FORWARD  ›  FLIGHT DECK", Vector3(0.0, 2.25, -15.85), 0.0, 0.0022)
	for k in range(1, BAYS):
		_sign("FR %02d" % (k + 10), Vector3(-1.23, 2.25, -k * BAY + 0.135), 0.0, 0.0012)

func _sign(text: String, at: Vector3, yaw: float, size: float) -> void:
	var l := Label3D.new()
	l.text = text
	l.pixel_size = size
	l.font_size = 96
	l.outline_size = 0
	l.modulate = Surfaces.BONE.darkened(0.15)
	l.shaded = true
	l.double_sided = false
	l.position = at
	l.rotation_degrees = Vector3(0.0, yaw, 0.0)
	add_child(l)
