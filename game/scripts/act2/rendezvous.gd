class_name Rendezvous
extends Node3D
## Docking with the tanker Calla by hand, flown by her orbit: the flight
## school's lesson, inside the game. Near another craft in orbit, motion
## relative to it follows the Hill-Clohessy-Wiltshire equations (x radial,
## out from the planet; y along the orbit; z across it; n the orbit's rate):
##
##     x'' =  3n²x + 2n y' + ax
##     y'' = -2n x'        + ay
##     z'' = -n² z         + az
##
## so a burn forward along the orbit raises you, and higher is slower: you
## drift back. To close on a craft ahead you drop below it. The orbit here
## is sped up (five minutes round) so the effect shows inside a minute. The
## line ahead of the Kestrel is where she will coast; it bends as you burn.
##
##   W / S       prograde / retrograde (along the orbit)
##   Space / C   radial out / in
##   A / D       across the orbit
##   T           time x4 while coasting      R  start the approach again
## Dock: within 4 m of the port, slower than 0.8 m/s.

signal finished(ok: bool)

const N := TAU / 300.0
const ACC := 0.9
const BUDGET := 45.0

var tanker: Node3D
var flight: FlightScene
var r := Vector3.ZERO
var v := Vector3.ZERO
var used := 0.0
var _warp := 1.0
var _cam: Camera3D
var _path: MeshInstance3D
var _im: ImmediateMesh
var _ui: Control
var _port := Vector3.ZERO
var _done := false
var _thrust := Vector3.ZERO

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# The port is at the tanker's nose, on her orbit ahead of her.
	var length := 0.0
	for mi: MeshInstance3D in tanker.find_children("*", "MeshInstance3D", true, false):
		length = maxf(length, absf((tanker.global_transform.affine_inverse() * mi.global_transform * mi.get_aabb()).position.z))
	_port = Vector3(0.0, maxf(length, 45.0) + 8.0, 0.0)
	_reset()
	var ship := flight.ship
	ship.controls = false
	ship.weapons = false
	ship.set_physics_process(false)
	ship.velocity = Vector3.ZERO
	_cam = Camera3D.new()
	_cam.fov = 60.0
	_cam.far = 120_000.0
	_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_cam)
	_cam.make_current()
	_im = ImmediateMesh.new()
	_path = MeshInstance3D.new()
	_path.mesh = _im
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(0.4, 2.2, 2.8)
	m.vertex_color_use_as_albedo = false
	_path.material_override = m
	_path.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_path.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_path)
	_ui = Control.new()
	_ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flight.overlay.add_child(_ui)
	_ui.draw.connect(_draw_ui)
	flight.hud.visible = false
	Hud.objective("Dock with [the Calla]", "By her orbit, not by eye")
	Report.line("RENDEZVOUS begun")
	Hud.say("Calla", "Kestrel, Calla. Our docking computer's dead. You'll have to fly it the old way. Port's on our nose.")
	Hud.prompt("[W][S] along the orbit    [Space][C] up, down    [A][D] across    [T] time x4", 9.0)
	if "--autofight" in OS.get_cmdline_user_args():
		set_meta("auto", true)

func _reset() -> void:
	# Above her and ahead: high is slow, so you drift back toward her nose.
	r = Vector3(90.0, 520.0, 35.0)
	v = Vector3.ZERO
	used = 0.0

## LVLH to the world: radial is the tanker's up, along-track her nose, cross
## her starboard.
func _world(p: Vector3) -> Vector3:
	var b := tanker.global_basis.orthonormalized()
	return tanker.global_position + b.y * p.x - b.z * p.y + b.x * p.z

static func _accel(p: Vector3, vel: Vector3, a: Vector3) -> Vector3:
	return Vector3(3.0 * N * N * p.x + 2.0 * N * vel.y, -2.0 * N * vel.x, -N * N * p.z) + a

func _step(dt: float, a: Vector3) -> void:
	# RK4 on (r, v).
	var k1v := _accel(r, v, a)
	var k1r := v
	var k2v := _accel(r + k1r * dt * 0.5, v + k1v * dt * 0.5, a)
	var k2r := v + k1v * dt * 0.5
	var k3v := _accel(r + k2r * dt * 0.5, v + k2v * dt * 0.5, a)
	var k3r := v + k2v * dt * 0.5
	var k4v := _accel(r + k3r * dt, v + k3v * dt, a)
	var k4r := v + k3v * dt
	r += (k1r + 2.0 * k2r + 2.0 * k3r + k4r) * dt / 6.0
	v += (k1v + 2.0 * k2v + 2.0 * k3v + k4v) * dt / 6.0

