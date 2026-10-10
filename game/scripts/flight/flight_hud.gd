class_name FlightHud
extends Control
## The flight overlay: crosshair and nose, brackets on the Hollow with a lead
## marker, the objective marker, shield and hull, and the Aster's state.
## Off-screen things get an arrow at the edge.

var ship: PlayerShip
var enemies: Array = []
var goal: Node3D = null
var goal_label := ""
var protect: Hull = null
var _flash := 0.0

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func flash() -> void:
	_flash = 1.0

func _process(dt: float) -> void:
	_flash = maxf(0.0, _flash - dt * 2.5)
	queue_redraw()

func _draw() -> void:
	if not ship or not is_instance_valid(ship):
		return
	var cam := ship.camera
	var vp := get_viewport_rect().size
	if _flash > 0.0:
		draw_rect(Rect2(Vector2.ZERO, vp), Color(Style.EMBER, _flash * 0.18))
	# Nose and aim.
	var nose := _screen(cam, ship.global_position - ship.global_basis.z * 450.0)
	if nose.x > -1:
		draw_circle(nose, 3.0, Color(Style.BONE, 0.7))
	var aim := _screen(cam, ship.global_position + ship.aim * 450.0)
	if aim.x > -1:
		draw_arc(aim, 16.0, 0.0, TAU, 40, Color(Style.ION, 0.9), 2.0, true)
		for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
			draw_line(aim + d * 22.0, aim + d * 30.0, Color(Style.ION, 0.9), 2.0, true)
	# The Hollow.
	var best: Hull = null
	var best_d := 1e9
	for e: Hull in enemies:
		if not is_instance_valid(e) or not e.alive:
			continue
		var dist := ship.global_position.distance_to(e.global_position)
		var p := _screen(cam, e.global_position)
		if p.x > -1 and Rect2(Vector2.ZERO, vp).has_point(p):
			var s := clampf(1400.0 / maxf(dist, 1.0), 14.0, 40.0)
			_brackets(p, s, Style.EMBER)
			draw_string(Style.mono, p + Vector2(s + 6, 4), "%d m" % dist, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(Style.EMBER, 0.9))
			if aim.x > -1 and p.distance_to(aim) < best_d and dist < 1500.0:
				best_d = p.distance_to(aim)
				best = e
		else:
			_edge_arrow(cam, e.global_position, Style.EMBER)
	if best:
		var dist := ship.global_position.distance_to(best.global_position)
		var lead := best.global_position + (best.velocity - ship.velocity) * (dist / Bolts.SPEED)
		var lp := _screen(cam, lead)
		if lp.x > -1:
			var d := 9.0
			draw_polyline(PackedVector2Array([lp + Vector2(0, -d), lp + Vector2(d, 0), lp + Vector2(0, d), lp + Vector2(-d, 0), lp + Vector2(0, -d)]), Style.EMBER, 2.0, true)
	# Objective.
	if goal and is_instance_valid(goal):
		var gp := _screen(cam, goal.global_position)
		var dist := ship.global_position.distance_to(goal.global_position)
		if gp.x > -1 and Rect2(Vector2.ZERO, vp).has_point(gp):
			var d := 12.0
			draw_polyline(PackedVector2Array([gp + Vector2(0, -d), gp + Vector2(d, 0), gp + Vector2(0, d), gp + Vector2(-d, 0), gp + Vector2(0, -d)]), Style.ION, 2.5, true)
			draw_string(Style.mono_bold, gp + Vector2(18, 5), "%s  %d m" % [goal_label, dist], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Style.ION)
		else:
			_edge_arrow(cam, goal.global_position, Style.ION)
	# Shield, hull and speed, bottom left.
	var base := Vector2(40, vp.y - 110)
	_bar(base, "SHIELD", ship.shield / ship.max_shield, Style.ION)
	_bar(base + Vector2(0, 30), "HULL", ship.integrity / ship.max_integrity, Style.BONE if ship.integrity > 35.0 else Style.EMBER)
	draw_string(Style.mono_bold, base + Vector2(0, 74), "%d m/s%s" % [ship.velocity.length(), "  BOOST" if ship.boosting else ""], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Style.BONE)
	# The ship we are protecting, top centre.
	if protect and is_instance_valid(protect):
		var w := 320.0
		var at := Vector2((vp.x - w) / 2.0, 40)
		draw_string(Style.mono_bold, at + Vector2(0, -8), "ASTER", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Style.MUTE)
		draw_rect(Rect2(at, Vector2(w, 6)), Color(Style.BONE, 0.15))
		draw_rect(Rect2(at, Vector2(w * protect.integrity / protect.max_integrity, 6)), Style.EMBER if protect.integrity < 50.0 else Style.BONE)

func _bar(at: Vector2, name: String, frac: float, color: Color) -> void:
	draw_string(Style.mono_bold, at + Vector2(0, -6), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Style.MUTE)
	draw_rect(Rect2(at, Vector2(220, 7)), Color(Style.BONE, 0.14))
	draw_rect(Rect2(at, Vector2(220.0 * clampf(frac, 0.0, 1.0), 7)), color)

func _brackets(p: Vector2, s: float, c: Color) -> void:
	var k := s * 0.45
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			var corner := p + Vector2(sx * s, sy * s)
			draw_line(corner, corner - Vector2(sx * k, 0), c, 2.0, true)
			draw_line(corner, corner - Vector2(0, sy * k), c, 2.0, true)

func _edge_arrow(cam: Camera3D, world: Vector3, c: Color) -> void:
	var vp := get_viewport_rect().size
	var local := cam.global_basis.inverse() * (world - cam.global_position)
	var dir := Vector2(local.x, -local.y)
	if dir.length() < 0.001:
		return
	dir = dir.normalized()
	var centre := vp / 2.0
	var r := minf(vp.x, vp.y) * 0.42
	var p := centre + dir * r
	var n := Vector2(-dir.y, dir.x)
	draw_colored_polygon(PackedVector2Array([p + dir * 14.0, p - dir * 6.0 + n * 9.0, p - dir * 6.0 - n * 9.0]), c)

func _screen(cam: Camera3D, world: Vector3) -> Vector2:
	if cam.is_position_behind(world):
		return Vector2(-9999, -9999)
	return cam.unproject_position(world)
