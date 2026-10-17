class_name ReachMap
extends CanvasLayer
## The map (M): the Reach from above, drawn like ink on a chart. Every
## orbit, a mark where each body comes nearest the Lantern (pulsing as it
## gets there), where everything is now, you, and where you are falling
## (your path for the next ten minutes under the Lantern's and the worlds'
## pull, as long as you don't burn). The loop's clock across the top.
## The game does not stop while you look; you just stop moving.
##
## Wheel or + and - to zoom, C to centre on you or the Lantern, M or Esc
## to close.

signal closed

const SPAN := 14500.0   # metres from the Lantern to the frame's edge, at zoom 1
const PREDICT := 600.0
const STEP := 2.0

var reach: Node
var _canvas: Control
var _zoom := 1.0
var _on_you := false
var _t := 0.0
var _path := PackedVector3Array()
var _hit := ""
var _path_t := 0.0
var _orbits := {}
## Where the predicted path crosses a sphere of influence: [path index, label, tint].
var _crossings: Array = []
## Closest approaches along the predicted path: [body key, path index, metres, loop seconds].
var _approaches: Array = []
## The body whose sphere you are in now ("" for the open Reach).
var _inside_now := ""

static func open(r: Node) -> ReachMap:
	var m := ReachMap.new()
	m.reach = r
	r.add_child(m)
	return m

func _ready() -> void:
	layer = 13
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.draw.connect(_paint)
	add_child(_canvas)
	var sys: ReachSystem = reach.system
	for key in sys.order:
		if key != "lantern":
			_orbits[key] = (sys.bodies[key] as ReachBody).orbit.points(160)
	_hold(true)
	Sfx.play("click", -10.0, 0.8)

func close() -> void:
	_hold(false)
	Sfx.play("click", -12.0, 0.6)
	closed.emit()
	queue_free()

## You stop moving while you read the map.
func _hold(on: bool) -> void:
	var ship: ReachShip = reach.ship
	if ship and ship.piloted:
		ship.hold = on
	elif reach.player:
		reach.player.enabled = not on

func _process(dt: float) -> void:
	_t += dt
	_path_t -= dt
	if _path_t <= 0.0:
		_path_t = 0.3
		_predict()
	_canvas.queue_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom = minf(_zoom * 1.18, 40.0)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom = maxf(_zoom / 1.18, 0.6)
		get_viewport().set_input_as_handled()
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_M, KEY_ESCAPE:
				close()
			KEY_C:
				_on_you = not _on_you
			KEY_EQUAL, KEY_KP_ADD:
				_zoom = minf(_zoom * 1.4, 40.0)
			KEY_MINUS, KEY_KP_SUBTRACT:
				_zoom = maxf(_zoom / 1.4, 0.6)
			_:
				return
		get_viewport().set_input_as_handled()

# --- Where you are, and where you are going -----------------------------------------

func _you() -> Node3D:
	var ship: ReachShip = reach.ship
	return ship if ship and ship.piloted else reach.player

func _you_helio() -> Vector3:
	var sys: ReachSystem = reach.system
	return sys.helio(sys.ref) + _you().global_position

func _you_vel() -> Vector3:
	var sys: ReachSystem = reach.system
	var n := _you()
	var v: Vector3 = (n as RigidBody3D).linear_velocity if n is RigidBody3D else (n as CharacterBody3D).velocity
	return v + sys.helio_vel(sys.ref)

## Your fall from here: the Lantern's pull, and inside a world's sphere of
## influence that world's (as the game moves you), stepped ahead in time.
## Which sphere of influence holds `p` at time `t` ("" for the open Reach).
func _inside(p: Vector3, t: float) -> String:
	var sys: ReachSystem = reach.system
	for key in sys.order:
		if key == "lantern":
			continue
		var b: ReachBody = sys.bodies[key]
		if (p - b.orbit.position(t)).length() < b.soi:
			return key
	return ""

