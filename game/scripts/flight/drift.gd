class_name Drift
extends Node
## Moves its parent: a piece of a broken ship, sliding and tumbling away.
## Leaves with it after `life` seconds.

var velocity := Vector3.ZERO
var spin := Vector3.ZERO
var life := 25.0

func _process(dt: float) -> void:
	var p := get_parent() as Node3D
	if not p:
		return
	p.global_position += velocity * dt
	p.rotate(spin.normalized() if spin.length() > 0.0 else Vector3.UP, spin.length() * dt)
	life -= dt
	if life <= 0.0:
		p.queue_free()
