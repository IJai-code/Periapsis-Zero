class_name Lamp
extends Node3D
## A lamp: an OmniLight3D and a soft halo that stands in for it when it is too
## far away to be worth lighting. Lights are the expensive part of a night
## scene (every one of them multiplies the fragment work of everything it
## touches), so only those near the camera burn; the rest are a lit dot.
##
## Nothing here runs per frame: Reach pumps the register a few times a second
## (`pump`, which turns the lights on and off) and breathes the lit ones
## (`animate`).

## A lamp lights while the camera is within this many of its own ranges.
const NEAR := 3.0
## Past this the halo itself is not worth drawing.
const HALO_END := 260.0

static var _all: Array[Lamp] = []
static var _dot_tex: GradientTexture2D

## A lamp at `at` (in its parent's space).
static func make(parent: Node3D, at: Vector3, color := Color(1.0, 0.68, 0.36), light_energy := 1.2, reach := 7.0) -> Lamp:
	var l := Lamp.new()
	l.name = "Lamp"
	l.light = OmniLight3D.new()
	l.light.light_color = color
	l.light.light_energy = light_energy
	l.light.omni_range = reach
	l.light.position = at
	l.light.shadow_enabled = false
	l.add_child(l.light)
	var q := QuadMesh.new()
	q.size = Vector2(1.6, 1.6)
	q.material = _halo_material(color)
	l._halo = MeshInstance3D.new()
	l._halo.mesh = q
	l._halo.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	l._halo.position = at
	l._halo.visibility_range_end = HALO_END
	l._halo.visibility_range_end_margin = 40.0
	l._halo.visible = false
	l.add_child(l._halo)
	l.energy = light_energy
	l.reach = reach
	l.phase = fmod(absf(at.x * 1.7 + at.y * 3.1 + at.z * 0.9), TAU)
	parent.add_child(l)
	_all.append(l)
	return l

var light: OmniLight3D
var on := false
## How far lit (0 a halo only, 1 a real light): eased, not switched.
var fade := 0.0
static var _last_t := 0.0
var energy := 1.2
var reach := 7.0
var phase := 0.0
var _halo: MeshInstance3D

## A soft round dot, additively blended: a lamp seen from across the valley.
static func _halo_material(color: Color) -> StandardMaterial3D:
	if not _dot_tex:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		_dot_tex = GradientTexture2D.new()
		_dot_tex.gradient = g
		_dot_tex.fill = GradientTexture2D.FILL_RADIAL
		_dot_tex.width = 32
		_dot_tex.height = 32
		_dot_tex.fill_from = Vector2(0.5, 0.5)
		_dot_tex.fill_to = Vector2(1.0, 0.5)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_texture = _dot_tex
	m.albedo_color = Color(color.r, color.g, color.b, 0.5)
	m.disable_receive_shadows = true
	return m

## Turn the lamps near the camera on, the rest to halos. Returns how many of
## each there are, for the checks.
static func pump(cam: Camera3D) -> Dictionary:
	var lit := 0
	var dark := 0
	if not cam:
		return {"lit": 0, "dark": _all.size()}
	for l in _all:
		if not is_instance_valid(l) or not l.is_inside_tree():
			continue
		var want := cam.global_position.distance_to(l.global_position) < maxf(l.reach * NEAR, 24.0)
		if want != l.on:
			l.on = want
			# The light fades in and out (animate), never switches.
			l.light.visible = true
		if want:
			lit += 1
		else:
			dark += 1
	return {"lit": lit, "dark": dark}

## The flame of a wick: a couple of slow sines, so a row of lamps never
## pulses in time. Only lit lamps are touched.
static func animate(t: float) -> void:
	var dt := clampf(t - _last_t, 0.0, 0.1)
	_last_t = t
	for l in _all:
		if not is_instance_valid(l):
			continue
		if not l.on and l.fade <= 0.0:
			continue
		l.fade = move_toward(l.fade, 1.0 if l.on else 0.0, dt * 1.5)
		l.light.visible = l.fade > 0.0
		l._halo.visible = l.fade < 0.6
		l.light.light_energy = l.energy * l.fade * (0.96 + 0.04 * sin(t * 3.1 + l.phase) * sin(t * 1.3 + l.phase * 1.3))

func _exit_tree() -> void:
	_all.erase(self)
