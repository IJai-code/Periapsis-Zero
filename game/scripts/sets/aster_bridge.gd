class_name AsterBridge
extends Node3D
## The Aster's bridge, built by art/godot/aster_bridge.py: consoles alive with
## displays, light strips, Earth and the convoy through the forward window.
## Walkable. Runs along -Z from the aft door (z = 0) to the window (z = -9);
## the hatch to the flight deck is on the starboard wall at z = -3.7.

const SUN_DIR := Vector3(0.55, 0.5, -0.67)
const H := 3.5
const D := 9.0

func _ready() -> void:
	var hq := Flow.high_quality()
	var room: Node3D = load("res://art/aster_bridge.glb").instantiate()
	add_child(room)
	Surfaces.apply(room)
	for mi: MeshInstance3D in room.find_children("*", "MeshInstance3D", true, false):
		if mi.name.begins_with("window_glass"):
			# A transparent pane in front of Earth's own transparent layers
			# sorts badly; the window is drawn open, and still blocks.
			mi.visible = false
	Surfaces.collide(room)
	_environment(hq)
	_lights(hq)
	# Outside: Earth ahead and below, and a convoy ship riding off the bow.
	add_child(Earth.toward(Vector3(0.15, -0.35, -1.0), 4_000_000.0, SUN_DIR))
	var other := Hull.model("freighter3")
	add_child(other)
	other.position = Vector3(-60.0, -12.0, -260.0)
	other.rotation_degrees = Vector3(0.0, 4.0, 0.0)

func _environment(hq: bool) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.7)
	env.ambient_light_energy = 0.15 if hq else 0.4
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.3
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_hdr_threshold = 1.0
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.sdfgi_min_cell_size = 0.12
		env.ssao_enabled = true
		env.ssao_intensity = 2.0
		env.ssil_enabled = true
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = 0.0
		env.volumetric_fog_anisotropy = 0.5
		var fv := FogVolume.new()
		fv.size = Vector3(9.0, H - 0.4, D - 1.0)
		fv.position = Vector3(0.0, H / 2.0, -D / 2.0)
		var fm := FogMaterial.new()
		fm.density = 0.018
		fm.edge_fade = 0.3
		fv.material = fm
		add_child(fv)
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

func _lights(hq: bool) -> void:
	var sun := DirectionalLight3D.new()
	sun.light_energy = 3.5
	sun.shadow_enabled = true
	sun.shadow_bias = 0.01
	sun.directional_shadow_max_distance = 40.0
	sun.light_volumetric_fog_energy = 2.0
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	for z in [-1.9, -3.7, -5.5, -7.1]:
		for x in [-1.6, 1.6]:
			var s := SpotLight3D.new()
			s.position = Vector3(x, H - 0.15, z)
			s.rotation_degrees = Vector3(-90, 0, 0)
			s.spot_angle = 60.0
			s.spot_range = 5.0
			s.light_energy = 1.6
			s.light_color = Color(1.0, 0.9, 0.78)
			s.shadow_enabled = hq and x < 0.0
			add_child(s)
	# Console glow on the faces of whoever stands at them.
	for z in [-5.0, -6.9]:
		for x in [-3.9, -2.2, 2.2, 3.9]:
			var o := OmniLight3D.new()
			o.position = Vector3(x, 1.4, z + 0.1)
			o.omni_range = 1.8
			o.light_energy = 0.5
			o.light_color = Surfaces.ION
			add_child(o)
	var plot := OmniLight3D.new()
	plot.position = Vector3(0, 1.2, -3.9)
	plot.omni_range = 2.5
	plot.light_energy = 0.8
	plot.light_color = Surfaces.ION
	add_child(plot)
