extends Node3D
## A person in the Aster's corridor, for render checks:
##   godot --path game res://scenes/person_preview.tscn -- --person hale --anim talk --shot out.png

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--person")
	var who: String = args[i + 1] if i >= 0 else "hale"
	var a := args.find("--anim")
	var anim: String = args[a + 1] if a >= 0 else "idle"
	add_child(AsterCorridor.new())
	var names := who.split(",")
	for n in names.size():
		var p := Person.make(names[n])
		add_child(p)
		if anim == "talk":
			p.talk.call_deferred(true)
		p.position = Vector3((n - (names.size() - 1) / 2.0) * 0.9, 0.25, -5.0)

	var cam := Camera3D.new()
	cam.fov = 40.0
	cam.near = 0.03
	cam.far = 120_000.0
	add_child(cam)
	var close := "--close" in args
	cam.position = Vector3(0.12, 1.93, -4.15) if close else Vector3(0.35, 1.7, -2.6)
	cam.look_at(Vector3(0.0, 1.88, -5.0) if close else Vector3(0.0, 1.45, -5.0))
	if close:
		var key := OmniLight3D.new()
		key.position = Vector3(0.6, 2.2, -4.0)
		key.omni_range = 3.0
		key.light_energy = 1.4
		key.light_color = Color(1.0, 0.92, 0.82)
		add_child(key)
