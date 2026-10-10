class_name Earth
extends Node3D
## Earth seen from orbit: NASA imagery, a cloud deck and the atmospheric limb.
## Drawn at `scale_down` of true size and distance (1/200 by default): it looks
## the same from the ship and keeps the camera's depth range cullable.

const RADIUS := 6_371_000.0

var sun_dir := Vector3(1, 0, 0)
var scale_down := 0.005
var spin := Vector3(deg_to_rad(-28.0), deg_to_rad(110.0), 0.0)
var _clouds: ShaderMaterial

## Earth below a ship at `altitude` metres, the ship at the origin.
static func below(altitude: float, sun: Vector3) -> Earth:
	return toward(Vector3.DOWN, altitude, sun)

## Earth in any direction from the ship: a ship in orbit can lie any way up.
## Far views pass a smaller `scale` so Earth stays inside the camera's range.
static func toward(direction: Vector3, altitude: float, sun: Vector3, scale := 0.005) -> Earth:
	var e := Earth.new()
	e.scale_down = scale
	e.sun_dir = sun.normalized()
	e.position = direction.normalized() * (RADIUS + altitude) * e.scale_down
	return e

func _ready() -> void:
	var k := scale_down
	var surface := _sphere(RADIUS * k, 512)
	var em := ShaderMaterial.new()
	em.shader = load("res://shaders/earth.gdshader")
	em.set_shader_parameter("day_map", load("res://assets/textures/earth_day.jpg"))
	em.set_shader_parameter("night_map", load("res://assets/textures/earth_night.jpg"))
	em.set_shader_parameter("spec_map", load("res://assets/textures/earth_specular.jpg"))
	em.set_shader_parameter("normal_map", load("res://assets/textures/earth_normal.jpg"))
	em.set_shader_parameter("sun_dir", sun_dir)
	surface.material_override = em
	_clouds = ShaderMaterial.new()
	_clouds.shader = load("res://shaders/clouds.gdshader")
	_clouds.set_shader_parameter("cloud_map", load("res://assets/textures/earth_clouds.png"))
	var clouds := _sphere((RADIUS + 9_000.0) * k, 512)
	clouds.material_override = _clouds
	var am := ShaderMaterial.new()
	am.shader = load("res://shaders/atmosphere.gdshader")
	am.set_shader_parameter("sun_dir", sun_dir)
	var air := _sphere((RADIUS + 90_000.0) * k, 256)
	air.material_override = am
	for s: MeshInstance3D in [surface, clouds, air]:
		s.rotation = spin
		s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(s)

func _process(_dt: float) -> void:
	_clouds.set_shader_parameter("drift", Time.get_ticks_msec() * 0.0000002)

func _sphere(r: float, segments: int) -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0
	m.radial_segments = segments
	m.rings = segments / 2
	var mi := MeshInstance3D.new()
	mi.mesh = m
	return mi
