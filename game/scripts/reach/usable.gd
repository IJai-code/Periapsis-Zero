class_name Usable
extends Area3D
## Something the explorer can use: looked at within reach, it offers its
## prompt ("Talk to Mara", "Read the songline"); E uses it. A sphere or a
## box of `size`; collision layer 4, which only the explorer's look ray sees.

signal used(by: Node)

var prompt := ""
var reach := 3.2

static func sphere(text: String, radius := 0.8) -> Usable:
	var u := Usable.new()
	u.prompt = text
	var cs := CollisionShape3D.new()
	var s := SphereShape3D.new()
	s.radius = radius
	cs.shape = s
	u.add_child(cs)
	return u

static func box(text: String, size: Vector3) -> Usable:
	var u := Usable.new()
	u.prompt = text
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	u.add_child(cs)
	return u

func _init() -> void:
	collision_layer = 8
	collision_mask = 0
	monitoring = false
	monitorable = true

func use(by: Node) -> void:
	used.emit(by)
