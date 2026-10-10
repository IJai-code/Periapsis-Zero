class_name Interactable
extends Area3D
## Something the walker can use: a box in the world with a prompt.

signal activated

func _init(size: Vector3, prompt: String) -> void:
	set_meta("prompt", prompt)
	var s := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = size
	s.shape = b
	add_child(s)

func interact() -> void:
	activated.emit()
