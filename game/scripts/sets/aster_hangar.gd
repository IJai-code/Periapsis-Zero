class_name AsterHangar
extends Node3D
## The Aster's flight deck (art/godot/aster_hangar.py): a tall ribbed bay,
## the Kestrel on her cradle mid-floor, outer doors open on space and Earth
## at the far end. Runs along -Z from the bridge door (z = 0) to the opening
## (z = -34). `kestrel` is the parked ship, for the launch.

const SUN_DIR := Vector3(0.4, 0.55, -0.73)
var kestrel: Node3D

func _ready() -> void:
	var hq := Flow.high_quality()
	var bay: Node3D = load("res://art/aster_hangar.glb").instantiate()
	add_child(bay)
	Surfaces.apply(bay)
	Surfaces.collide(bay)
	kestrel = Hull.model("kestrel")
	add_child(kestrel)
	kestrel.position = Vector3(0.0, 1.95, -14.0)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.6, 0.7)
	env.ambient_light_energy = 0.18 if hq else 0.6
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.25
	env.glow_enabled = true
	env.glow_intensity = 0.55
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.ssao_enabled = true
		env.ssil_enabled = true
		env.ssr_enabled = true
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = 0.0
		var fv := FogVolume.new()
		fv.size = Vector3(17.0, 9.5, 33.0)
		fv.position = Vector3(0.0, 4.8, -16.5)
		var fm := FogMaterial.new()
		fm.density = 0.02
		fm.edge_fade = 0.2
		fv.material = fm
		add_child(fv)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 4.0
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80.0
	sun.light_volumetric_fog_energy = 2.5
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	for z in [-6.0, -14.0, -22.0, -30.0]:
		var s := SpotLight3D.new()
		s.position = Vector3(0.0, 9.6, z)
		s.rotation_degrees = Vector3(-90, 0, 0)
		s.spot_angle = 55.0
		s.spot_range = 13.0
		s.light_energy = 6.0 if hq else 9.0
		s.light_color = Color(1.0, 0.9, 0.78)
		s.shadow_enabled = hq or z == -14.0
		add_child(s)
	add_child(Earth.toward(Vector3(0.0, -0.55, -1.0), 2_500_000.0, SUN_DIR, 0.003))
