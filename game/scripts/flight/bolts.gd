class_name Bolts
extends Node3D
## Every shot in flight: glowing bolts that travel, and hit whatever ship
## they pass through. Targets are anything in the "hull" group with
## `radius`, `team` and `hit(amount, at)`.

const SPEED := 650.0
const LIFE := 1.6

var _shots: Array = []
var _mesh: Mesh
var _mats := {}

func _ready() -> void:
	var c := CapsuleMesh.new()
	c.radius = 0.12
	c.height = 5.0
	c.radial_segments = 6
	c.rings = 1
	_mesh = c
	for team in ["player", "hollow"]:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		var col := Color(0.6, 1.6, 2.4) if team == "player" else Color(3.0, 0.7, 0.25)
		m.albedo_color = col
		_mats[team] = m

func fire(from: Vector3, dir: Vector3, inherit: Vector3, team: String, damage: float) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = _mesh
	mi.material_override = _mats[team]
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	mi.global_position = from
	mi.basis = Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT) * Basis(Vector3.RIGHT, PI / 2)
	_shots.append({"node": mi, "v": dir * SPEED + inherit, "team": team, "life": LIFE, "dmg": damage})

func _physics_process(dt: float) -> void:
	var hulls := get_tree().get_nodes_in_group("hull")
	for i in range(_shots.size() - 1, -1, -1):
		var s: Dictionary = _shots[i]
		var node: MeshInstance3D = s.node
		var a := node.global_position
		var b: Vector3 = a + s.v * dt
		var hit: Node3D = null
		for h in hulls:
			if h.team == s.team or not h.alive:
				continue
			if _segment_hits(a, b, h.global_position, h.radius):
				hit = h
				break
		s.life -= dt
		if hit:
			hit.hit(s.dmg, a)
		if hit or s.life <= 0.0:
			node.queue_free()
			_shots.remove_at(i)
		else:
			node.global_position = b

static func _segment_hits(a: Vector3, b: Vector3, c: Vector3, r: float) -> bool:
	var ab := b - a
	var t := clampf((c - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
	return (a + ab * t).distance_squared_to(c) < r * r
