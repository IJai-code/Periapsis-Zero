class_name Hull
extends Node3D
## Anything that can be shot: a ship or the Aster. Bolts find these through
## the "hull" group.

signal damaged(amount: float)
signal died

@export var team := "hollow"
var radius := 8.0
var alive := true
var shield := 0.0
var max_shield := 0.0
var integrity := 100.0
var max_integrity := 100.0
## Below this the hull will not go: the prologue never kills the player.
var floor_integrity := 0.0
var velocity := Vector3.ZERO
var _since_hit := 99.0

func _enter_tree() -> void:
	add_to_group("hull")

func hit(amount: float, at: Vector3) -> void:
	if not alive:
		return
	_since_hit = 0.0
	var left := amount
	if shield > 0.0:
		var take := minf(shield, left)
		shield -= take
		left -= take
		Fx.sparks(get_parent(), at, Color(0.8, 2.0, 3.0))
	else:
		Fx.sparks(get_parent(), at)
	integrity = maxf(integrity - left, floor_integrity)
	damaged.emit(amount)
	if integrity <= 0.0:
		alive = false
		died.emit()

func regenerate(dt: float, delay: float, rate: float) -> void:
	_since_hit += dt
	if _since_hit > delay:
		shield = minf(max_shield, shield + rate * dt)

## A model from game/assets/models, its engine glow tamed for real bloom.
static func model(kind: String) -> Node3D:
	var n: Node3D = load("res://assets/models/game-%s.glb" % kind).instantiate()
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if m and m.emission_enabled:
				m.emission_energy_multiplier *= 0.12
	return n
