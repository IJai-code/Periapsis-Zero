class_name NightSky
extends Node3D
## Hearth's night sky: no aurora, only the hard stars the sky texture gives
## and a stone falling through them now and then — the same stones that
## come down over the crater all morning. Drawn only while Hearthstone is
## the frame's body, so the sky costs nothing from orbit or on another
## world.

## How far into the night it is, 0 by day to 1 at full dark.
var night := 0.0
var _up := Vector3.UP
var _shown := false
var _rng := RandomNumberGenerator.new()
var _star_t := 7.0
var _star_life := 0.0
var _star_max := 1.0
var _from := Vector3.ZERO
var _to := Vector3.ZERO
var _streak: MeshInstance3D
var _streak_mat: StandardMaterial3D
var reach: Node

func _ready() -> void:
	_rng.seed = 31
	var planet: Planet = get_parent()
	_up = Worlds.place(planet.body, "village").origin.normalized()
	_streak_mesh()
	visible = false

## The streak a falling stone leaves: a thin triangle, bright at the head.
func _streak_mesh() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var head := Color(1.4, 1.5, 1.7, 1.0)
	var tail := Color(0.3, 0.5, 1.0, 0.0)
	for v: Array in [[Vector3(-1.4, 0, 0), head], [Vector3(1.4, 0, 0), head], [Vector3(0, 0, 90.0), tail]]:
		st.set_normal(Vector3.UP)
		st.set_color(v[1])
		st.add_vertex(v[0])
	_streak_mat = StandardMaterial3D.new()
	_streak_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_streak_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_streak_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_streak_mat.vertex_color_use_as_albedo = true
	_streak_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_streak_mat.albedo_color = Color(1, 1, 1, 0)
	_streak = MeshInstance3D.new()
	_streak.mesh = st.commit()
	_streak.material_override = _streak_mat
	_streak.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_streak.visible = false
	add_child(_streak)

## A stone across the sky, from up beside the zenith down toward the horizon.
func shoot() -> void:
	var a := _rng.randf() * TAU
	var side := _up.cross(Vector3.RIGHT if absf(_up.x) < 0.9 else Vector3.FORWARD).normalized()
	var axis := (side * cos(a) + _up.cross(side) * sin(a)).normalized()
	var r: float = (get_parent() as Planet).body.radius
	_from = _up.rotated(axis, _rng.randf_range(0.45, 0.7)).normalized() * (r + _rng.randf_range(900.0, 1200.0))
	_to = _up.rotated(axis, _rng.randf_range(-0.3, -0.05)).normalized() * (r + _rng.randf_range(780.0, 900.0))
	_star_max = _rng.randf_range(0.55, 1.1)
	_star_life = 0.0001
	_star_t = _rng.randf_range(9.0, 22.0)
	_streak.visible = true

func _process(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var planet: Planet = get_parent()
	if not cam or not reach or not planet:
		return
	var show := planet.is_ref
	if show:
		var up := (cam.global_position - planet.global_position).normalized()
		var star: Vector3 = reach.system.world("lantern")
		var to_star: Vector3 = (star - cam.global_position).normalized()
		night = 1.0 - smoothstep(-0.02, 0.16, up.dot(to_star))
		show = night > 0.02
	if show != _shown:
		_shown = show
		visible = show
	if not show:
		_streak.visible = false
		return
	if night > 0.35:
		_star_t -= dt
		if _star_t <= 0.0:
			shoot()
	if _star_life > 0.0:
		_star_life += dt
		var k := _star_life / _star_max
		if k >= 1.0:
			_star_life = 0.0
			_streak.visible = false
		else:
			var e := k * k * (3.0 - 2.0 * k)
			_streak.global_position = _from.lerp(_to, e)
			_streak.global_basis = Basis.looking_at((_to - _from).normalized(), _up)
			_streak_mat.albedo_color = Color(1.0, 1.0, 1.0, sin(PI * k) * 1.3)

func star_shown() -> bool:
	return _star_life > 0.0