## The closest the predicted path comes to each body: anything inside a
## sphere of influence matters, and the locked target always does, however
## far (that is the intercept you are planning).
func _record_approaches(best: Dictionary) -> void:
	_approaches.clear()
	var sys: ReachSystem = reach.system
	var want := String(reach.ship.target) if reach.ship else ""
	for key in best:
		var b: ReachBody = sys.bodies[key]
		var e: Array = best[key]
		if float(e[0]) < b.soi or key == want:
			_approaches.append([key, int(e[1]), float(e[0]), float(e[2])])
	_approaches.sort_custom(func(a, b): return float(a[3]) < float(b[3]))

func _predict() -> void:
	_path.clear()
	_crossings.clear()
	_approaches.clear()
	_hit = ""
	var sys: ReachSystem = reach.system
	var p := _you_helio()
	var t: float = sys.t
	_inside_now = _inside(p, t)
	var n := _you()
	if (n is ReachShip and (n as ReachShip).landed) or (n is Explorer and (n as Explorer).is_on_floor()):
		return
	var v := _you_vel()
	var was := _inside_now
	var best := {}
	var steps := int(PREDICT / STEP)
	for i in steps:
		_path.append(p)
		var now := _inside(p, t)
		if now != was:
			if now != "":
				var b: ReachBody = sys.bodies[now]
				_crossings.append([_path.size() - 1, b.title, b.tint])
			else:
				var left: ReachBody = sys.bodies[was]
				_crossings.append([_path.size() - 1, "leaving " + left.title, left.tint])
			was = now
		for key in sys.order:
			if key == "lantern":
				continue
			var bd: ReachBody = sys.bodies[key]
			var dd := (p - bd.orbit.position(t)).length()
			if not best.has(key) or dd < float((best[key] as Array)[0]):
				best[key] = [dd, _path.size() - 1, t]
		var g := -p.normalized() * ReachSystem.STAR_GM / maxf(p.length_squared(), 1.0)
		for key in sys.order:
			if key == "lantern":
				continue
			var b2: ReachBody = sys.bodies[key]
			var r := p - b2.orbit.position(t)
			var d := r.length()
			if d < b2.radius:
				_hit = b2.title
				_record_approaches(best)
				return
			if d < b2.soi:
				g += -r / d * b2.gm / (d * d)
				break
		if p.length() < ReachSystem.STAR_RADIUS:
			_hit = "the Lantern"
			_record_approaches(best)
			return
		v += g * STEP
		p += v * STEP
		t += STEP
	_record_approaches(best)

# --- Drawing ----------------------------------------------------------------------

func _scale() -> float:
	var vp := _canvas.get_viewport_rect().size
	return minf(vp.x, vp.y) * 0.46 / SPAN * _zoom

func _centre() -> Vector3:
	return _you_helio() if _on_you else Vector3.ZERO

func _to_screen(p: Vector3) -> Vector2:
	var vp := _canvas.get_viewport_rect().size
	var c := _centre()
	# Seen from above: +X right, -Z up the page.
	return vp / 2.0 + Vector2(p.x - c.x, p.z - c.z) * _scale()

## A line drawn like ink: a soft glow under a firm stroke, a little uneven.
func _ink(pts: PackedVector2Array, c: Color, width := 1.8) -> void:
	if pts.size() < 2:
		return
	var w := PackedVector2Array()
	w.resize(pts.size())
	for i in pts.size():
		w[i] = pts[i] + Vector2(sin(i * 0.9 + c.r * 9.0), cos(i * 1.3 + c.g * 7.0)) * 0.6
	_canvas.draw_polyline(w, Color(c, c.a * 0.22), width * 4.5, true)
	_canvas.draw_polyline(w, c, width, true)