func _process(dt: float) -> void:
	if _done:
		return
	_thrust = Vector3.ZERO
	if used < BUDGET:
		_thrust.y = float(Input.is_key_pressed(KEY_W)) - float(Input.is_key_pressed(KEY_S))
		_thrust.x = float(Input.is_key_pressed(KEY_SPACE)) - float(Input.is_key_pressed(KEY_C))
		_thrust.z = float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A))
	if has_meta("auto"):
		_thrust = _autopilot()
	_warp = 4.0 if (Input.is_key_pressed(KEY_T) and _thrust == Vector3.ZERO) or has_meta("auto") else 1.0
	var a := _thrust.normalized() * ACC if _thrust != Vector3.ZERO else Vector3.ZERO
	used += a.length() * dt
	var steps := 4
	for i in steps:
		_step(dt * _warp / steps, a)
	if Input.is_key_pressed(KEY_R):
		_reset()
	# The Kestrel and the view.
	var ship := flight.ship
	var at := _world(r)
	ship.global_position = at
	var look := _world(_port)
	if at.distance_to(look) > 1.0:
		ship.look_at(look, tanker.global_basis.y)
	var back := (at - look).normalized()
	_cam.global_position = at + back * 26.0 + tanker.global_basis.y * 7.0
	_cam.look_at(look, tanker.global_basis.y)
	_draw_path()
	_ui.queue_redraw()
	# Docked, or struck.
	var to_port := r.distance_to(_port)
	if to_port < 4.0 and v.length() < 0.8:
		_finish(true)
	elif r.length() < 40.0 and v.length() > 1.5:
		_finish(false)
	elif to_port < 4.0:
		# Too fast at the port: a bounce, not a dock.
		v = -v * 0.4
		Sfx.play("hit", -4.0, 0.6)
		flight.ship.shake = 0.6

## For checks: burn to the port in steps, as a careful pilot would.
func _autopilot() -> Vector3:
	var to := _port - r
	var want := to.normalized() * clampf(to.length() * 0.02, 0.3, 4.0)
	var dvel := want - v
	return dvel if dvel.length() > 0.08 else Vector3.ZERO

func _draw_path() -> void:
	_im.clear_surfaces()
	_im.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
	var p := r
	var q := v
	var save_r := r
	var save_v := v
	for i in 90:
		_im.surface_add_vertex(_world(p))
		r = p
		v = q
		_step(2.0, Vector3.ZERO)
		p = r
		q = v
	r = save_r
	v = save_v
	_im.surface_end()
	# The approach corridor: a line out of the port, along her nose.
	_im.surface_begin(Mesh.PRIMITIVE_LINES)
	_im.surface_add_vertex(_world(_port))
	_im.surface_add_vertex(_world(_port + Vector3(0, 120, 0)))
	_im.surface_end()

func _draw_ui() -> void:
	var vp := _ui.get_viewport_rect().size
	var at := Vector2(32, vp.y - 250)
	_ui.draw_rect(Rect2(at - Vector2(12, 26), Vector2(360, 236)), Color(Style.VOID, 0.7))
	var lines := [
		["RENDEZVOUS  ·  CALLA", Style.EMBER],
		["Range to port   %6.1f m" % r.distance_to(_port), Style.BONE],
		["Closing speed   %6.2f m/s" % v.dot((_port - r).normalized()), Style.BONE],
		["Up (radial)     %+7.1f m  %+5.2f" % [r.x - _port.x, v.x], Color(Style.BONE, 0.8)],
		["Along orbit     %+7.1f m  %+5.2f" % [r.y - _port.y, v.y], Color(Style.BONE, 0.8)],
		["Across          %+7.1f m  %+5.2f" % [r.z - _port.z, v.z], Color(Style.BONE, 0.8)],
		["Delta-v left    %6.1f m/s" % maxf(0.0, BUDGET - used), Style.ION if used < BUDGET * 0.8 else Style.EMBER],
		["Burn forward and you rise and drift back.", Style.MUTE],
		["Drop below her to catch up.  [T] time x4  [R] reset", Style.MUTE],
	]
	for i in lines.size():
		_ui.draw_string(Style.mono_bold if i == 0 else Style.mono, at + Vector2(0, i * 24), lines[i][0], HORIZONTAL_ALIGNMENT_LEFT, -1, 12 if i == 0 else 13, lines[i][1])
	if _warp > 1.0:
		_ui.draw_string(Style.mono_bold, Vector2(vp.x / 2.0 - 60, 80), "TIME  x4", HORIZONTAL_ALIGNMENT_CENTER, 120, 16, Style.ION)

func _finish(ok: bool) -> void:
	_done = true
	Report.line("RENDEZVOUS %s" % ("docked" if ok else "struck"))
	if has_meta("auto"):
		Report.line("RENDEZVOUS delta-v used %.1f m/s" % used)
		Report.finish(get_tree())
		return
	Sfx.play("objective" if ok else "alarm", -2.0)
	if ok:
		Hud.say("Calla", "Hard dock. Textbook, Kestrel. We'll take those fuel cells now.")
	var ship := flight.ship
	ship.set_physics_process(true)
	ship.controls = true
	ship.weapons = true
	ship.velocity = Vector3.ZERO
	ship.global_position = _world(_port + Vector3(0, 60, 0))
	ship.camera.make_current()
	flight.hud.visible = true
	_ui.queue_free()
	finished.emit(ok)
	queue_free()
