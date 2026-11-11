class_name WandererSite
extends Site
## The Engine, on the Wanderer: a domed hall inside a standing ring, its
## door a carved slab that sinks into the ice only while the comet is near
## Periapsis Zero (OPEN_FROM to OPEN_TO in loop time). A songline outside
## says so; another inside says what to do; the socket in the middle takes
## the Choir core, and that is the end (Reach.finish).

const OPEN_FROM := 1200.0   # 20:00
const OPEN_TO := 1275.0     # 21:15

var reach: Node
var engine: Node3D
var _door: Node3D
var _open := 0.0
var _socket: Usable
var _door_use: Usable
var _waiting := false
var _wait_from := 0
const WAIT_WARP := 45.0   # 17 minutes of the morning in about 23 seconds
var _told := ""   # what the arrival caption last said: "shut", "open", "late"
var socket_at: Transform3D

static func make(b: ReachBody) -> WandererSite:
	var w := WandererSite.new(b, "engine")
	w.name = "Wanderer"
	return w

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	engine = put("site-engine", Vector2.ZERO, Vector2(0, -20), true, 1.0, 0.4)
	_door = load("res://art/site-engine_door.glb").instantiate()
	Surfaces.apply(_door)
	engine.add_child(_door)
	_door.position = Vector3(0, 0, 7.5)
	Surfaces.collide(_door)
	songline("engine_door", Vector2(-4.4, -11.5), Vector2(-4.4, -24))
	songline_at("engine", engine.transform * Transform3D(Basis(), Vector3(0, 0, -6.1)), "site-songline_wall")
	lamp(engine, Vector3(0, 5.5, 0), Color(0.55, 0.8, 1.0), 1.6, 14.0)
	socket_at = engine.transform * Transform3D(Basis(), Vector3(0, 1.45, 0))
	_machine()
	_socket = Usable.sphere("", 0.7)
	_socket.reach = 3.6
	engine.add_child(_socket)
	_socket.position = Vector3(0, 1.3, 0)
	_socket.used.connect(_use_socket)
	# The slab itself answers when you look at it: shut, open, or shut for
	# the morning, and when. Without it the door looks like a wall.
	_door_use = Usable.box("", Vector3(4.4, 4.0, 1.2))
	_door_use.reach = 6.0
	engine.add_child(_door_use)
	_door_use.position = Vector3(0, 2.0, 8.4)
	_door_use.used.connect(_use_door)

## E at the sealed door, before 20:00: wait for it. The clock runs fast
## (as sleeping by a fire does) until the slab sinks; any key stops it.
## The first E only explains (a press meant to open the door must not throw
## seventeen minutes away); a second within a few seconds skips ahead.
var _asked := -100000
func _use_door(_by: Node) -> void:
	var t: float = reach.system.t
	if t < OPEN_FROM - 2.0 and not _waiting and Time.get_ticks_msec() - _asked > 8000:
		_asked = Time.get_ticks_msec()
		reach.hud.caption("Sealed until 20:00, when the Wanderer swings nearest the star (it is %s now). Explore and come back, or press E again to skip ahead: the clock races and it opens in about %d seconds (any key stops)." % [_mmss(t), _wait_secs(t)], 8.0)
		return
	if t < OPEN_FROM - 2.0 and not _waiting:
		_waiting = true
		_wait_from = Time.get_ticks_msec()
		reach.system.warp = WAIT_WARP
		Season.note("rest")
	else:
		reach.hud.caption(_door_words(), 7.0)

func _stop_wait(opened: bool) -> void:
	if not _waiting:
		return
	_waiting = false
	reach.system.warp = 1.0
	if reach.scope:
		reach.scope.resync()
	reach.hud.caption("20:00. The Wanderer swings close to the star, and the slab sinks into the ice. Walk inside." if opened else "You stop waiting. It is %s." % _mmss(reach.system.t), 6.0)

func _input(e: InputEvent) -> void:
	if _waiting and Time.get_ticks_msec() - _wait_from > 600 and ((e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed)):
		_stop_wait(false)

## Real seconds the wait at the door takes from loop time `t`.
static func _wait_secs(t: float) -> int:
	return maxi(1, int(ceil((OPEN_FROM - t) / WAIT_WARP)))

