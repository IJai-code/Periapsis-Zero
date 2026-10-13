class_name Wanderer
extends Node3D
## A station person going about their day: walks from point to point along
## paths from the navigation mesh (so round benches, planters and columns,
## never through them), stops, looks about, sometimes sits on a bench a
## while. Gives way to anyone in front, the player included, and says a
## line when the player comes close (`lines`).

var who := "crowd1"
var points: Array = []          # Vector3s on the floor
var seats: Array = []           # Seat nodes they may use
var lines: Array = []           # things they say to a passing player
var _person: Person
var _target := Vector3.ZERO
var _path := PackedVector3Array()
var _wait := 0.0
var _seat: Node3D = null
var _sitting := false
var _speed := 1.4
var _blocked := 0.0
var _spoke := -99.0
var _clock := 0.0

static func make(name: String, route: Array, benches: Array, said: Array = []) -> Wanderer:
	var w := Wanderer.new()
	w.who = name
	w.points = route
	w.seats = benches
	w.lines = said
	return w

func _ready() -> void:
	add_to_group("walker")
	_person = Person.make(who)
	add_child(_person)
	_speed = randf_range(1.15, 1.5)
	global_position = points[randi() % points.size()]
	reset_physics_interpolation()
	_wait = randf_range(0.2, 2.5)

func _pick() -> void:
	_seat = null
	if not seats.is_empty() and randf() < 0.3:
		var s: Node3D = seats[randi() % seats.size()]
		if not s.has_meta("taken"):
			_seat = s
			s.set_meta("taken", self)
			_target = s.global_position + s.global_basis * Vector3(0, 0, -0.75)
			_target.y = 0.0
			_route()
			return
	for i in 4:
		_target = points[randi() % points.size()]
		if _target.distance_to(global_position) > 3.0:
			break
	_route()

func _route() -> void:
	var map := get_world_3d().navigation_map
	_path = NavigationServer3D.map_get_path(map, global_position, _target, true)
	if _path.is_empty():
		# The map is not ready on the first frames: try again shortly.
		_wait = 0.5
		if _seat:
			_seat.remove_meta("taken")
			_seat = null

## Steps on the physics tick, with interpolation smoothing the render between
## ticks, same as the player. A person stepping at the frame rate with the
## body animated on the tick rate is what made people look laggy.
func _physics_process(dt: float) -> void:
	_clock += dt
	_chat()
	if _wait > 0.0:
		_wait -= dt
		if _wait <= 0.0:
			if _sitting:
				_stand()
			_pick()
		return
	if _path.is_empty():
		_arrive()
		return
	var next := _path[0]
	var d := next - global_position
	d.y = 0.0
	if d.length() < 0.12:
		_path.remove_at(0)
		return
	var dir := d.normalized()
	_person.follow_route()
	# Give way: someone close ahead means wait a moment, then try round.
	if _ahead(dir):
		_person.locomote(0.0)
		_blocked += dt
		if _blocked > 0.7:
			_blocked = 0.0
			_sidestep(dir)
		return
	_blocked = 0.0
	var step := minf(d.length(), _speed * dt)
	global_position += dir * step
	global_position.y = 0.0
	rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), minf(1.0, dt * 6.0))
	_person.locomote(_speed)

## Step out of the way: a point to one side (on the walkway), then on.
func _sidestep(dir: Vector3) -> void:
	var map := get_world_3d().navigation_map
	var side := Vector3(dir.z, 0.0, -dir.x) * (1.0 if randf() < 0.5 else -1.0)
	for s in [side, -side]:
		var p := NavigationServer3D.map_get_closest_point(map, global_position + s * 1.3 - dir * 0.2)
		if p.distance_to(global_position) > 0.6 and not _crowded(p):
			# Round things, not through them: the way there is a path too, and
			# a short one, or it is no sidestep.
			var there := NavigationServer3D.map_get_path(map, global_position, p, true)
			var length := 0.0
			for i in range(1, there.size()):
				length += there[i - 1].distance_to(there[i])
			# A point the walkway cannot reach (beyond a wall) is no sidestep.
			if there.is_empty() or length > 2.6 or there[there.size() - 1].distance_to(p) > 0.3:
				continue
			_path = there
			_path.append_array(NavigationServer3D.map_get_path(map, p, _target, true))
			return
	_wait = randf_range(0.4, 1.0)

## Everyone else who could be in the way: walkers and the player. Two group
## loops rather than joining the lists, which allocated every call.
func _crowded(p: Vector3) -> bool:
	for group in ["walker", "player"]:
		for n in get_tree().get_nodes_in_group(group):
			if n != self and (n as Node3D).global_position.distance_to(p) < 0.9:
				return true
	return false

func _ahead(dir: Vector3) -> bool:
	for group in ["walker", "player"]:
		for n in get_tree().get_nodes_in_group(group):
			if n == self or not (n is Node3D):
				continue
			var to: Vector3 = (n as Node3D).global_position - global_position
			to.y = 0.0
			if to.length() < 1.05 and to.normalized().dot(dir) > 0.55:
				return true
	return false

func _arrive() -> void:
	if _seat and _seat.get_meta("taken", null) == self:
		_sitting = true
		_seat.set_meta("prompt_was", _seat.prompt_text())
		_seat.set_meta("prompt", "")
		var to := _seat.global_position + Vector3(0, -0.45, 0)
		var t := create_tween()
		t.set_process_mode(Tween.TWEEN_PROCESS_PHYSICS)
		t.tween_property(self, "global_position", to, 0.45).set_trans(Tween.TRANS_SINE)
		rotation.y = _seat.global_rotation.y + PI
		_person.follow_route()
		_person.locomote(0.0, false, false, true)
		_wait = randf_range(10.0, 24.0)
	else:
		_person.locomote(0.0)
		_wait = randf_range(1.5, 6.0)

func _stand() -> void:
	_sitting = false
	if _seat:
		global_position = _seat.global_position + _seat.global_basis * Vector3(0, 0, -0.75)
		global_position.y = 0.0
		reset_physics_interpolation()
		_seat.set_meta("prompt", _seat.get_meta("prompt_was", "[E] Sit on the bench"))
		_seat.remove_meta("taken")
		_seat = null
	_person.locomote(0.0)

## A line for a player who comes close, at most once every half minute.
func _chat() -> void:
	if lines.is_empty() or _clock - _spoke < 30.0:
		return
	for p in get_tree().get_nodes_in_group("player"):
		if (p as Node3D).global_position.distance_to(global_position) < 2.2:
			_spoke = _clock
			if not _sitting and _path.is_empty():
				_person.face((p as Node3D).global_position)
			Hud.overheard(lines[randi() % lines.size()])
