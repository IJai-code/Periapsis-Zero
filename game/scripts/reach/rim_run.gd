class_name RimRun
extends Node3D
## The Rim Run: Isa's ring course round the crater, for the Kestrel, against
## the clock. Twelve big rings weave between the crater's walls, the tower,
## the observatory and the pond, high and low; fly through the first (by
## the tower) and the clock starts; through all of them in order and back
## through the first to finish. The next ring burns brightest and the HUD
## points to it; the clock and the split for each ring are shown top middle.
## Bronze, silver and gold, and the best time kept across every loop.
## Lives under the village (body space); the ship is reach.ship.

## [azimuth deg, metres from the crater's middle, height over the ground].
const COURSE := [
	[35.0, 38.0, 26.0], [62.0, 72.0, 16.0], [85.0, 58.0, 10.0], [100.0, 74.0, 12.0],
	[140.0, 50.0, 22.0], [175.0, 78.0, 38.0], [205.0, 90.0, 52.0], [240.0, 60.0, 30.0],
	[275.0, 45.0, 34.0], [300.0, 78.0, 20.0], [330.0, 55.0, 14.0], [0.0, 22.0, 30.0],
]
const RADIUS := 12.0
const GOLD := 30.0
const SILVER := 42.0
const BRONZE := 60.0
## Longest between two rings before the run is called off.
const STALL := 25.0

var reach: Node
var body: ReachBody
var _gates: Array[Node3D] = []
var _mats: Array[StandardMaterial3D] = []
var _beam: MeshInstance3D
var _running := false
var _next := 0
var _t := 0.0
var _since := 0.0
var _splits: PackedFloat32Array = []
var _pulse := 0.0
var _was_inside := false

static func make(b: ReachBody) -> RimRun:
	var r := RimRun.new()
	r.body = b
	r.name = "RimRun"
	return r

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	var pts: Array[Vector3] = []
	for g: Array in COURSE:
		var d := Worlds.crater_dir(float(g[0]), float(g[1]))
		pts.append(d * (body.radius + Worlds.height(body.key, d, body.radius) + float(g[2])))
	for i in pts.size():
		var at := pts[i]
		var nxt := pts[(i + 1) % pts.size()]
		var prv := pts[(i - 1 + pts.size()) % pts.size()]
		var along := (nxt - prv).normalized()
		var up := at.normalized()
		var gate := Node3D.new()
		add_child(gate)
		# The ring stands upright (square to the ground's up), its hole along
		# the way the course runs.
		var flat := (along - up * along.dot(up)).normalized()
		gate.transform = Transform3D(Basis(flat.cross(up).normalized(), up, -flat).orthonormalized(), at)
		var mi := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = RADIUS - 0.9
		tm.outer_radius = RADIUS
		tm.rings = 48
		tm.ring_segments = 8
		mi.mesh = tm
		mi.rotation = Vector3(PI / 2.0, 0, 0)
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(1.0, 0.7, 0.3)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		gate.add_child(mi)
		# Its number, on a little plate under it.
		var label := Label3D.new()
		label.text = "START" if i == 0 else str(i)
		label.font = ReachStyle.serif_bold
		label.font_size = 96
		label.pixel_size = 0.03
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.modulate = Color(1.0, 0.85, 0.6)
		label.outline_size = 12
		label.outline_modulate = Color(0.2, 0.1, 0.05)
		label.position = Vector3(0, -RADIUS - 2.5, 0)
		gate.add_child(label)
		_gates.append(gate)
		_mats.append(m)
	# A pillar of light over the next ring, to find it from anywhere.
	_beam = MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.7
	cm.bottom_radius = 0.7
	cm.height = 120.0
	_beam.mesh = cm
	var bm := StandardMaterial3D.new()
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	bm.albedo_color = Color(1.0, 0.7, 0.3, 0.09)
	_beam.material_override = bm
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_beam)
	_paint()

func _paint() -> void:
	for i in _mats.size():
		var lit := (i == _next) if _running else (i == 0)
		var done := _running and i < _next and _next > 0
		_mats[i].albedo_color = Color(0.45, 1.0, 0.55, 0.9) if done else (Color(1.0, 0.72, 0.3) if lit else Color(0.55, 0.38, 0.22))
		_gates[i].visible = true
	var target := _gates[_next if _running else 0]
	_beam.transform = Transform3D(target.transform.basis.orthonormalized(), target.position + target.transform.basis.y.normalized() * (RADIUS + 60.0))

