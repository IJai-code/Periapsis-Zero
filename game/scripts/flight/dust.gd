class_name Dust
extends MultiMeshInstance3D
## Specks of dust and ice drifting in space around the camera, so speed can
## be seen: still, they are points; at speed, each one streaks along the
## ship's motion. They wrap in a box round the camera, so there are always
## some in view.

const COUNT := 320
const BOX := 90.0

var ship: Node3D
var _points: PackedVector3Array

func _ready() -> void:
	var q := QuadMesh.new()
	q.size = Vector2(0.06, 1.0)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(0.75, 0.82, 0.95, 0.5)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	q.material = m
	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = q
	multimesh.instance_count = COUNT
	_points.resize(COUNT)
	for i in COUNT:
		_points[i] = Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * BOX
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	top_level = true

func _process(_dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if not cam or not ship:
		return
	var v: Vector3 = ship.get("velocity") if ship.get("velocity") != null else Vector3.ZERO
	var speed := v.length()
	var len := clampf(speed * 0.045, 0.15, 7.0)
	var dir := v.normalized() if speed > 1.0 else Vector3.FORWARD
	var origin := cam.global_position
	global_position = Vector3.ZERO
	for i in COUNT:
		# Wrap each point into the box around the camera.
		var p := _points[i]
		var rel := p - origin
		rel = Vector3(wrapf(rel.x, -BOX, BOX), wrapf(rel.y, -BOX, BOX), wrapf(rel.z, -BOX, BOX))
		var at := origin + rel
		# A streak along the motion, turned to face the camera.
		var side := dir.cross(cam.global_position - at).normalized()
		if side.length() < 0.01:
			side = Vector3.RIGHT
		var fwd := dir * len
		var normal := side.cross(dir).normalized()
		multimesh.set_instance_transform(i, Transform3D(Basis(side, fwd, normal), at))
