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
		# Rook has one more word first: the choice (Lore.TALK.engine_choice).
		var ex := _by as Explorer
		if ex == null or reach.talking:
			return
		ex.enabled = false
		reach.talking = true
		var t := Talk.open(reach, "engine_choice", null, reach.hud)
		await t.finished
		reach.talking = false
		ex.enabled = true
		if t.outcome != "":
			reach.finish(self, t.outcome)
	else:
		reach.hud.caption("A socket in the Engine's heart, a hand's width across. Empty.", 3.0)

func reset_loop() -> void:
	_open = 0.0
	_door.position = Vector3(0, 0, 7.5)
