class_name FlightHud
extends Control
## The flight overlay, after the instruments of a real fleet: the reticle
## where the guns will go; brackets on everything in space; the overview, a
## table of every contact by range; the locked target's panel with its
## shield, armour and structure as three rings; the ship's own status at the
## bottom (the same three rings, the capacitor as a ring of cells, speed);
## a combat log; missile warnings and where the last hit came from.

var ship: PlayerShip
var missiles: Missiles
var enemies: Array = []     # kept for older scenes; the overview finds hulls itself
var goal: Node3D = null
var goal_label := ""
var protect: Hull = null
var _flash := 0.0
var _hit := 0.0
var _kill := 0.0
var _clock := 0.0
var _log: Array = []        # [text, colour, age]
var _dmg_dir := Vector2.ZERO
var _dmg_t := 0.0
var _warned := 0.0
var _agg := {}              # outgoing hits gathered per target: {id: [name, total, count, layer, t]}

const LAYER_COL := {"shield": Color("#2fd3ff"), "armor": Color("#f4e8cf"), "hull": Color("#ff6b2c")}

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

## Put a thing on the overview (stations, beacons, wrecks); ships are there
## already. `tag` is hostile, friendly, neutral, structure or objective.
static func mark(node: Node3D, name: String, type: String, tag := "structure") -> void:
	node.set_meta("ov_name", name)
	node.set_meta("ov_type", type)
	node.set_meta("ov_tag", tag)
	node.add_to_group("overview")

static func unmark(node: Node3D) -> void:
	node.remove_from_group("overview")

func flash() -> void:
	_flash = 1.0

func hit_marker() -> void:
	_hit = 1.0

func kill() -> void:
	_kill = 1.0
	_hit = 1.0

## A line in the combat log, bottom left.
func log_line(text: String, color := Style.BONE) -> void:
	_log.append([text, color, 0.0])
	if _log.size() > 6:
		_log.pop_front()

## The player's shot or missile landed: gathered into one log line a target
## every half second, the way a fleet's log reads.
func outgoing(target: Node3D, amount: float, layer: String, kind := "gun") -> void:
	_hit = 1.0
	if kind == "missile":
		log_line("%d  to  %s  ·  missile  ·  %s" % [int(amount), _name(target), _quality(amount, 24.0)], LAYER_COL.get(layer, Style.BONE))
		return
	var id := target.get_instance_id()
	if not _agg.has(id):
		_agg[id] = [_name(target), 0.0, 0, layer, 0.0]
	_agg[id][1] += amount
	_agg[id][2] += 1
	_agg[id][3] = layer

## The player was hit, from `from` (a world point) if known.
func incoming(source: String, amount: float, layer: String, from := Vector3.INF) -> void:
	_flash = 1.0
	if from != Vector3.INF and ship:
		var local := ship.camera.global_basis.inverse() * (from - ship.global_position)
		_dmg_dir = Vector2(local.x, -local.y).normalized() if Vector2(local.x, -local.y).length() > 0.01 else Vector2(0, 1)
		_dmg_t = 1.0
	var key := "in:" + source
	if not _agg.has(key):
		_agg[key] = [source, 0.0, 0, layer, 0.0]
	_agg[key][1] += amount
	_agg[key][2] += 1
	_agg[key][3] = layer

static func _quality(amount: float, typical: float) -> String:
	var r := amount / typical
	if r < 0.8:
		return "Grazes"
	if r < 1.0:
		return "Hits"
	if r < 1.2:
		return "Penetrates"
	if r < 1.35:
		return "Smashes"
	return "Wrecks"

static func _name(n: Node) -> String:
	if not is_instance_valid(n):
		return "?"
	if n.has_meta("ov_name"):
		return n.get_meta("ov_name")
	var d = n.get("display_name")
	return d if d else "contact"

