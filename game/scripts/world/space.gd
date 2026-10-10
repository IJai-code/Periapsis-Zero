class_name Space
## Lighting for open space: the star sky, the Sun and a little earthshine,
## at the quality the renderer can give.

static func environment(parent: Node, sun_dir: Vector3, exposure := 1.0) -> DirectionalLight3D:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.32, 0.42, 0.6)
	env.ambient_light_energy = 0.12 if Flow.high_quality() else 0.25
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	# The Compatibility renderer tonemaps hotter; it gets less exposure.
	env.tonemap_exposure = exposure if Flow.high_quality() else exposure * 0.72
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.2
	if Flow.high_quality():
		env.ssao_enabled = true
		env.ssao_radius = 2.0
		env.ssil_enabled = true
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)
	var key := DirectionalLight3D.new()
	key.light_energy = 2.6
	key.light_color = Color(1.0, 0.96, 0.9)
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 400.0
	parent.add_child(key)
	key.basis = Basis.looking_at(-sun_dir.normalized(), Vector3.UP if absf(sun_dir.normalized().y) < 0.99 else Vector3.FORWARD)
	var bounce := DirectionalLight3D.new()
	bounce.light_energy = 0.25
	bounce.light_color = Color(0.45, 0.62, 1.0)
	bounce.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	parent.add_child(bounce)
	bounce.basis = Basis.looking_at(Vector3.UP, Vector3.FORWARD)
	return key
