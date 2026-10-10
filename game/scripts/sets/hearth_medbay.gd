class_name HearthMedbay
extends Node3D
## Hearth's medical bay (art/godot/hearth_medbay.py): cool clean light, the
## bed against the window wall, Earth small and whole outside. Hearth sits
## at the Earth-Moon L1 point; Earth is drawn larger than true there.

const SUN_DIR := Vector3(-0.7, 0.35, -0.6)

func _ready() -> void:
	var hq := Flow.high_quality()
	var room: Node3D = load("res://art/hearth_medbay.glb").instantiate()
	add_child(room)
	Surfaces.apply(room)
	Surfaces.collide(room)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.82, 0.9)
	env.ambient_light_energy = 0.2 if hq else 0.28
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.2
	env.glow_enabled = true
	env.glow_intensity = 0.4
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.sdfgi_min_cell_size = 0.1
		env.ssao_enabled = true
		env.ssil_enabled = true
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	for z in [-1.9, -4.7]:
		var s := SpotLight3D.new()
		s.position = Vector3(0, 2.9, z)
		s.rotation_degrees = Vector3(-90, 0, 0)
		s.spot_angle = 75.0
		s.spot_range = 5.0
		s.light_energy = 2.0
		s.light_color = Color(0.92, 0.96, 1.0)
		# In the browser these shadows ring the plain walls with acne.
		s.shadow_enabled = hq
		add_child(s)
	var monitor := OmniLight3D.new()
	monitor.position = Vector3(-1.4, 1.7, -5.2)
	monitor.omni_range = 1.6
	monitor.light_energy = 0.6
	monitor.light_color = Surfaces.ION
	add_child(monitor)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	add_child(Earth.toward(Vector3(0.12, -0.05, -1.0), 40_000_000.0, SUN_DIR, 0.0014))
