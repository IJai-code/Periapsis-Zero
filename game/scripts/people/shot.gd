class_name Shot3D
extends Camera3D
## A conversation camera: framed over one shoulder onto the speaker, the
## background soft (depth of field past the speaker's distance). Cut
## between speakers with `frame`; `done` gives the view back.

var _previous: Camera3D

static func open(parent: Node) -> Shot3D:
	var s := Shot3D.new()
	s.fov = 38.0
	s.near = 0.03
	s.far = 120_000.0
	parent.add_child(s)
	return s

## Cut to a shot of `face` from just over `shoulder` (both world points).
func frame(shoulder: Vector3, face: Vector3, side := 1.0) -> void:
	if not current:
		_previous = get_viewport().get_camera_3d()
		make_current()
	var to_face := (face - shoulder)
	var right := to_face.cross(Vector3.UP).normalized()
	global_position = shoulder - to_face.normalized() * 0.55 + right * 0.32 * side + Vector3(0, 0.06, 0)
	look_at(face + right * -0.12 * side + Vector3(0, -0.04, 0), Vector3.UP)
	var attr := CameraAttributesPractical.new()
	attr.dof_blur_far_enabled = true
	attr.dof_blur_far_distance = global_position.distance_to(face) + 1.2
	attr.dof_blur_far_transition = 3.0
	attr.dof_blur_amount = 0.08
	attributes = attr

## Back to the camera that was current before.
func done() -> void:
	if _previous and is_instance_valid(_previous):
		_previous.make_current()
	queue_free()
