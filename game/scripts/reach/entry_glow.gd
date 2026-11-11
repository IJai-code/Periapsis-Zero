class_name EntryGlow
extends MeshInstance3D
## The air burning round the Kestrel when she comes down fast through an
## atmosphere (shaders/entry_glow.gdshader). It only looks: the flight is
## ReachShip's and is not touched. Hidden, and costing nothing, whenever
## she is in space or slow.

## Speeds through the air (m/s) where the glow starts and where it is full.
const FROM := 70.0
const FULL := 260.0

var ship: ReachShip
var power := 0.0
## Held on at this strength (for looking at it: the "entry" beat).
var hold := 0.0
var _mat: ShaderMaterial
## The rush of air on the hull, as loud as it is now (0..1).
var rush := 0.0
var _rush: AudioStreamPlayer

func _ready() -> void:
	var sm := SphereMesh.new()
	sm.radius = 4.2
	sm.height = 8.4
	sm.radial_segments = 40
	sm.rings = 20
	mesh = sm
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/entry_glow.gdshader")
	# After the sky, the air and the clouds, which would paint over it.
	_mat.render_priority = 20
	material_override = _mat
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# The tail is drawn out past the sphere's own box.
	extra_cull_margin = 70.0
	visible = false
	_rush = AudioStreamPlayer.new()
	_rush.stream = Explorer._air_stream(false)
	_rush.volume_db = -80.0
	add_child(_rush)
	_rush.play()

## How loud the air is on the hull (0..1): any air at all, from a walking
## pace up.
static func rushing(thick: float, speed: float) -> float:
	return clampf(thick * 1.4, 0.0, 1.0) * smoothstep(8.0, 190.0, speed)

## How hard the air burns: its thickness here, and her speed through it.
static func strength(thick: float, speed: float) -> float:
	return clampf(thick * 1.6, 0.0, 1.0) * smoothstep(FROM, FULL, speed)

func _process(dt: float) -> void:
	if not ship or not ship.system:
		return
	var want := 0.0
	var b := ship.system.ruling()
	var v := ship.linear_velocity
	var thick := 0.0
	if b.atmo > 0.0:
		var r := ship.global_position.length()
		if r < b.atmo:
			thick = 1.0 - smoothstep(b.radius, b.atmo, r)
			want = strength(thick, v.length())
	want = maxf(want, hold)
	# The air heard through the hull, long before it glows.
	rush = rushing(thick, v.length()) if ship.piloted else 0.0
	_rush.volume_db = lerpf(_rush.volume_db, linear_to_db(maxf(rush, 0.0001)) - 13.0 + Flow.sfx_db(), minf(1.0, dt * 3.0))
	_rush.pitch_scale = lerpf(_rush.pitch_scale, 0.7 + rush * 0.9, minf(1.0, dt * 2.0))
	if want <= 0.0 and power <= 0.004:
		if visible:
			visible = false
			power = 0.0
		return
	power = lerpf(power, want, 1.0 - exp(-dt / 0.35))
	visible = true
	_mat.set_shader_parameter("power", power)
	if hold > 0.0:
		_mat.set_shader_parameter("heading", Vector3(0, -0.25, -0.97).normalized())
	elif v.length() > 1.0:
		_mat.set_shader_parameter("heading", (ship.global_basis.inverse() * v).normalized())