static func _mmss(t: float) -> String:
	return "%d:%02d" % [int(t) / 60, int(t) % 60]

## What the door says now, by the clock.
func _door_words() -> String:
	var t: float = reach.system.t
	var core := "" if reach.carrying_core else " Inside is the Engine's socket; it takes the core from the Aster's vault on Ashfall, and the Engine's song, gathered from every world."
	if t < OPEN_FROM:
		return "The Engine's door is sealed until 20:00, when the Wanderer swings nearest the star; it is %s now. You don't have to wait: press E twice at the door and the clock races, and it opens in about %d seconds (any key stops). Or explore and come back before 21:15.%s" % [_mmss(t), _wait_secs(t), core]
	if t <= OPEN_TO:
		return "The door is open until 21:15. Walk inside.%s" % core
	return "The door has shut for this morning (it is open 20:00 to 21:15). Come back next morning, before 21:15.%s" % core

## Open while the Wanderer is near its periapsis; the slab sinks and rises.
func _physics_process(dt: float) -> void:
	if not reach or not reach.system:
		return
	var t: float = reach.system.t
	var want := 1.0 if t >= OPEN_FROM and t <= OPEN_TO else 0.0
	# Never shut on someone inside: the slab waits until you are out.
	var ex: Node3D = reach.player
	if ex and ex.is_inside_tree() and ex.global_position.distance_to(engine.global_position) < 9.0:
		want = maxf(want, _open)
	if want != _open and absf(want - _open) > 0.001:
		if (_open == 0.0 or _open == 1.0):
			Sfx.play("door", -2.0, 0.55)
		_open = move_toward(_open, want, dt / 3.0)
		_door.position = Vector3(0, -4.2 * smoothstep(0.0, 1.0, _open), 7.5)
	_socket.prompt = "Give the Engine the core" if reach.carrying_core else "An empty socket"
	if _open < 0.5:
		if t >= OPEN_FROM:
			_door_use.prompt = "Sealed door: shut for this morning"
		elif Time.get_ticks_msec() - _asked < 8000:
			_door_use.prompt = "Press E again: skip ahead to 20:00 (about %d s)" % _wait_secs(t)
		else:
			_door_use.prompt = "Sealed until 20:00 (it is %s)" % _mmss(t)
	else:
		_door_use.prompt = ""
	if _waiting:
		reach.hud.caption("Waiting for the door   %s of 20:00\nany key stops" % _mmss(t), 0.5)
		if t >= OPEN_FROM + 1.0:
			_stop_wait(true)
		elif ex and ex.is_inside_tree() and ex.global_position.distance_to(engine.global_position) > 40.0:
			_stop_wait(false)
	_door_use.collision_layer = 8 if _open < 0.5 else 0
	# Arriving on foot near the door: say once what it is and when it opens.
	if ex and ex.is_inside_tree() and ex.global_position.distance_to(engine.global_position) < 30.0:
		var now := "shut" if t < OPEN_FROM else ("open" if t <= OPEN_TO else "late")
		if now != _told:
			_told = now
			reach.hud.caption(_door_words(), 8.0)
	elif ex and ex.is_inside_tree() and ex.global_position.distance_to(engine.global_position) > 60.0:
		_told = ""

## The Engine itself: ribs of light up the chamber's walls, two rings
## turning over the socket, a light that wakes when the door opens and
## blazes when the core is home.
var _rings: Array[Node3D] = []
var _glow: StandardMaterial3D
var _heart: OmniLight3D
func _machine() -> void:
	_glow = StandardMaterial3D.new()
	_glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_glow.albedo_color = Color(0.55, 0.85, 1.0)
	var ribs := 10
	for k in ribs:
		var a := TAU * k / ribs
		var rib := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.12, 4.2, 0.08)
		rib.mesh = bm
		rib.material_override = _glow
		rib.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		engine.add_child(rib)
		rib.position = Vector3(sin(a) * 5.6, 2.4, cos(a) * 5.6)
		rib.rotation.y = a
		# Not across the door (+Z).
		if absf(angle_difference(a, 0.0)) < 0.5:
			rib.visible = false
	for r in [2.2, 1.6]:
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = r - 0.07
		tm.outer_radius = r
		tm.rings = 48
		tm.ring_segments = 6
		ring.mesh = tm
		ring.material_override = _glow
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		engine.add_child(ring)
		ring.position = Vector3(0, 3.2 if r > 2.0 else 3.0, 0)
		_rings.append(ring)
	_heart = OmniLight3D.new()
	_heart.light_color = Color(0.55, 0.82, 1.0)
	_heart.omni_range = 9.0
	_heart.light_energy = 0.6
	_heart.shadow_enabled = false
	engine.add_child(_heart)
	_heart.position = Vector3(0, 2.6, 0)

