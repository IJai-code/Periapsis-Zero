class_name Missiles
extends Node3D
## Guided missiles: launched slow, they light their motors, accelerate and
## steer for the target's predicted position (proportional navigation),
## trailing smoke. A proximity fuse sets them off. A barrel roll in the last
## second throws the seeker off (the player's defence; `dodge` on a ship).

signal struck(team: String, target: Node3D, damage: float, layer: String)
signal launched(team: String, target: Node3D)

var _live: Array = []
var _mesh: Mesh
var _mats := {}

func _ready() -> void:
	var c := CapsuleMesh.new()
	c.radius = 0.28
	c.height = 2.6
	c.radial_segments = 8
	c.rings = 2
	_mesh = c
	for team in ["player", "hollow"]:
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.75, 0.74, 0.72)
		m.metallic = 0.6
		m.roughness = 0.4
		m.emission_enabled = true
		m.emission = Color(0.2, 0.7, 1.0) if team == "player" else Color(1.0, 0.3, 0.1)
		m.emission_energy_multiplier = 0.6
		_mats[team] = m

func launch(from: Vector3, dir: Vector3, inherit: Vector3, team: String, target: Node3D, damage := 22.0) -> void:
	var root := Node3D.new()
	add_child(root)
	root.global_position = from
	var mi := MeshInstance3D.new()
	mi.mesh = _mesh
	mi.material_override = _mats[team]
	mi.rotation_degrees.x = 90.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	var smoke := Fx.trail(root, true)
	smoke.amount = 40
	smoke.lifetime = 1.6
	var glow := OmniLight3D.new()
	glow.light_color = Color(1.0, 0.6, 0.3)
	glow.light_energy = 2.0
	glow.omni_range = 10.0
	glow.position = Vector3(0, 0, 1.4)
	glow.visible = Flow.high_quality()
	root.add_child(glow)
	_live.append({"node": root, "v": inherit + dir * 60.0, "team": team, "target": target, "dmg": damage, "t": 0.0, "fooled": false})
	launched.emit(team, target)
	Sfx.play("missile", -6.0 if team == "player" else -3.0, randf_range(0.95, 1.05))

## The live missiles chasing `ship`, nearest first (for the warning).
func incoming(ship: Node3D) -> Array:
	var out := []
	for m in _live:
		if m.target == ship and not m.fooled:
			out.append(m.node)
	out.sort_custom(func(a, b): return a.global_position.distance_to(ship.global_position) < b.global_position.distance_to(ship.global_position))
	return out

func _physics_process(dt: float) -> void:
	for i in range(_live.size() - 1, -1, -1):
		var m: Dictionary = _live[i]
		var node: Node3D = m.node
		m.t += dt
		var tgt: Node3D = m.target
		var ok: bool = tgt != null and is_instance_valid(tgt) and tgt.get("alive") != false
		var v: Vector3 = m.v
		var speed := minf(340.0, 60.0 + m.t * 260.0)
		if ok and not m.fooled and m.t > 0.35:
			var to := tgt.global_position - node.global_position
			var dist := to.length()
			# A barrel roll late in the chase breaks the lock.
			if tgt.get("dodging") and dist < 260.0:
				m.fooled = true
			var tv: Vector3 = tgt.get("velocity") if tgt.get("velocity") != null else Vector3.ZERO
			var lead := tgt.global_position + tv * clampf(dist / maxf(speed, 1.0), 0.0, 2.0)
			var want := (lead - node.global_position).normalized()
			var dir := v.normalized().slerp(want, minf(1.0, dt * 3.2))
			v = dir * speed
			if dist < 7.0 + float(tgt.get("radius") if tgt.get("radius") != null else 0.0) * 0.6:
				_burst(i, tgt)
				continue
		else:
			v = v.normalized() * speed
		m.v = v
		node.global_position += v * dt
		node.look_at(node.global_position + v, Vector3.UP if absf(v.normalized().y) < 0.99 else Vector3.RIGHT)
		if m.t > 7.0:
			Fx.explode(get_parent(), node.global_position, 3.0, false)
			_drop(i)

func _burst(i: int, tgt: Node3D) -> void:
	var m: Dictionary = _live[i]
	var at: Vector3 = (m.node as Node3D).global_position
	var layer: String = tgt.layer() if tgt.has_method("layer") else "hull"
	if tgt.has_method("hit"):
		tgt.hit(m.dmg, at, at - (m.v as Vector3).normalized() * 200.0)
	Fx.explode(get_parent(), at, 4.5, true)
	struck.emit(m.team, tgt, m.dmg, layer)
	_drop(i)

func _drop(i: int) -> void:
	var node: Node3D = _live[i].node
	_live.remove_at(i)
	# The smoke hangs a moment after the motor is gone.
	for c in node.get_children():
		if c is MeshInstance3D or c is OmniLight3D:
			c.queue_free()
		elif c is CPUParticles3D:
			(c as CPUParticles3D).emitting = false
	node.get_tree().create_timer(2.0).timeout.connect(node.queue_free)
