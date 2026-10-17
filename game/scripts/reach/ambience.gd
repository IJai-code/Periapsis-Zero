class_name Ambience
extends Node3D
## Small life on the ground: fireflies over Hearthstone's grass, ash drifting
## down Ashfall's crater, pale spores rising through Verdance's jungle, cold
## dust round the Phantom and the Wanderer. A thin slab of particles that
## follows whoever is walking, so the air is only ever busy where someone can
## see it. Dormant unless its world is the frame's.

const FOLLOW := 0.5
const NEAR := 1500.0

var host: Node3D
var key := ""
var _parts: CPUParticles3D
var _cam: Camera3D
var _next := 0.0

## The air of one world, attached to its Planet node. Quiet for any key it
## does not know.
static func attach(host_: Node3D, key_: String) -> Ambience:
	var a := Ambience.new()
	a.host = host_
	a.key = key_
	a.name = "Ambience"
	host_.add_child(a)
	return a

func _ready() -> void:
	visible = false
	if not _known():
		return
	_parts = CPUParticles3D.new()
	_parts.emitting = true
	_parts.amount = _amount()
	_parts.lifetime = _life()
	_parts.preprocess = 2.5
	_parts.local_coords = false
	_parts.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_parts.emission_box_extents = Vector3(34.0, 1.2, 34.0)
	_parts.direction = Vector3(0, 1, 0)
	_parts.spread = 60.0
	_parts.initial_velocity_min = 0.05
	_parts.initial_velocity_max = 0.45
	_parts.scale_amount_min = 0.55
	_parts.scale_amount_max = 1.5
	_parts.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var q := QuadMesh.new()
	q.size = Vector2(_size(), _size())
	q.material = _material()
	_parts.mesh = q
	_parts.color_ramp = _ramp()
	_parts.visibility_aabb = AABB(Vector3(-90, -90, -90), Vector3(180, 180, 180))
	_parts.position = Vector3(0, _radius() + 1.6, 0)
	add_child(_parts)
	_place()

func _radius() -> float:
	var b = host.get("body") if host else null
	return float(b.radius) if b else 0.0

func _known() -> bool:
	return key in ["hearthstone", "ashfall", "verdance", "phantom", "wanderer"]

func _amount() -> int:
	match key:
		"hearthstone": return 48
		"ashfall": return 36
		"verdance": return 40
	return 18

func _life() -> float:
	match key:
		"hearthstone": return 9.0
		"ashfall": return 14.0
		"verdance": return 12.0
	return 10.0

func _size() -> float:
	match key:
		"hearthstone": return 0.09
		"ashfall": return 0.055
		"verdance": return 0.07
	return 0.045

## A soft round dot, drawn once: a billboard with no texture reads as a square.
static func _dot() -> GradientTexture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.width = 16
	t.height = 16
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	return t

func _material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = _dot()
	m.disable_receive_shadows = true
	return m

## How each world's air reads: warm and blinking, grey and falling, pale and
## rising, faint and cold.
func _ramp() -> Gradient:
	var g := Gradient.new()
	match key:
		"hearthstone":
			g.offsets = PackedFloat32Array([0.0, 0.18, 0.32, 0.46, 0.6, 0.74, 1.0])
			g.colors = PackedColorArray([
				Color(1.0, 0.72, 0.28, 0.0), Color(1.0, 0.78, 0.34, 0.95),
				Color(1.0, 0.68, 0.24, 0.1), Color(0.9, 0.85, 0.5, 0.9),
				Color(1.0, 0.7, 0.3, 0.15), Color(1.0, 0.76, 0.36, 0.85),
				Color(1.0, 0.72, 0.3, 0.0)])
		"ashfall":
			g.offsets = PackedFloat32Array([0.0, 0.2, 1.0])
			g.colors = PackedColorArray([
				Color(0.62, 0.6, 0.57, 0.0), Color(0.66, 0.64, 0.6, 0.55),
				Color(0.58, 0.56, 0.53, 0.0)])
		"verdance":
			g.offsets = PackedFloat32Array([0.0, 0.25, 0.7, 1.0])
			g.colors = PackedColorArray([
				Color(0.88, 0.95, 0.72, 0.0), Color(0.9, 0.97, 0.76, 0.5),
				Color(0.84, 0.93, 0.7, 0.35), Color(0.8, 0.9, 0.7, 0.0)])
	return g

## Put the slab on the ground under whoever is looking, its up along the
## world's own up. Runs on a timer, never per frame.
func _place() -> void:
	if not _parts or not _parts.is_inside_tree():
		return
	_cam = get_viewport().get_camera_3d()
	if not _cam:
		return
	var up := to_local(_cam.global_position).normalized()
	if up.length() < 0.5:
		up = Vector3.UP
	var f := up.cross(Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD).normalized()
	_parts.basis = Basis(up.cross(f).normalized(), up, f).orthonormalized()
	_parts.position = up * (_radius() + 1.6)
	var world_up := (_parts.global_basis.y).normalized()
	match key:
		"hearthstone": _parts.gravity = Vector3.ZERO
		"ashfall": _parts.gravity = -world_up * 0.22 + _parts.global_basis.x * 0.05
		"verdance": _parts.gravity = world_up * 0.05
		_: _parts.gravity = Vector3.ZERO

func _process(dt: float) -> void:
	if not _parts:
		return
	var on := bool(host.get("is_ref")) if host else false
	if on:
		# Follow on a timer. Placed first, so the distance test has a camera.
		_next -= dt
		if _next <= 0.0:
			_next = FOLLOW
			_place()
		if _cam and is_instance_valid(_cam):
			on = _cam.global_position.distance_squared_to(global_position) < NEAR * NEAR
	if visible != on:
		visible = on
		_parts.emitting = on
