class_name Lantern
extends Node3D
## The star: a boiling sphere, its glare, and the sunlight it throws. Ages
## through the loop (it reddens), stutters before the end, and collapses
## into a point (`collapse` 0 to 1) when the loop runs out.

var sphere: MeshInstance3D
var corona: MeshInstance3D
var _mat: ShaderMaterial
var _cor_mat: ShaderMaterial
var heat := 0.0
var flicker := 0.0
var collapse := 0.0
## How bright it is now, 0 to 1 (the planets and the sunlight follow).
var power := 1.0
## The supernova's shell (after the collapse): its radius in metres, 0 when
## there is none.
var nova_r := 0.0
var _nova: MeshInstance3D
var _nova_mat: ShaderMaterial
var _nova_t := -1.0

func _ready() -> void:
	sphere = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = ReachSystem.STAR_RADIUS
	s.height = ReachSystem.STAR_RADIUS * 2.0
	s.radial_segments = 64
	s.rings = 32
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/reach/star.gdshader")
	_mat.render_priority = 2
	s.material = _mat
	sphere.mesh = s
	sphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sphere)
	corona = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * ReachSystem.STAR_RADIUS * 7.0
	_cor_mat = ShaderMaterial.new()
	_cor_mat.shader = load("res://shaders/reach/corona.gdshader")
	_cor_mat.render_priority = 3
	q.material = _cor_mat
	corona.mesh = q
	corona.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(corona)

## The end of the end: from the point the Lantern fell into, a shell of
## light racing outward through the Reach.
func nova() -> void:
	if not _nova:
		_nova = MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = 1.0
		s.height = 2.0
		s.radial_segments = 64
		s.rings = 32
		_nova_mat = ShaderMaterial.new()
		_nova_mat.shader = load("res://shaders/reach/nova.gdshader")
		_nova_mat.render_priority = 4
		s.material = _nova_mat
		_nova.mesh = s
		_nova.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_nova.extra_cull_margin = 16384.0
		add_child(_nova)
	_nova_t = 0.0
	_nova.visible = true

## Back to a star (a new morning).
func reset() -> void:
	collapse = 0.0
	_nova_t = -1.0
	nova_r = 0.0
	if _nova:
		_nova.visible = false

func _process(dt: float) -> void:
	if _nova_t >= 0.0:
		_nova_t += dt
		# Fast, and faster: past Hearthstone in about two seconds.
		nova_r = 200.0 + 1400.0 * _nova_t + 650.0 * _nova_t * _nova_t
		_nova.scale = Vector3.ONE * nova_r
		_nova_mat.set_shader_parameter("age", _nova_t)
		_nova_mat.set_shader_parameter("intensity", 2.5 / (1.0 + _nova_t * 0.25))
	var size := 1.0 - smoothstep(0.0, 1.0, collapse)
	sphere.scale = Vector3.ONE * maxf(size, 0.002)
	corona.scale = Vector3.ONE * maxf(1.0 - collapse * 0.7, 0.05)
	power = (1.0 - flicker * 0.35) * (1.0 - collapse * 0.6)
	_mat.set_shader_parameter("heat", heat)
	_mat.set_shader_parameter("flicker", flicker)
	_mat.set_shader_parameter("power", 1.0 + collapse * 4.0)
	_cor_mat.set_shader_parameter("power", power * (1.0 + collapse * 3.0))
	_cor_mat.set_shader_parameter("color", Color(1.0, 0.7, 0.4).lerp(Color(0.6, 0.85, 1.0), collapse))
