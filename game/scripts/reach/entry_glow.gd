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

## How hard the air burns: its thickness here, and her speed through it.
static func strength(thick: float, speed: float) -> float:
	return clampf(thick * 1.6, 0.0, 1.0) * smoothstep(FROM, FULL, speed)

func _process(dt: float) -> void:
	if not ship or not ship.system:
		return
	var want := 0.0
	var b := ship.system.ruling()
	var v := ship.linear_velocity
	if b.atmo > 0.0:
		var r := ship.global_position.length()
		if r < b.atmo:
			want = strength(1.0 - smoothstep(b.radius, b.atmo, r), v.length())
	want = maxf(want, hold)
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
