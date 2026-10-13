class_name Bolts
extends Node3D
## Every shot in flight: glowing tracers that travel, hit whatever ship they
## pass through (anything in the "hull" group with `radius`, `team` and
## `hit`) and stop on anything else solid, a station's hull or a wreck,
## with sparks. Drawn as one multimesh a team, however many are flying.

## A bolt landed: who fired it, what it hit, for how much, on which layer.
signal struck(team: String, target: Node3D, damage: float, layer: String)

const SPEED := 900.0
const LIFE := 1.4
const MAX := 400

var _shots: Array = []
var _draw := {}

func _ready() -> void:
	# Instance transforms are submitted in _process, not the physics tick.
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	var c := CapsuleMesh.new()
	c.radius = 0.2
	c.height = 12.0
	c.radial_segments = 6
	c.rings = 1
	for team in ["player", "hollow"]:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(1.2, 3.2, 4.8) if team == "player" else Color(6.0, 1.4, 0.4)
		var mesh := c.duplicate() as CapsuleMesh
		mesh.material = m
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = MAX
		mm.visible_instance_count = 0
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.custom_aabb = AABB(Vector3.ONE * -1e5, Vector3.ONE * 2e5)
		add_child(mi)
		_draw[team] = mm

func fire(from: Vector3, dir: Vector3, inherit: Vector3, team: String, damage: float) -> void:
	if _shots.size() >= MAX:
		return
	_shots.append({"p": from, "v": dir * SPEED + inherit, "team": team, "life": LIFE, "dmg": damage, "from": from})

func _physics_process(dt: float) -> void:
	var hulls := get_tree().get_nodes_in_group("hull")
	var space := get_world_3d().direct_space_state
	var ray := PhysicsRayQueryParameters3D.new()
	ray.collision_mask = 1
	for i in range(_shots.size() - 1, -1, -1):
		var s: Dictionary = _shots[i]
		var a: Vector3 = s.p
		var b: Vector3 = a + s.v * dt
		var hit: Node3D = null
		for h in hulls:
			if h.team == s.team or not h.alive:
				continue
			# The player's tracers are forgiving: a near miss of a small
			# ship still lands (the enemy's shots get no such help).
			if _segment_hits(a, b, h.global_position, h.radius + (2.5 if s.team == "player" else 0.0)):
				hit = h
				break
		s.life -= dt
		if hit:
			var layer: String = hit.layer() if hit.has_method("layer") else "hull"
			hit.hit(s.dmg, a, s.from)
			struck.emit(s.team, hit, s.dmg, layer)
			_shots.remove_at(i)
			continue
		# Anything else solid (stations, wrecks) stops it.
		ray.from = a
		ray.to = b
		var w := space.intersect_ray(ray)
		if not w.is_empty():
			Fx.sparks(get_parent(), w.position, Color(3.5, 2.2, 1.2) if s.team == "player" else Color(5, 1.4, 0.4))
			_shots.remove_at(i)
			continue
		if s.life <= 0.0:
			_shots.remove_at(i)
		else:
			s.p = b

func _process(_dt: float) -> void:
	var n := {"player": 0, "hollow": 0}
	for s in _shots:
		var mm: MultiMesh = _draw[s.team]
		var k: int = n[s.team]
		var dir: Vector3 = (s.v as Vector3).normalized()
		var up := Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT
		mm.set_instance_transform(k, Transform3D(Basis.looking_at(dir, up) * Basis(Vector3.RIGHT, PI / 2), s.p))
		n[s.team] = k + 1
	for team in _draw:
		(_draw[team] as MultiMesh).visible_instance_count = n[team]

static func _segment_hits(a: Vector3, b: Vector3, c: Vector3, r: float) -> bool:
	var ab := b - a
	var t := clampf((c - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
	return (a + ab * t).distance_squared_to(c) < r * r
