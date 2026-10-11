extends Node
## `-- --crowdtest`: runs a scene's crowd at six times speed for four minutes
## of station time and counts the moments anyone walking stood inside
## something solid (a bench, a planter, a column, a wall).

var _t := 0.0
var _frames := 0
var _inside := 0
var _worst := ""

func _ready() -> void:
	if not "--crowdtest" in OS.get_cmdline_user_args():
		set_physics_process(false)
		return
	process_mode = Node.PROCESS_MODE_ALWAYS

func _physics_process(dt: float) -> void:
	_t += dt / maxf(Engine.time_scale, 0.01)
	if _t < 2.0:
		return
	Engine.time_scale = 6.0
	var space := get_viewport().world_3d.direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	var probe := CylinderShape3D.new()
	probe.radius = 0.18
	probe.height = 1.0
	q.shape = probe
	for w in get_tree().get_nodes_in_group("walker"):
		if not (w is Wanderer) or w._sitting:
			continue
		_frames += 1
		q.transform = Transform3D(Basis(), (w as Node3D).global_position + Vector3(0, 0.6, 0))
		for hit in space.intersect_shape(q, 8):
			if hit.collider is StaticBody3D and not (hit.collider is AnimatableBody3D):
				_inside += 1
				_worst = "%s at %s" % [w.who, (w as Node3D).global_position.snapped(Vector3.ONE * 0.01)]
				break
	if _t > 2.0 + 240.0 / 6.0:
		Engine.time_scale = 1.0
		# The probe must find a bench where one stands, or zero means nothing.
		q.transform = Transform3D(Basis(), Vector3(-3.4, 0.6, -6.0))
		var sees := space.intersect_shape(q, 8).any(func(h): return h.collider is StaticBody3D and not (h.collider is AnimatableBody3D))
		Report.line("CROWDTEST probe sees bench %s" % sees)
		Report.line("CROWDTEST frames %d inside solid %d %s" % [_frames, _inside, _worst])
		get_tree().quit()
		set_physics_process(false)