func _paint() -> void:
	var sys: ReachSystem = reach.system
	var vp := _canvas.get_viewport_rect().size
	var s := _scale()
	_canvas.draw_rect(Rect2(Vector2.ZERO, vp), Color(0.07, 0.065, 0.06, 0.95))
	# Rings every two kilometres, faint.
	var lc := _to_screen(Vector3.ZERO)
	for k in range(1, 8):
		_canvas.draw_arc(lc, 2000.0 * k * s, 0.0, TAU, 96, Color(ReachStyle.BONE, 0.045), 1.0, true)
	# The Lantern.
	var heat: float = reach.lantern.heat if reach.lantern else 0.0
	var lr := maxf(ReachSystem.STAR_RADIUS * s, 6.0)
	for k in 4:
		_canvas.draw_circle(lc, lr * (1.0 + k * 0.6), Color(1.0, 0.6 - heat * 0.2, 0.25, 0.16 - k * 0.035))
	_canvas.draw_circle(lc, lr, Color(1.0, 0.82 - heat * 0.3, 0.5))
	# The Fold, a soft cloud at the edge of things.
	var fc := _to_screen(Fold.AT)
	var fr := Fold.RADIUS * s
	for k in 5:
		_canvas.draw_circle(fc + Vector2(sin(k * 2.1), cos(k * 1.3)) * fr * 0.25, fr * (1.0 - k * 0.15), Color(0.45 + k * 0.08, 0.6 - k * 0.05, 0.75, 0.06))
	_canvas.draw_string(ReachStyle.serif_italic, fc + Vector2(-fr * 0.5, fr + 18.0), "The Fold", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.7, 0.85, 0.95, 0.85))
	# Orbits, each with its periapsis marked; the mark pulses as the body
	# nears it. The orbit of the sphere you are in glows with it.
	for key in _orbits:
		var b: ReachBody = sys.bodies[key]
		var pts := PackedVector2Array()
		for p: Vector3 in _orbits[key]:
			pts.append(_to_screen(p))
		var to_peri := b.orbit.periapsis_time(sys.t) - sys.t
		var period := b.orbit.period()
		var near := 1.0 - clampf(absf(to_peri) / (period * 0.08), 0.0, 1.0)
		var held := 1.0 if key == _inside_now else 0.0
		var breathe := 0.5 + 0.5 * sin(_t * 6.0)
		var line := Color(b.tint, 0.38 + 0.4 * maxf(near, held * (0.4 + 0.6 * breathe)))
		_ink(pts, line, 1.6 + near * 1.4 + held * 1.2)
		if b.orbit.e > 0.015:
			var pp := _to_screen(b.orbit.position(b.orbit.periapsis_time(sys.t)))
			var pulse := 0.5 + 0.5 * sin(_t * 3.0)
			_canvas.draw_arc(pp, 5.0 + pulse * 3.0 + near * 6.0, 0.0, TAU, 20, Color(b.tint, 0.5 + near * 0.5), 1.5, true)
			if key == "wanderer":
				var at := b.orbit.periapsis_time(sys.t)
				if at < sys.t - 30.0:
					at += period
				_canvas.draw_string(Style.mono, pp + Vector2(12, -8), "PERIAPSIS ZERO  %s" % _clock(at), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(b.tint, 0.9))
	# The bodies where they are now.
	for key in _orbits:
		var b: ReachBody = sys.bodies[key]
		var at := _to_screen(sys.helio(key))
		var r := maxf(b.radius * s, 4.0)
		_canvas.draw_circle(at, r + 3.0, Color(b.tint, 0.18))
		_canvas.draw_circle(at, r, b.tint)
		if b.soi * s > r + 6.0:
			_canvas.draw_arc(at, b.soi * s, 0.0, TAU, 48, Color(b.tint, 0.12), 1.0, true)
		_canvas.draw_string(Style.sans_bold, at + Vector2(r + 7, 5), b.title, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ReachStyle.BONE)
	# Where you will fall.
	if _path.size() > 1:
		var seg := PackedVector2Array()
		for i in _path.size():
			seg.append(_to_screen(_path[i]))
		_ink(seg, Color(ReachStyle.EMBER, 0.85), 1.6)
		# Where the fall crosses a sphere of influence: a pulsing ring, named.
		for c in _crossings:
			var idx: int = c[0]
			if idx < 0 or idx >= seg.size():
				continue
			var tint: Color = c[2]
			var pulse := 0.5 + 0.5 * sin(_t * 4.0)
			_canvas.draw_arc(seg[idx], 6.0 + pulse * 4.0, 0.0, TAU, 24, Color(tint, 0.65 + 0.35 * pulse), 2.0, true)
			_canvas.draw_string(Style.mono, seg[idx] + Vector2(12, -10), String(c[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(tint, 0.95))
		# Closest approaches: a diamond where the fall comes nearest, named
		# with how near and when on the loop's clock.
		for a in _approaches:
			var akey: String = a[0]
			var ab: ReachBody = sys.bodies[akey]
			var aidx: int = a[1]
			if aidx < 0 or aidx >= seg.size():
				continue
			var glow := 0.5 + 0.5 * sin(_t * 4.0 + 1.0)
			var where := seg[aidx]
			var half := 7.0 + glow * 3.0
			_canvas.draw_colored_polygon(PackedVector2Array([where + Vector2(0, -half), where + Vector2(half, 0), where + Vector2(0, half), where + Vector2(-half, 0)]), Color(ab.tint, 0.9))
			var metres := float(a[2])
			var how := ("%.1f km" % (metres / 1000.0)) if metres >= 1000.0 else ("%d m" % int(metres))
			_canvas.draw_string(Style.mono, where + Vector2(12, 14), "%s  %s  @ %s" % [ab.title.to_upper(), how, _clock(float(a[3]))], HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(ab.tint, 0.95))
		if _hit != "":
			var e := seg[seg.size() - 1]
			_canvas.draw_line(e + Vector2(-6, -6), e + Vector2(6, 6), ReachStyle.EMBER, 2.5)
			_canvas.draw_line(e + Vector2(-6, 6), e + Vector2(6, -6), ReachStyle.EMBER, 2.5)
			_canvas.draw_string(Style.mono, e + Vector2(10, 4), "into " + _hit, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ReachStyle.EMBER)
	# You.
	var me := _to_screen(_you_helio())
	var v := _you_vel()
	var dir := Vector2(v.x, v.z).normalized() if Vector2(v.x, v.z).length() > 0.1 else Vector2.UP
	var side := dir.orthogonal()
	_canvas.draw_colored_polygon(PackedVector2Array([me + dir * 9.0, me - dir * 5.0 + side * 5.0, me - dir * 5.0 - side * 5.0]), ReachStyle.PINE)
	_canvas.draw_string(Style.mono_bold, me + Vector2(12, -12), "YOU", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ReachStyle.PINE)
	_header(vp)

## The loop's clock, the marks on it worth knowing.
func _header(vp: Vector2) -> void:
	var sys: ReachSystem = reach.system
	var x0 := 48.0
	var w := minf(520.0, vp.x - 96.0)
	var y := 54.0
	var f := clampf(sys.t / ReachSystem.LOOP, 0.0, 1.0)
	_canvas.draw_string(Style.mono_bold, Vector2(x0, y - 18), "THE REACH  ·  LOOP %d" % int(reach.loop.loops), HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ReachStyle.EMBER)
	_canvas.draw_string(Style.mono, Vector2(x0 + w - 160, y - 18), "%s  of  22:00" % _clock(sys.t), HORIZONTAL_ALIGNMENT_RIGHT, 160, 15, ReachStyle.BONE)
	_canvas.draw_rect(Rect2(Vector2(x0, y - 4), Vector2(w, 4)), Color(ReachStyle.BONE, 0.12))
	_canvas.draw_rect(Rect2(Vector2(x0, y - 4), Vector2(w * f, 4)), ReachStyle.EMBER)
	if Lore.known("wan_door"):
		var a := x0 + w * WandererSite.OPEN_FROM / ReachSystem.LOOP
		var b := x0 + w * WandererSite.OPEN_TO / ReachSystem.LOOP
		_canvas.draw_rect(Rect2(Vector2(a, y - 9), Vector2(b - a, 2)), Color(0.6, 0.85, 1.0, 0.9))
		_canvas.draw_string(Style.mono, Vector2(a, y + 14), "the Engine's door", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.6, 0.85, 1.0))
	_canvas.draw_string(Style.mono, Vector2(48, vp.y - 30), "Wheel  zoom      C  centre on %s      M  close" % ("the Lantern" if _on_you else "you"), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ReachStyle.MUTE)

static func _clock(t: float) -> String:
	var s := int(maxf(t, 0.0))
	return "%02d:%02d" % [s / 60, s % 60]
