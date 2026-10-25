class_name TowerLift
extends Node3D
## The lift up the launch tower (valley-tower2): its car runs up the shaft
## from the landing at the foot to the deck where the Kestrel rests. E on
## it walks you aboard and rides it up, or down. The car is solid (you can
## stand in it), its gate open toward the village.

const BOTTOM := 0.34
const TOP := 30.22
## The shaft's place in the tower's space (beside it, toward the village).
const SHAFT := Vector3(0, 0, 11.0)
const SECONDS := 8.0

var car: Node3D
var _use: Usable
var _at_top := false
var _moving := false
var _hum: AudioStreamPlayer3D
## A bar across the hatch at the top while the car is not there.
var _gate: CollisionShape3D

func _ready() -> void:
	car = load("res://art/valley-lift.glb").instantiate()
	Surfaces.apply(car)
	add_child(car)
	var body := AnimatableBody3D.new()
	body.sync_to_physics = false
	for spec in [[Vector3(2.0, 0.2, 2.0), Vector3(0, 0.0, 0)], [Vector3(0.1, 1.1, 2.0), Vector3(-1.0, 0.65, 0)],
			[Vector3(0.1, 1.1, 2.0), Vector3(1.0, 0.65, 0)]]:
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = spec[0]
		cs.shape = box
		cs.position = spec[1]
		body.add_child(cs)
	car.add_child(body)
	_use = Usable.box("Ride the lift up", Vector3(2.4, 2.4, 2.4))
	_use.position = Vector3(0, 1.1, 0)
	_use.reach = 3.6
	car.add_child(_use)
	_use.used.connect(_ride)
	var gate_body := StaticBody3D.new()
	_gate = CollisionShape3D.new()
	var gb := BoxShape3D.new()
	gb.size = Vector3(2.8, 1.3, 0.12)
	_gate.shape = gb
	gate_body.add_child(_gate)
	add_child(gate_body)
	gate_body.position = SHAFT + Vector3(0, TOP + 0.75, -1.45)
	_hum = AudioStreamPlayer3D.new()
	_hum.stream = Sfx.hum_stream()
	_hum.volume_db = -80.0
	_hum.unit_size = 4.0
	car.add_child(_hum)
	reset()

## A new morning: the car at the foot.
func reset() -> void:
	_at_top = false
	_moving = false
	car.position = SHAFT + Vector3(0, BOTTOM, 0)
	_use.prompt = "Ride the lift up"
	_gate.set_deferred("disabled", false)

## Waiting at the top (a morning that begins in the Kestrel's seat: the way
## down is right there when you get out).
func park_top() -> void:
	_at_top = true
	_moving = false
	car.position = SHAFT + Vector3(0, TOP, 0)
	_use.prompt = "Ride the lift down"
	_gate.set_deferred("disabled", true)

func at_top() -> bool:
	return _at_top

func _ride(by: Node) -> void:
	var ex := by as Explorer
	if _moving or not ex:
		return
	_moving = true
	_use.prompt = ""
	ex.enabled = false
	ex.set_physics_process(false)
	ex.velocity = Vector3.ZERO
	# Aboard: to the middle of the car's floor.
	var from := ex.global_position
	var walk := create_tween()
	walk.tween_method(func(k: float):
		ex.global_position = from.lerp(car.global_transform * Vector3(0, 0.12, 0.15), k)
		ex.reset_physics_interpolation(), 0.0, 1.0, 0.7).set_trans(Tween.TRANS_SINE)
	await walk.finished
	Sfx.play("door", -10.0, 0.7)
	_hum.play()
	create_tween().tween_property(_hum, "volume_db", -14.0, 0.8)
	var y0 := car.position.y - SHAFT.y
	var y1 := BOTTOM if _at_top else TOP
	var t := create_tween()
	t.tween_method(func(y: float):
		car.position = SHAFT + Vector3(0, y, 0)
		ex.global_position = car.global_transform * Vector3(0, 0.12, 0.15)
		ex.reset_physics_interpolation(), y0, y1, SECONDS).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await t.finished
	create_tween().tween_property(_hum, "volume_db", -80.0, 0.6)
	Sfx.play("door", -10.0, 0.9)
	_at_top = not _at_top
	_gate.set_deferred("disabled", _at_top)
	if _at_top:
		# Off the car onto the deck, toward the Kestrel.
		var from2 := ex.global_position
		var to2 := car.global_transform * Vector3(0, 0.12, -2.4)
		var off := create_tween()
		off.tween_method(func(k: float):
			ex.global_position = from2.lerp(to2, k)
			ex.reset_physics_interpolation(), 0.0, 1.0, 0.9).set_trans(Tween.TRANS_SINE)
		await off.finished
	_moving = false
	_use.prompt = "Ride the lift down" if _at_top else "Ride the lift up"
	ex.set_physics_process(true)
	ex.enabled = true
