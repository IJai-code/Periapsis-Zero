extends Node3D
## The first shot of the game: the Aster's convoy leaving Earth orbit, the
## Kestrel flying escort in the foreground. Built in code for now; it becomes
## the playable cold open (docs/godot-plan.md).

const EARTH_R := 6_371_000.0
const ALTITUDE := 420_000.0
# Earth is drawn at 1/200 scale and 1/200 the distance: it looks the same from
# the ship, and keeps the camera's depth range one the renderer can cull with.
const WORLD_SCALE := 0.005
const SUN_DIR := Vector3(-0.62, 0.1, -0.78) # toward the Sun

var _clouds: ShaderMaterial

func _ready() -> void:
	var sun := SUN_DIR.normalized()
	_environment()
	_lights(sun)
	_earth(sun)
	_convoy()
	var cam := Camera3D.new()
	cam.fov = 42.0
	cam.near = 0.05
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(-9.0, 4.0, 22.0)
	cam.look_at(Vector3(4.0, -9.0, -90.0))

func _process(dt: float) -> void:
	if _clouds:
		_clouds.set_shader_parameter("drift", Time.get_ticks_msec() * 0.0000002)

func _environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.32, 0.42, 0.6)
	env.ambient_light_energy = 0.12
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.2
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.ssao_enabled = true
	env.ssao_radius = 2.0
	env.ssil_enabled = true
	env.ssr_enabled = true
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.05
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

func _lights(sun: Vector3) -> void:
	var key := DirectionalLight3D.new()
	key.light_energy = 2.6
	key.light_color = Color(1.0, 0.96, 0.9)
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 600.0
	key.light_angular_distance = 0.53
	add_child(key)
	key.basis = Basis.looking_at(-sun, Vector3.UP)
	# Earthshine: blue light thrown back up from the planet below.
	var bounce := DirectionalLight3D.new()
	bounce.light_energy = 0.25
	bounce.light_color = Color(0.45, 0.62, 1.0)
	bounce.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	add_child(bounce)
	bounce.basis = Basis.looking_at(Vector3.UP, Vector3.FORWARD)

func _earth(sun: Vector3) -> void:
	var k := WORLD_SCALE
	var centre := Vector3(0.0, -(EARTH_R + ALTITUDE) * k, 0.0)
	var surface := _sphere(EARTH_R * k, 512)
	var em := ShaderMaterial.new()
	em.shader = load("res://shaders/earth.gdshader")
	em.set_shader_parameter("day_map", load("res://assets/textures/earth_day.jpg"))
	em.set_shader_parameter("night_map", load("res://assets/textures/earth_night.jpg"))
	em.set_shader_parameter("spec_map", load("res://assets/textures/earth_specular.jpg"))
	em.set_shader_parameter("normal_map", load("res://assets/textures/earth_normal.jpg"))
	em.set_shader_parameter("sun_dir", sun)
	surface.material_override = em
	surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var clouds := _sphere((EARTH_R + 9_000.0) * k, 512)
	_clouds = ShaderMaterial.new()
	_clouds.shader = load("res://shaders/clouds.gdshader")
	_clouds.set_shader_parameter("cloud_map", load("res://assets/textures/earth_clouds.png"))
	clouds.material_override = _clouds
	clouds.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var air := _sphere((EARTH_R + 90_000.0) * k, 256)
	var am := ShaderMaterial.new()
	am.shader = load("res://shaders/atmosphere.gdshader")
	am.set_shader_parameter("sun_dir", sun)
	air.material_override = am
	air.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for s in [surface, clouds, air]:
		s.position = centre
		# Turn the globe so the dayside under us is ocean and coast, not polar ice.
		s.rotation = Vector3(deg_to_rad(-28.0), deg_to_rad(110.0), 0.0)
		add_child(s)

func _sphere(r: float, segments: int) -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0
	m.radial_segments = segments
	m.rings = segments / 2
	var mi := MeshInstance3D.new()
	mi.mesh = m
	return mi

func _ship(kind: String, at: Vector3, yaw: float, roll := 0.0) -> Node3D:
	var n: Node3D = load("res://assets/models/game-%s.glb" % kind).instantiate()
	n.position = at
	n.rotation = Vector3(0.0, deg_to_rad(yaw), deg_to_rad(roll))
	add_child(n)
	_tame_glow(n)
	return n

func _convoy() -> void:
	_ship("freighter", Vector3(10.0, -14.0, -120.0), 8.0)
	_ship("mule", Vector3(-30.0, -6.0, -70.0), 6.0)
	_ship("mule", Vector3(48.0, -22.0, -190.0), 10.0)
	_ship("kestrel", Vector3(-7.0, -3.5, 2.0), 14.0, -18.0)

## The web build's engine glow is tuned for a renderer without real bloom;
## here bloom does the work, so the emissive cores are turned down.
func _tame_glow(n: Node) -> void:
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if m and m.emission_enabled:
				m.emission_energy_multiplier *= 0.35

func _bounds(n: Node) -> AABB:
	var box := AABB()
	var first := true
	for c in n.find_children("*", "MeshInstance3D", true, false):
		var b: AABB = c.global_transform * c.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box
