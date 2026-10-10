extends Node3D
## One ship in open space for render checks:
##   godot --path game res://scenes/ship_preview.tscn -- --ship kestrel --shot out.png

const SUN := Vector3(0.7, 0.45, 0.55)

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--ship")
	var kind: String = args[i + 1] if i >= 0 else "kestrel"
	Space.environment(self, SUN, 1.0)
	add_child(Earth.below(420_000.0, SUN))
	var ship: Node3D = load("res://art/ship-%s.glb" % kind).instantiate()
	add_child(ship)
	Surfaces.apply(ship)
	var size: float = {"kestrel": 16.0, "raider": 18.0, "freighter": 150.0}.get(kind, 20.0)
	var cam := Camera3D.new()
	cam.fov = 38.0
	cam.far = 120_000.0
	add_child(cam)
	var front := "--front" in args
	cam.position = Vector3(size * 0.7, size * 0.3, -size * 0.7 if front else size * 0.62)
	cam.look_at(Vector3(0, -size * 0.04, -size * 0.05))
