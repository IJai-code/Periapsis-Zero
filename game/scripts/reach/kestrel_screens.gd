class_name KestrelScreens
extends Node
## The Kestrel's two cockpit screens, live: drawn in 2D into small textures
## a dozen times a second and laid over the dash's glass.
##
## The main screen (middle) is what you fly by: a horizon that tilts and
## climbs with her against the world below, her speed, height and sink, the
## locked world and how fast she is closing on it, and what the assist or
## the autopilot is doing; low over the ground it turns into the landing
## screen, the sink rate big and coloured. The status screen (left) is the
## ship: hull, gear, hatch, assist, and the keys for each.

const MAIN_PX := Vector2i(480, 316)
const STATUS_PX := Vector2i(300, 260)

var ship: ReachShip
var _main_vp: SubViewport
var _status_vp: SubViewport
var _main: Control
var _status: Control
var _t := 0.0
var _blink := 0.0

static func make(s: ReachShip, on: Node3D, main_at: Transform3D, main_size: Vector2, status_at: Transform3D, status_size: Vector2) -> KestrelScreens:
	var k := KestrelScreens.new()
	k.ship = s
	s.add_child(k)
	k._main_vp = k._viewport(MAIN_PX)
	k._status_vp = k._viewport(STATUS_PX)
	k._main = k._canvas(k._main_vp, k._paint_main)
	k._status = k._canvas(k._status_vp, k._paint_status)
	k._quad(on, k._main_vp, main_at, main_size)
	k._quad(on, k._status_vp, status_at, status_size)
	return k

func _viewport(px: Vector2i) -> SubViewport:
	var vp := SubViewport.new()
	vp.size = px
	vp.disable_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(vp)
	return vp

func _canvas(vp: SubViewport, paint: Callable) -> Control:
	var c := Control.new()
	c.size = Vector2(vp.size)
	c.draw.connect(paint)
	vp.add_child(c)
	return c

func _quad(on: Node3D, vp: SubViewport, at: Transform3D, size: Vector2) -> void:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = size
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_texture = vp.get_texture()
	m.albedo_color = Color(1.25, 1.25, 1.25)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	on.add_child(mi)
	mi.transform = at

## Redrawn a dozen times a second while she is flown from inside.
func tick(dt: float) -> void:
	_t -= dt
	_blink += dt
	if _t > 0.0:
		return
	_t = 0.08
	_main.queue_redraw()
	_status.queue_redraw()
	_main_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	_status_vp.render_target_update_mode = SubViewport.UPDATE_ONCE

const BG := Color(0.03, 0.07, 0.09)
const INK := Color(0.72, 0.93, 1.0)
const DIM := Color(0.72, 0.93, 1.0, 0.45)
const OK := Color(0.55, 1.0, 0.62)
const WARN := Color(1.0, 0.72, 0.3)
const BAD := Color(1.0, 0.32, 0.22)

