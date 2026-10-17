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
	if want != _open and absf(want - _open) > 0.001:
		if (_open == 0.0 or _open == 1.0):
			Sfx.play("door", -2.0, 0.55)
		_open = move_toward(_open, want, dt / 3.0)
		_door.position = Vector3(0, -4.2 * smoothstep(0.0, 1.0, _open), 7.5)
	_socket.prompt = "Give the Engine the core" if reach.carrying_core else "An empty socket"

func _use_socket(_by: Node) -> void:
	if reach.carrying_core:
		reach.finish(self)
	else:
		reach.hud.caption("A socket in the Engine's heart, a hand's width across. Empty.", 3.0)

func reset_loop() -> void:
	_open = 0.0
	_door.position = Vector3(0, 0, 7.5)