func _process(dt: float) -> void:
	_clock += dt
	_flash = maxf(0.0, _flash - dt * 2.2)
	_hit = maxf(0.0, _hit - dt * 6.0)
	_kill = maxf(0.0, _kill - dt * 0.9)
	_dmg_t = maxf(0.0, _dmg_t - dt * 0.8)
	for l in _log:
		l[2] += dt
	while not _log.is_empty() and _log[0][2] > 7.0:
		_log.pop_front()
	for id in _agg.keys():
		var a: Array = _agg[id]
		a[4] += dt
		if a[4] > 0.6:
			if id is String:
				log_line("%d  from  %s  ·  %s" % [int(a[1]), a[0], "%d hits" % a[2] if a[2] > 1 else _quality(a[1], 4.0)], Style.EMBER)
			else:
				log_line("%d  to  %s  ·  %s  ·  %s" % [int(a[1]), a[0], a[3], ("%d hits" % a[2]) if a[2] > 1 else _quality(a[1], 6.0)], LAYER_COL.get(a[3], Style.BONE))
			_agg.erase(id)
	# Missile warning tone.
	if ship and missiles and not missiles.incoming(ship).is_empty():
		_warned -= dt
		if _warned <= 0.0:
			_warned = 0.9
			Sfx.play("warn", -8.0)
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
	var contacts := _contacts()
	for c in contacts:
		_bracket(cam, vp, c)
	if aim.x > -1:
		_reticle(aim)
	_lock_marks(cam)
	_goal(cam, vp)
	_overview(vp, contacts)
	_target_panel(vp)
	_status(vp)
	_combat_log(vp)
	_missile_warning(vp)
	if protect and is_instance_valid(protect) and protect.alive:
		var w := 360.0
		var at := Vector2((vp.x - w) / 2.0, 46)
		var frac := protect.integrity / protect.max_integrity
		draw_string(Style.mono_bold, at + Vector2(0, -10), "%s · STRUCTURE %d%%" % [protect.display_name.to_upper(), int(frac * 100.0)], HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Style.MUTE)
		draw_rect(Rect2(at, Vector2(w, 5)), Color(Style.BONE, 0.14))
		draw_rect(Rect2(at, Vector2(w * frac, 5)), Style.EMBER if frac < 0.5 else Style.BONE)

# --- Contacts ---------------------------------------------------------------

## Everything on the overview: [node, distance, name, type, tag].
func _contacts() -> Array:
	var out := []
	for n in get_tree().get_nodes_in_group("overview"):
		if n == ship or not (n is Node3D) or not n.is_inside_tree():
			continue
		if n is Hull and not n.alive:
			continue
		var tag := "structure"
		var name := ""
		var type := ""
		if n.has_meta("ov_tag"):
			tag = n.get_meta("ov_tag")
			name = n.get_meta("ov_name")
			type = n.get_meta("ov_type")
		elif n is Hull:
			tag = "friendly" if n.team == "player" else ("neutral" if n.team == "neutral" else "hostile")
			name = n.display_name
			type = n.ship_class
		out.append([n, ship.global_position.distance_to(n.global_position), name, type, tag])
	out.sort_custom(func(a, b): return a[1] < b[1])
	return out

static func _tag_col(tag: String) -> Color:
	match tag:
		"hostile": return Style.EMBER
		"friendly": return Style.ION
		"objective": return Color("#ffd27a")
		"neutral": return Color(Style.BONE, 0.75)
	return Color(Style.BONE, 0.55)

## A thing far beyond the scene (a warp destination) carries its true range.
static func _range_of(n: Node, d: float) -> String:
	return n.get_meta("ov_range") if is_instance_valid(n) and n.has_meta("ov_range") else _range(d)

static func _range(d: float) -> String:
	return ("%d m" % int(d)) if d < 10_000.0 else ("%.1f km" % (d / 1000.0) if d < 100_000.0 else "%d km" % int(d / 1000.0))