func _text(c: Control, at: Vector2, s: String, size: int, col: Color, bold := false, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	c.draw_string(Style.mono_bold if bold else Style.mono, at, s, align, width, size, col)

func _paint_main() -> void:
	var c := _main
	var w := float(MAIN_PX.x)
	var h := float(MAIN_PX.y)
	c.draw_rect(Rect2(0, 0, w, h), BG)
	var sys := ship.system
	if not sys:
		return
	var b := sys.ruling()
	var near := b.key != "lantern"
	var up := (ship.global_position - b.node.position).normalized() if near else Vector3.ZERO
	var key := ship.assist_body if ship.assist_body != "" else (ship.target if ship.target != "" else b.key)
	var v := ship.linear_velocity - (sys.world_vel(key) if sys.bodies.has(key) else Vector3.ZERO)
	var low := near and ship.altitude < 60.0
	# The horizon: tilted by her roll, raised by her nose against the world.
	var mid := Vector2(w * 0.5, h * 0.5 + 6.0)
	var r := 112.0
	if near:
		var bs := ship.global_basis
		var roll := atan2(bs.x.dot(up), bs.y.dot(up))
		var pitch := asin(clampf((-bs.z).dot(up), -1.0, 1.0))
		var dir := Vector2(cos(roll), sin(roll))
		var off := Vector2(-dir.y, dir.x) * pitch * r * 1.2
		c.draw_circle(mid, r, Color(0.07, 0.16, 0.22))
		# The ground half, as a polygon clipped by the circle (sampled).
		var poly := PackedVector2Array()
		for i in 65:
			var a := TAU * i / 64.0
			var p := mid + Vector2(cos(a), sin(a)) * r
			var side := (p - (mid + off)).dot(Vector2(-dir.y, dir.x))
			if side >= 0.0:
				poly.append(p)
			else:
				# Project onto the horizon line, inside the circle.
				var on := p - Vector2(-dir.y, dir.x) * side
				if on.distance_to(mid) <= r:
					poly.append(on)
		if poly.size() >= 3:
			c.draw_colored_polygon(poly, Color(0.2, 0.15, 0.08))
		var hl := mid + off
		c.draw_line(hl - dir * r * 1.1, hl + dir * r * 1.1, INK, 2.0)
		for k: int in [-2, -1, 1, 2]:
			var pk := hl + Vector2(-dir.y, dir.x) * (-k * r * 0.21)
			c.draw_line(pk - dir * 18.0, pk + dir * 18.0, DIM, 1.0)
		c.draw_arc(mid, r, 0.0, TAU, 64, DIM, 2.0)
	else:
		c.draw_arc(mid, r, 0.0, TAU, 64, DIM, 2.0)
		_text(c, mid + Vector2(-r, 6), "OPEN SPACE", 22, DIM, true, HORIZONTAL_ALIGNMENT_CENTER, r * 2.0)
	# Her own wings, fixed in the middle.
	c.draw_line(mid + Vector2(-46, 0), mid + Vector2(-14, 0), WARN, 4.0)
	c.draw_line(mid + Vector2(14, 0), mid + Vector2(46, 0), WARN, 4.0)
	c.draw_circle(mid, 4.0, WARN)
	# Left column: speed. Right column: height and sink.
	_text(c, Vector2(14, 40), "SPEED", 15, DIM)
	_text(c, Vector2(14, 72), "%d" % int(v.length()), 32, INK, true)
	_text(c, Vector2(14, 92), "m/s", 15, DIM)
	if near and ship.altitude < 100000.0:
		_text(c, Vector2(w - 14, 40), "HEIGHT", 15, DIM, false, HORIZONTAL_ALIGNMENT_RIGHT, -1)
		_text(c, Vector2(w - 160, 72), _range(maxf(ship.altitude, 0.0)), 32, INK, true, HORIZONTAL_ALIGNMENT_RIGHT, 146)
		var s := ship.sink
		var col := OK if s < 4.0 else (WARN if s < 10.0 else BAD)
		_text(c, Vector2(w - 160, 112), ("SINK %d" % int(s)) if s > 0.5 else ("RISE %d" % int(-s)) if s < -0.5 else "LEVEL", 18, col if s > 0.5 else INK, true, HORIZONTAL_ALIGNMENT_RIGHT, 146)
	# The world she is working against.
	var lines: Array = []
	if ship.target != "" and sys.bodies.has(ship.target):
		var tb: ReachBody = sys.bodies[ship.target]
		var to := sys.world(ship.target) - ship.global_position
		var d := to.length() - tb.radius
		var closing := (ship.linear_velocity - sys.world_vel(ship.target)).dot(to.normalized())
		lines.append(["LOCK " + tb.title.to_upper(), INK])
		lines.append(["%s  %+d m/s" % [_range(d), int(closing)], DIM])
	var y := h - 64.0
	for l in lines:
		_text(c, Vector2(14, y), l[0], 17, l[1], true)
		y += 22.0
	# What the assist is doing, along the bottom.
	var state := ""
	var scol := DIM
	if ship.autopilot:
		state = "AUTOPILOT"
		scol = OK
	elif not ship.assist:
		state = "ASSIST OFF"
		scol = WARN
	elif ship.assist_doing == "BRAKING":
		state = "BRAKING"
		scol = WARN if fmod(_blink, 0.6) < 0.3 else BAD
	elif ship.assist_doing != "":
		state = ship.assist_doing
		scol = OK
	elif ship.assist_body != "" and sys.bodies.has(ship.assist_body):
		state = "ASSIST · " + (sys.bodies[ship.assist_body] as ReachBody).title.to_upper()
	if state != "":
		_text(c, Vector2(w - 14, h - 20), state, 17, scol, true, HORIZONTAL_ALIGNMENT_RIGHT, -1)
	if low:
		# The landing screen: the sink rate, big, over everything.
		var s2 := ship.sink
		var col2 := OK if s2 < 3.0 else (WARN if s2 < 7.0 else BAD)
		c.draw_rect(Rect2(w * 0.5 - 92, 16, 184, 34), Color(0, 0, 0, 0.5))
		_text(c, Vector2(w * 0.5 - 92, 41), "LANDING  %.1f" % maxf(s2, 0.0), 20, col2, true, HORIZONTAL_ALIGNMENT_CENTER, 184)
	# The loop's clock, top middle (when not landing).
	var root := ship.get_tree().get_first_node_in_group("reach_root")
	if not low and root and root.system:
		var left := maxf(ReachSystem.LOOP - float(root.system.t), 0.0)
		_text(c, Vector2(w * 0.5 - 80, 30), "%02d:%02d" % [int(left) / 60, int(left) % 60], 20, WARN if left < 120.0 else DIM, true, HORIZONTAL_ALIGNMENT_CENTER, 160)
	# Scan lines, faintly.
	for yy in range(0, int(h), 4):
		c.draw_line(Vector2(0, yy), Vector2(w, yy), Color(0, 0, 0, 0.12), 1.0)

func _paint_status() -> void:
	var c := _status
	var w := float(STATUS_PX.x)
	var h := float(STATUS_PX.y)
	c.draw_rect(Rect2(0, 0, w, h), Color(0.02, 0.07, 0.03))
	var g := Color(0.55, 1.0, 0.62)
	var gd := Color(0.55, 1.0, 0.62, 0.45)
	_text(c, Vector2(14, 30), "KESTREL", 22, g, true)
	var hull := int(ship.integrity)
	_text(c, Vector2(14, 62), "HULL", 16, gd)
	var hc := g if hull > 60 else (WARN if hull > 30 else BAD)
	c.draw_rect(Rect2(80, 48, 150, 16), Color(g, 0.15))
	c.draw_rect(Rect2(80, 48, 150.0 * clampf(ship.integrity / 100.0, 0.0, 1.0), 16), hc)
	_text(c, Vector2(238, 62), "%d%%" % hull, 16, hc, true)
	var rows := [
		["GEAR", "DOWN" if ship.landed else "UP"],
		["ASSIST", "ON" if ship.assist else "OFF"],
		["PILOT", "AUTO" if ship.autopilot else "YOU"],
	]
	var y := 92.0
	for row: Array in rows:
		_text(c, Vector2(14, y), row[0], 16, gd)
		_text(c, Vector2(110, y), row[1], 16, g, true)
		y += 22.0
	y += 6.0
	var keys := ["T  lock a world", "G  autopilot to it", "F  match its speed", "R  flight assist", "V  view outside"]
	if ship.landed:
		keys.append("E  leave the seat")
	for k: String in keys:
		_text(c, Vector2(14, y), k, 14, gd)
		y += 19.0
	for yy in range(0, int(h), 4):
		c.draw_line(Vector2(0, yy), Vector2(w, yy), Color(0, 0, 0, 0.14), 1.0)

static func _range(d: float) -> String:
	return "%d m" % int(d) if d < 1000.0 else "%.1f km" % (d / 1000.0)
