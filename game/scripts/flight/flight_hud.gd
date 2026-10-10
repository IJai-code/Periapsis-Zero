class_name FlightHud
extends Control
## The flight overlay, built around the crosshair so the eyes never leave
## the fight: shield (left arc) and hull (right arc) hug the reticle, speed
## sits under it, hits and kills flash on it. Targets get brackets with a
## name, range and health; the one nearest the reticle gets a lead marker.
## Off-screen things get arrows at the edge. Damage tints the screen's edges.

var ship: PlayerShip
var enemies: Array = []
var goal: Node3D = null
var goal_label := ""
var protect: Hull = null
var _flash := 0.0
var _hit := 0.0
var _kill := 0.0
var _clock := 0.0

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

## The player was hit.
func flash() -> void:
	_flash = 1.0

## The player's shot landed.
func hit_marker() -> void:
	_hit = 1.0

## The player destroyed something.
func kill() -> void:
	_kill = 1.0
	_hit = 1.0

func _process(dt: float) -> void:
	_clock += dt
	_flash = maxf(0.0, _flash - dt * 2.2)
	_hit = maxf(0.0, _hit - dt * 6.0)
	_kill = maxf(0.0, _kill - dt * 0.9)
	queue_redraw()

func _draw() -> void:
	if not ship or not is_instance_valid(ship):
		return
	var cam := ship.camera
	var vp := get_viewport_rect().size
	_edges(vp)
	var aim := _screen(cam, ship.global_position + ship.aim * 450.0)
	var nose := _screen(cam, ship.global_position - ship.global_basis.z * 450.0)
	if nose.x > -1:
		draw_polyline(PackedVector2Array([nose + Vector2(-7, 4), nose, nose + Vector2(7, 4)]), Color(Style.BONE, 0.7), 2.0, true)
	if aim.x > -1:
		_reticle(aim)
	# The Hollow.
	var best: Hull = null
	var best_d := 1e9
	for e: Hull in enemies:
		if not is_instance_valid(e) or not e.alive:
			continue
		var dist := ship.global_position.distance_to(e.global_position)
		var p := _screen(cam, e.global_position)
		if p.x > -1 and Rect2(Vector2.ZERO, vp).has_point(p):
			var s := clampf(1800.0 / maxf(dist, 1.0), 16.0, 46.0)
			_brackets(p, s, Style.EMBER)
			draw_string(Style.mono_bold, p + Vector2(s + 8, -4), "HOLLOW RAIDER", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(Style.EMBER, 0.95))
			draw_string(Style.mono, p + Vector2(s + 8, 12), "%d m" % dist, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(Style.BONE, 0.8))
			var w := s * 2.0
			draw_rect(Rect2(p + Vector2(-s, s + 6), Vector2(w, 3)), Color(Style.BONE, 0.18))
			draw_rect(Rect2(p + Vector2(-s, s + 6), Vector2(w * e.integrity / e.max_integrity, 3)), Style.EMBER)
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
			_diamond(lp, 10.0, Style.EMBER, 2.0)
			draw_line(lp, _screen(cam, best.global_position), Color(Style.EMBER, 0.35), 1.0, true)
	# Objective.
	if goal and is_instance_valid(goal):
		var gp := _screen(cam, goal.global_position)
		var dist := ship.global_position.distance_to(goal.global_position)
		if gp.x > -1 and Rect2(Vector2.ZERO, vp).has_point(gp):
			_diamond(gp, 13.0, Style.ION, 2.5)
			draw_string(Style.mono_bold, gp + Vector2(20, 5), "%s  %d m" % [goal_label, dist], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Style.ION)
		else:
			_edge_arrow(cam, goal.global_position, Style.ION)
	# The ship we are protecting.
	if protect and is_instance_valid(protect) and protect.alive:
		var w := 360.0
		var at := Vector2((vp.x - w) / 2.0, 46)
		var frac := protect.integrity / protect.max_integrity
		draw_string(Style.mono_bold, at + Vector2(0, -10), "ASTER · HULL %d%%" % int(frac * 100.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Style.MUTE)
		draw_rect(Rect2(at, Vector2(w, 5)), Color(Style.BONE, 0.14))
		draw_rect(Rect2(at, Vector2(w * frac, 5)), Style.EMBER if frac < 0.5 else Style.BONE)
	if ship.integrity < ship.max_integrity * 0.3 and fmod(_clock, 0.8) < 0.5:
		var t := "HULL CRITICAL"
		draw_string(Style.mono_bold, Vector2(vp.x / 2.0 - 70, vp.y * 0.62), t, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Style.EMBER)

## The reticle: a broken ring, shield arc left, hull arc right, speed below,
## and the hit and kill confirmations.
func _reticle(c: Vector2) -> void:
	var ion := Color(Style.ION, 0.9)
	draw_arc(c, 18.0, deg_to_rad(20), deg_to_rad(70), 10, ion, 2.0, true)
	draw_arc(c, 18.0, deg_to_rad(110), deg_to_rad(160), 10, ion, 2.0, true)
	draw_arc(c, 18.0, deg_to_rad(200), deg_to_rad(250), 10, ion, 2.0, true)
	draw_arc(c, 18.0, deg_to_rad(290), deg_to_rad(340), 10, ion, 2.0, true)
	draw_circle(c, 1.8, ion)
	var r := 64.0
	var sh := clampf(ship.shield / ship.max_shield, 0.0, 1.0)
	var hu := clampf(ship.integrity / ship.max_integrity, 0.0, 1.0)
	draw_arc(c, r, deg_to_rad(140), deg_to_rad(220), 24, Color(Style.ION, 0.15), 4.0, true)
	if sh > 0.0:
		draw_arc(c, r, deg_to_rad(220 - 80 * sh), deg_to_rad(220), 24, Color(Style.ION, 0.85), 4.0, true)
	draw_arc(c, r, deg_to_rad(-40), deg_to_rad(40), 24, Color(Style.BONE, 0.15), 4.0, true)
	draw_arc(c, r, deg_to_rad(40 - 80 * hu), deg_to_rad(40), 24, Style.EMBER if hu < 0.35 else Color(Style.BONE, 0.85), 4.0, true)
	draw_string(Style.mono_bold, c + Vector2(-r - 10, 4), "S", HORIZONTAL_ALIGNMENT_RIGHT, -1, 11, Color(Style.ION, 0.7))
	draw_string(Style.mono_bold, c + Vector2(r + 8, 4), "H", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(Style.BONE, 0.7))
	var spd := "%d" % ship.velocity.length()
	draw_string(Style.mono_bold, c + Vector2(-40, r + 22), spd, HORIZONTAL_ALIGNMENT_CENTER, 80, 15, Style.BONE)
	draw_string(Style.mono, c + Vector2(-40, r + 36), "BOOST" if ship.boosting else "M/S", HORIZONTAL_ALIGNMENT_CENTER, 80, 10, Style.EMBER if ship.boosting else Style.MUTE)
	if _hit > 0.0:
		var k := 10.0 + (1.0 - _hit) * 6.0
		var col := Color(Style.BONE, _hit)
		for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(c + d * k, c + d * (k + 8.0), col, 2.5, true)
	if _kill > 0.0:
		var a := minf(1.0, _kill * 2.0)
		draw_string(Style.sans_bold, c + Vector2(-60, -48 - (1.0 - _kill) * 20.0), "KILL", HORIZONTAL_ALIGNMENT_CENTER, 120, 26, Color(Style.EMBER, a))

## Being hit darkens and warms the screen's edges.
func _edges(vp: Vector2) -> void:
	var low := 1.0 - clampf(ship.integrity / ship.max_integrity, 0.0, 1.0)
	var a := maxf(_flash * 0.35, low * 0.25 * (0.75 + 0.25 * sin(_clock * 6.0)))
	if a <= 0.01:
		return
	var c := Color(Style.EMBER, a)
	var e := Color(Style.EMBER, 0.0)
	var w := vp.x * 0.16
	var h := vp.y * 0.18
	draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(w, 0), Vector2(w, vp.y), Vector2(0, vp.y)]), PackedColorArray([c, e, e, c]))
	draw_polygon(PackedVector2Array([Vector2(vp.x - w, 0), Vector2(vp.x, 0), Vector2(vp.x, vp.y), Vector2(vp.x - w, vp.y)]), PackedColorArray([e, c, c, e]))
	draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(vp.x, 0), Vector2(vp.x, h), Vector2(0, h)]), PackedColorArray([c, c, e, e]))
	draw_polygon(PackedVector2Array([Vector2(0, vp.y - h), Vector2(vp.x, vp.y - h), Vector2(vp.x, vp.y), Vector2(0, vp.y)]), PackedColorArray([e, e, c, c]))

func _diamond(p: Vector2, d: float, c: Color, w: float) -> void:
	draw_polyline(PackedVector2Array([p + Vector2(0, -d), p + Vector2(d, 0), p + Vector2(0, d), p + Vector2(-d, 0), p + Vector2(0, -d)]), c, w, true)

func _brackets(p: Vector2, s: float, c: Color) -> void:
	var k := s * 0.4
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
	var p := vp / 2.0 + dir * minf(vp.x, vp.y) * 0.4
	var n := Vector2(-dir.y, dir.x)
	draw_colored_polygon(PackedVector2Array([p + dir * 14.0, p - dir * 6.0 + n * 9.0, p - dir * 6.0 - n * 9.0]), c)

func _screen(cam: Camera3D, world: Vector3) -> Vector2:
	if cam.is_position_behind(world):
		return Vector2(-9999, -9999)
	return cam.unproject_position(world)
