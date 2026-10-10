extends Node3D
## The corridor set on its own, from a fixed camera, for render checks.

func _ready() -> void:
	add_child(AsterCorridor.new())
	var cam := Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.03
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(0.55, 1.85, -6.4)
	cam.look_at(Vector3(-0.9, 1.45, -12.5))
