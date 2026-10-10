class_name Fragment
extends MeshInstance3D
## One piece of wreckage: drifts, tumbles, and is gone after `life` seconds.

var velocity := Vector3.ZERO
var spin := Vector3.ZERO
var life := 30.0

func _process(dt: float) -> void:
	position += velocity * dt
	rotation += spin * dt
	life -= dt
	if life <= 0.0:
		queue_free()