func _process(dt: float) -> void:
	if reach == null:
		return
	_pulse += dt
	_share_t = maxf(_share_t - dt, 0.0)
	var ship: ReachShip = reach.ship
	var flying: bool = ship != null and ship.piloted and not ship.landed and reach.system.ref == body.key
	var i := _next if _running else 0
	_mats[i].albedo_color = Color(1.0, 0.72, 0.3).lerp(Color(1.0, 0.95, 0.8), 0.5 + 0.5 * sin(_pulse * 6.0))
	if not flying:
		if _running:
			_abandon("Run abandoned: she set down.")
		return
	var p := to_local(ship.global_position)
	var gate := _gates[i]
	var local := gate.transform.affine_inverse() * p
	# Through the ring: inside its circle, crossing its plane.
	var inside := Vector2(local.x, local.y).length() < RADIUS + 1.5 and absf(local.z) < 6.0
	if inside and not _was_inside:
		_through(i)
	_was_inside = inside
	if _running:
		_t += dt
		_since += dt
		if _since > STALL:
			_abandon("Run abandoned: too long between rings.")
			return
		var line := "%s   ring %d of %d" % [_clock(_t), mini(_next, _gates.size()), _gates.size()]
		if reach.hud:
			reach.hud.race(line)
		reach.race_at = {"at": _gates[_next].global_position, "label": "Ring %d" % _next if _next > 0 else "Finish"}

func _through(i: int) -> void:
	if not _running:
		if i != 0:
			return
		_running = true
		_t = 0.0
		_since = 0.0
		_splits.clear()
		_next = 1
		Sfx.play("gate", -4.0, 0.9)
		if reach.hud:
			reach.hud.caption("The Rim Run! Through every ring, in order. Gold under %d s." % int(GOLD), 3.0)
		if Lore.learn("hearth_rimrun") and reach.hud:
			reach.hud.toast("SHIP LOG UPDATED")
		_paint()
		return
	if i != _next:
		return
	_since = 0.0
	_splits.append(_t)
	Sfx.play("gate", -5.0, 1.0 + 0.04 * i)
	if i == 0:
		_finish()
		return
	_next = (_next + 1) % _gates.size()
	_paint()

func _finish() -> void:
	_running = false
	reach.race_at = {}
	var best := float(Flow.progress("rimrun_best", 0.0))
	var record := best <= 0.0 or _t < best
	if record:
		Flow.set_progress("rimrun_best", _t)
	var medal := "Gold" if _t < GOLD else ("Silver" if _t < SILVER else ("Bronze" if _t < BRONZE else ""))
	Sfx.play("fanfare", -4.0, 1.0 if medal != "" else 0.8)
	_share = "I flew the Rim Run in %s%s in Periapsis Zero. Beat it, free in your browser: https://periapsiszero.dev/play/" % [_clock(_t), (" (" + medal + ")") if medal != "" else ""]
	_share_t = 15.0
	if reach.hud:
		reach.hud.race("")
		var words := "Rim Run: %s.%s %s  Press Y to copy a challenge for a friend." % [_clock(_t), (" " + medal + "!") if medal != "" else "", "A new best." if record else "Best %s." % _clock(best)]
		reach.hud.caption(words, 8.0)
		if medal == "Gold":
			reach.hud.flash(Color(1.0, 0.85, 0.4), 0.3)
	_next = 0
	_paint()

## Y, for a while after a finish: the time, as a line to paste anywhere
## (the clipboard, from the key press itself, which a browser allows).
var _share := ""
var _share_t := 0.0

func _unhandled_input(e: InputEvent) -> void:
	if _share_t <= 0.0 or not (e is InputEventKey) or not e.pressed or e.echo or (e as InputEventKey).keycode != KEY_Y:
		return
	DisplayServer.clipboard_set(_share)
	_share_t = 0.0
	Sfx.play("click", -6.0)
	if reach and reach.hud:
		reach.hud.caption("Copied. Paste it to a friend.", 2.5)
	get_viewport().set_input_as_handled()

func _abandon(why: String) -> void:
	_running = false
	_next = 0
	reach.race_at = {}
	if reach.hud:
		reach.hud.race("")
		reach.hud.caption(why, 2.5)
	_paint()

static func _clock(t: float) -> String:
	return "%d:%04.1f" % [int(t) / 60, fmod(t, 60.0)]

## For checks: the course's rings, in body space.
func ring_points() -> Array[Vector3]:
	var out: Array[Vector3] = []
	for g in _gates:
		out.append(g.position)
	return out
