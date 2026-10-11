class_name Interactable
extends Area3D
## Something the player can use: a box in the world with a prompt. The
## player is offered it when standing within `reach` metres of the box and
## facing it, whatever the camera is looking at.

signal activated

var size := Vector3.ONE
var reach := 1.6

func _init(box: Vector3, prompt: String, reach_m := 1.6) -> void:
	size = box
	reach = reach_m
	set_meta("prompt", prompt)
	var s := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = box
	s.shape = b
	add_child(s)

func _enter_tree() -> void:
	add_to_group("interactable")

func interact() -> void:
	activated.emit()

## Distance from a world point to the nearest point of the box.
func distance_to(world: Vector3) -> float:
	var local := global_transform.affine_inverse() * world
	var h := size * 0.5
	var c := Vector3(clampf(local.x, -h.x, h.x), clampf(local.y, -h.y, h.y), clampf(local.z, -h.z, h.z))
	return (global_transform * c).distance_to(world)

func prompt_text() -> String:
	return String(get_meta("prompt", ""))