func _bracket(cam: Camera3D, vp: Vector2, c: Array) -> void:
	var n: Node3D = c[0]
	var p := _screen(cam, n.global_position)
	if p.x < 0 or not Rect2(Vector2.ZERO, vp).has_point(p):
		if c[4] == "hostile" and c[1] < 2600.0:
			_edge_arrow(cam, n.global_position, Style.EMBER)
		return
	var col := _tag_col(c[4])
	var s := clampf(1600.0 / maxf(c[1], 1.0), 9.0, 34.0)
	if c[4] == "hostile":
		_brackets(p, s, Color(col, 0.9), 1.5)
	elif c[4] == "structure" or c[4] == "objective":
		_diamond(p, 6.0, Color(col, 0.8), 1.5)
	else:
		draw_arc(p, 6.0, 0, TAU, 12, Color(col, 0.8), 1.5, true)
	if n == ship.target or n == ship.locking or (goal and is_instance_valid(goal) and goal.global_position.distance_to(n.global_position) < 2.0):
		return
	if ship.target and is_instance_valid(ship.target) and _screen(cam, ship.target.global_position).distance_to(p) < 90.0:
		return
	if c[4] == "hostile" and c[1] < 1800.0 or c[4] in ["objective", "structure"]:
		var label := "%s  %s" % [c[2].to_upper(), _range_of(n, c[1])]
		# Near the right edge the label goes left of the bracket, clear of the panels.
		if p.x > vp.x - 420.0:
			draw_string(Style.mono, p + Vector2(-s - 306, 4), label, HORIZONTAL_ALIGNMENT_RIGHT, 300, 11, Color(col, 0.85))
		else:
			draw_string(Style.mono, p + Vector2(s + 6, 4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(col, 0.85))

func _lock_marks(cam: Camera3D) -> void:
	if ship.locking and is_instance_valid(ship.locking):
		var p := _screen(cam, ship.locking.global_position)
		if p.x > -1:
			var k := clampf(ship.lock_t / PlayerShip.LOCK_TIME, 0.0, 1.0)
			var r := lerpf(70.0, 26.0, k)
			for i in 4:
				var a := _clock * 3.0 + i * TAU / 4.0
				draw_arc(p, r, a, a + 0.9, 8, Color(Style.EMBER, 0.9), 2.0, true)
			draw_string(Style.mono_bold, p + Vector2(-60, -r - 10), "LOCKING", HORIZONTAL_ALIGNMENT_CENTER, 120, 12, Style.EMBER)
	var t := ship.target
	if not t or not is_instance_valid(t):
		return
	var tp := _screen(cam, t.global_position)
	if tp.x > -1:
		var s := clampf(1800.0 / maxf(ship.global_position.distance_to(t.global_position), 1.0), 18.0, 50.0)
		_brackets(tp, s, Style.EMBER, 2.5)
		draw_rect(Rect2(tp - Vector2(s, s) - Vector2(4, 4), Vector2(8, 8)), Style.EMBER)
		draw_string(Style.mono_bold, tp + Vector2(s + 8, -4), t.display_name.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Style.EMBER)
		draw_string(Style.mono, tp + Vector2(s + 8, 12), _range(ship.global_position.distance_to(t.global_position)), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(Style.BONE, 0.85))
		# The lead: where to put the reticle.
		var lp := _screen(cam, ship.lead_point(t, ship.global_position))
		if lp.x > -1:
			draw_line(lp, tp, Color(Style.EMBER, 0.35), 1.0, true)
			_diamond(lp, 11.0, Style.EMBER, 2.0)
			draw_circle(lp, 2.0, Style.EMBER)
	else:
		_edge_arrow(cam, t.global_position, Style.EMBER)

func _goal(cam: Camera3D, vp: Vector2) -> void:
	if not goal or not is_instance_valid(goal):
		return
	var gp := _screen(cam, goal.global_position)
	var dist := ship.global_position.distance_to(goal.global_position)
	if gp.x > -1 and Rect2(Vector2.ZERO, vp).has_point(gp):
		_diamond(gp, 13.0, Style.ION, 2.5)
		draw_string(Style.mono_bold, gp + Vector2(20, 5), "%s  %s" % [goal_label, _range(dist)], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Style.ION)
	else:
		_edge_arrow(cam, goal.global_position, Style.ION)

# --- Panels -----------------------------------------------------------------

func _panel(r: Rect2) -> void:
	draw_rect(r, Color(0.03, 0.02, 0.06, 0.6))
	draw_rect(Rect2(r.position, Vector2(r.size.x, 2)), Color(Style.BONE, 0.25))

## The overview: every contact by range, nearest first.
func _overview(vp: Vector2, contacts: Array) -> void:
	var rows := mini(contacts.size(), 7)
	if rows == 0:
		return
	var w := 330.0
	var at := Vector2(vp.x - w - 30.0, vp.y * 0.5 - 20.0)
	_panel(Rect2(at, Vector2(w, 30 + rows * 21)))
	draw_string(Style.mono_bold, at + Vector2(10, 18), "OVERVIEW", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(Style.BONE, 0.7))
	draw_string(Style.mono, at + Vector2(10, 18), "%d CONTACTS" % contacts.size(), HORIZONTAL_ALIGNMENT_RIGHT, w - 20, 10, Color(Style.BONE, 0.45))
	for i in rows:
		var c: Array = contacts[i]
		var y := at.y + 40 + i * 21
		var col := _tag_col(c[4])
		if c[0] == ship.target:
			draw_rect(Rect2(Vector2(at.x + 2, y - 14), Vector2(w - 4, 19)), Color(Style.EMBER, 0.18))
		var icon := Vector2(at.x + 16, y - 4)
		if c[4] == "hostile":
			draw_colored_polygon(PackedVector2Array([icon + Vector2(0, -5), icon + Vector2(5, 4), icon + Vector2(-5, 4)]), col)
		elif c[4] in ["structure", "objective"]:
			_diamond(icon, 5.0, col, 1.5)
		else:
			draw_circle(icon, 4.0, col)
		draw_string(Style.mono_bold, Vector2(at.x + 30, y), _range_of(c[0], c[1]), HORIZONTAL_ALIGNMENT_RIGHT, 64, 11, Color(Style.BONE, 0.9))
		draw_string(Style.sans_bold, Vector2(at.x + 104, y), c[2], HORIZONTAL_ALIGNMENT_LEFT, 120, 12, col)
		draw_string(Style.mono, Vector2(at.x + 228, y), c[3], HORIZONTAL_ALIGNMENT_LEFT, w - 236, 10, Color(Style.BONE, 0.5))

## The locked target: name, class, range, closing speed, its three rings.
func _target_panel(vp: Vector2) -> void:
	var t := ship.target
	if not t or not is_instance_valid(t) or not t.alive:
		return
	var w := 330.0
	var at := Vector2(vp.x - w - 30.0, vp.y * 0.5 - 168.0)
	_panel(Rect2(at, Vector2(w, 132)))
	var c := at + Vector2(62, 72)
	_rings(c, 46.0, t.fractions(), 6.0)
	draw_string(Style.mono_bold, at + Vector2(124, 24), "TARGET LOCKED", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Style.EMBER)
	draw_string(Style.sans_bold, at + Vector2(124, 48), t.display_name, HORIZONTAL_ALIGNMENT_LEFT, w - 132, 18, Style.BONE)
	draw_string(Style.mono, at + Vector2(124, 66), t.ship_class.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(Style.BONE, 0.55))
	var d := ship.global_position.distance_to(t.global_position)
	var closing := -(t.velocity - ship.velocity).dot((t.global_position - ship.global_position).normalized())
	draw_string(Style.mono_bold, at + Vector2(124, 92), _range(d), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Style.BONE)
	draw_string(Style.mono, at + Vector2(124, 112), "%+d m/s closing" % int(closing), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(Style.BONE, 0.6))
	var f := t.fractions()
	draw_string(Style.mono, at + Vector2(232, 92), "S %d%%" % int(f.x * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, LAYER_COL.shield)
	draw_string(Style.mono, at + Vector2(232, 106), "A %d%%" % int(f.y * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, LAYER_COL.armor)
	draw_string(Style.mono, at + Vector2(232, 120), "H %d%%" % int(f.z * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, LAYER_COL.hull)

## Three concentric arcs over the top: shield outside, armour, structure inside.
func _rings(c: Vector2, r: float, f: Vector3, w: float) -> void:
	var from := deg_to_rad(160.0)
	var span := deg_to_rad(220.0)
	var k := 0
	for layer in [["shield", f.x], ["armor", f.y], ["hull", f.z]]:
		var rr := r - k * (w + 3.0)
		var col: Color = LAYER_COL[layer[0]]
		draw_arc(c, rr, from, from + span, 40, Color(col, 0.14), w, true)
		if layer[1] > 0.005:
			draw_arc(c, rr, from, from + span * clampf(layer[1], 0.0, 1.0), 40, col, w, true)
		k += 1

## The ship's own status, bottom centre.
func _status(vp: Vector2) -> void:
	var c := Vector2(vp.x / 2.0, vp.y - 96.0)
	draw_circle(c, 92.0, Color(0.03, 0.02, 0.06, 0.45))
	_rings(c, 84.0, ship.fractions(), 7.0)
	# The capacitor: twenty cells round the inside, lit by charge.
	var cells := 20
	var lit := int(round(ship.capacitor / ship.max_capacitor * cells))
	for i in cells:
		var a := deg_to_rad(160.0) + deg_to_rad(220.0) * (i + 0.5) / cells
		var dir := Vector2(cos(a), sin(a))
		var on := i < lit
		var col := Color(Style.BONE, 0.85) if on else Color(Style.BONE, 0.12)
		if on and lit <= 4:
			col = Color(Style.EMBER, 0.6 + 0.4 * sin(_clock * 10.0))
		draw_line(c + dir * 44.0, c + dir * 54.0, col, 4.0, true)
	var spd := ship.velocity.length()
	draw_string(Style.mono_bold, c + Vector2(-60, 8), "%d" % int(spd), HORIZONTAL_ALIGNMENT_CENTER, 120, 26, Style.BONE)
	draw_string(Style.mono, c + Vector2(-60, 26), "BOOST" if ship.boosting else "M/S", HORIZONTAL_ALIGNMENT_CENTER, 120, 11, Style.EMBER if ship.boosting else Style.MUTE)
	draw_string(Style.mono, c + Vector2(-110, 60), "CAP %d%%" % int(ship.capacitor / ship.max_capacitor * 100.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(Style.BONE, 0.6))
	var mtxt := "MSL %d" % ship.missile_count
	draw_string(Style.mono, c + Vector2(110, 60), mtxt, HORIZONTAL_ALIGNMENT_RIGHT, -1, 10, Color(Style.ION, 0.8) if ship.missile_count > 0 else Color(Style.BONE, 0.3))
	if not ship.weapons:
		draw_string(Style.mono_bold, c + Vector2(-80, -100), "WEAPONS HOLD", HORIZONTAL_ALIGNMENT_CENTER, 160, 12, Style.MUTE)
	elif ship.capacitor < PlayerShip.GUN_COST * 3.0:
		draw_string(Style.mono_bold, c + Vector2(-90, -100), "CAPACITOR LOW", HORIZONTAL_ALIGNMENT_CENTER, 180, 12, Style.EMBER)
	var f := ship.fractions()
	if f.z < 0.3 and fmod(_clock, 0.8) < 0.5:
		draw_string(Style.mono_bold, c + Vector2(-90, -118), "STRUCTURE CRITICAL", HORIZONTAL_ALIGNMENT_CENTER, 180, 14, Style.EMBER)

func _combat_log(vp: Vector2) -> void:
	var y := vp.y - 250.0
	for i in _log.size():
		var l: Array = _log[_log.size() - 1 - i]
		var a := clampf(1.0 - (l[2] - 5.0) / 2.0, 0.0, 1.0) * (1.0 - i * 0.12)
		draw_string_outline(Style.mono_bold, Vector2(40, y - i * 20), l[0], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, 5, Color(0, 0, 0, 0.75 * a))
		draw_string(Style.mono_bold, Vector2(40, y - i * 20), l[0], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(l[1], a))

func _missile_warning(vp: Vector2) -> void:
	if not missiles:
		return
	var inc := missiles.incoming(ship)
	if inc.is_empty():
		return
	var d := ship.global_position.distance_to((inc[0] as Node3D).global_position)
	if fmod(_clock, 0.5) < 0.32:
		var t := "MISSILE  %s" % _range(d)
		draw_string_outline(Style.sans_bold, Vector2(vp.x / 2.0 - 200, vp.y * 0.24), t, HORIZONTAL_ALIGNMENT_CENTER, 400, 30, 8, Color(0, 0, 0, 0.7))
		draw_string(Style.sans_bold, Vector2(vp.x / 2.0 - 200, vp.y * 0.24), t, HORIZONTAL_ALIGNMENT_CENTER, 400, 30, Style.EMBER)
	draw_string(Style.mono_bold, Vector2(vp.x / 2.0 - 200, vp.y * 0.24 + 26), "DOUBLE-TAP A OR D TO BREAK ITS LOCK", HORIZONTAL_ALIGNMENT_CENTER, 400, 12, Style.BONE)
	_edge_arrow(ship.camera, (inc[0] as Node3D).global_position, Style.EMBER)

## The reticle: a broken ring and the hit and kill confirmations; an arc on
## the side the last hit came from.
func _reticle(c: Vector2) -> void:
	var ion := Color(Style.ION, 0.9)
	for a in [20, 110, 200, 290]:
		draw_arc(c, 18.0, deg_to_rad(a), deg_to_rad(a + 50), 10, ion, 2.0, true)
	draw_circle(c, 1.8, ion)
	if _dmg_t > 0.0:
		var ang := _dmg_dir.angle()
		draw_arc(c, 120.0, ang - 0.35, ang + 0.35, 16, Color(Style.EMBER, _dmg_t), 6.0, true)
	if _hit > 0.0:
		var k := 10.0 + (1.0 - _hit) * 6.0
		var col := Color(Style.BONE, _hit)
		for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(c + d * k, c + d * (k + 8.0), col, 2.5, true)
	if _kill > 0.0:
		var a := minf(1.0, _kill * 2.0)
		draw_string(Style.sans_bold, c + Vector2(-80, -48 - (1.0 - _kill) * 20.0), "DESTROYED", HORIZONTAL_ALIGNMENT_CENTER, 160, 22, Color(Style.EMBER, a))

## Being hit darkens and warms the screen's edges.
func _edges(vp: Vector2) -> void:
	var low := 1.0 - clampf(ship.integrity / ship.max_integrity, 0.0, 1.0)
	var a := maxf(_flash * 0.3, low * 0.25 * (0.75 + 0.25 * sin(_clock * 6.0)))
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

func _brackets(p: Vector2, s: float, c: Color, w := 2.0) -> void:
	var k := s * 0.4
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			var corner := p + Vector2(sx * s, sy * s)
			draw_line(corner, corner - Vector2(sx * k, 0), c, w, true)
			draw_line(corner, corner - Vector2(0, sy * k), c, w, true)

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
