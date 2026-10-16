class_name Companion
extends Node3D
## Someone walking with the player: keeps a pace or two behind on the
## navigation mesh, hurries to catch up, stops when the player stops.

var who := "renn"
var leader: Node3D
var gap := 1.6
var person: Person
var _path := PackedVector3Array()
var _repath := 0.0

static func make(name: String, follow: Node3D) -> Companion:
	var c := Companion.new()
	c.who = name
	c.leader = follow
	return c

func _ready() -> void:
	add_to_group("walker")
	person = Person.make(who)
	person.solid = false
	add_child(person)

func _physics_process(dt: float) -> void:
	if not is_instance_valid(leader):
		return
	var to := leader.global_position - global_position
	to.y = 0.0
	var far := to.length()
	_repath -= dt
	if _repath <= 0.0:
		_repath = 0.4
		var goal := leader.global_position - to.normalized() * gap if far > 0.01 else global_position
		_path = NavigationServer3D.map_get_path(get_world_3d().navigation_map, global_position, goal, true)
	var speed := 0.0
	if far > gap + 0.4 and _path.size() > 1:
		var next := _path[1]
		var d := next - global_position
		d.y = 0.0
		if d.length() < 0.2 and _path.size() > 2:
			_path.remove_at(0)
			next = _path[1]
			d = next - global_position
			d.y = 0.0
		speed = clampf(far - gap, 1.4, 4.4) if far < 8.0 else 4.4
		var step := d.normalized() * minf(d.length(), speed * dt)
		global_position += step
		global_position.y = next.y if absf(next.y - global_position.y) < 0.4 else global_position.y
		if step.length() > 0.001:
			person.rotation.y = lerp_angle(person.rotation.y, atan2(step.x, step.z), minf(1.0, dt * 8.0))
	elif far > 0.3:
		person.rotation.y = lerp_angle(person.rotation.y, atan2(to.x, to.z), minf(1.0, dt * 3.0))
	person.locomote(speed)
