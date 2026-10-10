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
## The ship's model, which breaks apart on death (Fx.shatter).
var body: Node3D
var _since_hit := 99.0
var _trail: CPUParticles3D

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
		# The shield's own flare says it; sparks are for bare hull.
		Fx.shield_hit(self, radius * 1.15, at)
	else:
		Fx.sparks(get_parent(), at)
	integrity = maxf(integrity - left, floor_integrity)
	damaged.emit(amount)
	# Badly hurt ships burn and smoke.
	if integrity < max_integrity * 0.5 and _trail == null and radius < 30.0:
		_trail = Fx.trail(self, integrity < max_integrity * 0.3)
	if integrity <= 0.0:
		alive = false
		died.emit()

func regenerate(dt: float, delay: float, rate: float) -> void:
	_since_hit += dt
	if _since_hit > delay:
		shield = minf(max_shield, shield + rate * dt)

## A ship model from art/godot/ships.py (game/art/ship-<kind>.glb), its
## named surfaces turned into real materials.
static func model(kind: String) -> Node3D:
	var n: Node3D = load("res://art/ship-%s.glb" % kind).instantiate()
	Surfaces.apply(n)
	return n

## Break apart: the model's pieces fly, a fireball where it was.
func destroy(blast := 9.0, force := 30.0) -> void:
	alive = false
	Fx.explode(get_parent(), global_position, blast)
	if body:
		Fx.shatter(get_parent(), body, velocity, force)
		body = null