func _process(dt: float) -> void:
	if _rings.is_empty():
		return
	var awake := 0.35 + 0.65 * _open + (1.5 if reach and reach.finished else 0.0)
	_rings[0].rotate_object_local(Vector3(1, 0, 0), dt * 0.4 * awake)
	_rings[0].rotate_y(dt * 0.25 * awake)
	_rings[1].rotate_object_local(Vector3(0, 0, 1), -dt * 0.55 * awake)
	var t := Time.get_ticks_msec() * 0.001
	_glow.albedo_color = Color(0.55, 0.85, 1.0) * (0.45 + 0.4 * awake + 0.12 * sin(t * 2.0))
	_heart.light_energy = 0.4 + 1.6 * awake + 0.2 * sin(t * 2.3)

func _use_socket(_by: Node) -> void:
	if reach.carrying_core:
		var ex := _by as Explorer
		if ex == null or reach.talking:
			return
		# The core alone does not wake it: the Engine has to be sung its
		# song, five parts from five worlds, nearest the Lantern first.
		var news := Lore.learn("wan_song")
		var missing := song_missing()
		if not missing.is_empty():
			reach.hud.caption("The socket takes the core, and the Engine only hums: it wants its song. You know %d of its five parts. Still to find: %s. (The ship's log, L, says more.)" % [5 - missing.size(), ", ".join(missing)], 9.0)
			if news:
				reach.hud.toast("SHIP LOG UPDATED")
			return
		ex.enabled = false
		reach.talking = true
		Talk.on_pick = _sing
		var sing := Talk.open(reach, "engine_song", null, reach.hud)
		await sing.finished
		Talk.on_pick = Callable()
		if sing.outcome != "sung":
			reach.talking = false
			ex.enabled = true
			if sing.outcome == "broken":
				# A wrong song costs time: the door will not wait for long.
				reach.system.t = minf(reach.system.t + 120.0, ReachSystem.LOOP - 1.0)
				Sfx.play("alarm", -8.0, 0.7)
				reach.hud.caption("The song breaks and the Engine goes dark. The clock leaps two minutes on. Remember the order: nearest the Lantern first.", 6.0)
			return
		# Rook has one more word first: the choice (Lore.TALK.engine_choice).
		var t := Talk.open(reach, "engine_choice", null, reach.hud)
		await t.finished
		reach.talking = false
		ex.enabled = true
		if t.outcome != "":
			reach.finish(self, t.outcome)
	else:
		reach.hud.caption("A socket in the Engine's heart, a hand's width across. Empty: it takes the core from the Aster's vault on Ashfall.", 4.0)

## Each word of the song is a note, falling from the Phantom's to the
## Nadir's (B, A, F sharp, E, D: the tune's own scale, on Sfx "sing"), so
## the right order is a melody coming home and a wrong one sounds wrong.
const NOTES := {"Glass": 9, "Ember": 7, "Iron": 4, "Rain": 2, "Deep": 0}
static var sung: Array = []

func _sing(said: String) -> void:
	for word: String in NOTES:
		if said.begins_with(word):
			sung.append(word)
			Sfx.play("sing", -3.0, pow(2.0, float(NOTES[word]) / 12.0))

## The worlds whose part of the Engine's song is not yet known.
const SONG := [["song_phantom", "the Phantom"], ["song_hearth", "Hearth"], ["song_ashfall", "Ashfall"], ["song_verdance", "Verdance"], ["song_nadir", "the Nadir"]]
static func song_missing() -> Array:
	var out := []
	for s in SONG:
		if not Lore.known(s[0]):
			out.append(s[1])
	return out

func reset_loop() -> void:
	if _waiting:
		_waiting = false
		reach.system.warp = 1.0
	_open = 0.0
	_told = ""
	_door.position = Vector3(0, 0, 7.5)
