class_name NightSky
extends Node3D
## What the sky does over Hearth after dark: three curtains of aurora
## standing above the crater, and now and then a stone falling through them.
## Given to the Lantern's own setting — the curtains come up as it goes
## down — and drawn only while Hearthstone is the frame's body, so the sky
## costs nothing from orbit or on another world.

const BASE := 720.0
const TOP := 300.0

var reach: Node
## How far into the night it is, 0 by day to 1 at full dark.
var night := 0.0
var _mats: Array[ShaderMaterial] = []
var _up := Vector3.UP
var _side := Vector3.RIGHT
var _shown := false
var _last_night := -1.0
var _rng := RandomNumberGenerator.new()
var _star_t := 7.0
var _star_life := 0.0
var _star_max := 1.0
var _from := Vector3.ZERO
var _to := Vector3.ZERO
var _streak: MeshInstance3D
var _streak_mat: StandardMaterial3D
## For measuring what the sky costs: `-- --noaurora` leaves it dark.
var _off := false

func _ready() -> void:
	_off = "--noaurora" in OS.get_cmdline_user_args()
	_rng.seed = 31
	var planet: Planet = get_parent()
	_up = Worlds.place(planet.body, "village").origin.normalized()
	_side = _up.cross(Vector3.RIGHT if absf(_up.x) < 0.9 else Vector3.FORWARD).normalized()
	for c in 4:
		_curtain(planet.body.radius, c)
	_streak_mesh(planet.body.radius)
	visible = false

## One curtain: a band of triangles on an arc across the sky over the
## village, its bottom edge waving and its top edge higher still, UV.y up
## its height. Four of them at different bearings, so whichever way you
## turn there is one broadside to you.
func _curtain(radius: float, c: int) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segs := 44
	var base := BASE + c * 95.0
	var thick := TOP - c * 25.0
	var axis := _side.rotated(_up, c * PI / 4.0)
	var prev_b := Vector3.ZERO
	var prev_t := Vector3.ZERO
	for i in segs + 1:
		var u := float(i) / segs
		var a := lerpf(-1.0, 1.0, u) + c * 0.05
		var d := _up.rotated(axis, a)
		var wave := 60.0 * sin(a * 5.0 + c) + 25.0 * sin(a * 11.0 - c * 2.0)
		var p := d * (radius + base + wave)
		var t := p + d * thick
		if i > 0:
			for tri in [[prev_b, prev_t, p], [prev_b, p, t]]:
				for v: Vector3 in tri:
					st.set_normal(d)
					st.set_uv(Vector2(u, 0.0 if v == p or v == prev_b else 1.0))
					st.add_vertex(v)
		prev_b = p
		prev_t = t
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/reach/aurora.gdshader")
	m.set_shader_parameter("night", 0.0)
	m.set_shader_parameter("seed", float(c) * 0.37)
	m.set_shader_parameter("strength", 0.32 - c * 0.04)
	m.set_shader_parameter("low_color", Color(0.16, 0.95, 0.62) if c != 1 else Color(0.3, 0.85, 0.85))
	m.set_shader_parameter("high_color", Color(0.34, 0.44, 1.0) if c != 1 else Color(0.5, 0.4, 1.0))
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = m
	m.set_shader_parameter("ring", 0.0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	_mats.append(m)

## The streak a falling stone leaves: a thin triangle, bright at the head.
func _streak_mesh(radius: float) -> void:
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
	var axis := (_side * cos(a) + _up.cross(_side) * sin(a)).normalized()
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
	var show := planet.is_ref and not _off
	if show:
		var up := (cam.global_position - planet.global_position).normalized()
		var star: Vector3 = reach.system.world("lantern")
		var to_star: Vector3 = (star - cam.global_position).normalized()
		night = 1.0 - smoothstep(-0.02, 0.16, up.dot(to_star))
		show = night > 0.02
	if show != _shown:
		_shown = show
		visible = show
	if show and absf(night - _last_night) > 0.02:
		_last_night = night
		for m in _mats:
			m.set_shader_parameter("night", night)
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

func curtains() -> int:
	return _mats.size()

func star_shown() -> bool:
	return _star_life > 0.0
