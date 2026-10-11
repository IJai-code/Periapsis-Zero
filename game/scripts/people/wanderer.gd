class_name Wanderer
extends Node3D
## A station person going about their day: walks from point to point along
## the open lanes, stops, looks about, sometimes sits on a bench a while.
## No physics: the lanes are laid clear of obstacles.

var who := "crowd1"
var points: Array = []          # Vector3s on the floor
var seats: Array = []           # Seat nodes they may use
var _person: Person
var _target := Vector3.ZERO
var _wait := 0.0
var _seat: Node3D = null
var _speed := 1.4

static func make(name: String, route: Array, benches: Array) -> Wanderer:
	var w := Wanderer.new()
	w.who = name
	w.points = route
	w.seats = benches
	return w

func _ready() -> void:
	_person = Person.make(who)
	add_child(_person)
	_speed = randf_range(1.15, 1.6)
	global_position = points[randi() % points.size()]
	_pick()
	_wait = randf_range(0.0, 3.0)

func _pick() -> void:
	if not seats.is_empty() and randf() < 0.3:
		var s: Node3D = seats[randi() % seats.size()]
		if not s.has_meta("taken"):
			_seat = s
			_target = s.global_position + s.global_basis * Vector3(0, 0, -0.6)
			_target.y = 0.0
			return
	_target = points[randi() % points.size()]

func _process(dt: float) -> void:
	if _wait > 0.0:
		_wait -= dt
		if _wait <= 0.0:
			if _seat and _seat.has_meta("taken") and _seat.get_meta("taken") == self:
				_seat.remove_meta("taken")
				global_position = _seat.global_position + _seat.global_basis * Vector3(0, 0, -0.6)
				global_position.y = 0.0
				_seat = null
			_pick()
		return
	var d := _target - global_position
	d.y = 0.0
	if d.length() < 0.15:
		if _seat:
			_seat.set_meta("taken", self)
			global_position = _seat.global_position + Vector3(0, -0.45, 0)
			rotation.y = _seat.global_rotation.y + PI
			_person.locomote(0.0, false, false, true)
			_wait = randf_range(8.0, 20.0)
		else:
			_person.locomote(0.0)
			_wait = randf_range(1.5, 6.0)
		return
	var step := minf(d.length(), _speed * dt)
	global_position += d.normalized() * step
	rotation.y = lerp_angle(rotation.y, atan2(d.x, d.z), minf(1.0, dt * 6.0))
	_person.locomote(_speed)
