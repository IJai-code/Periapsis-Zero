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
		var p: Node3D = load("res://art/person-%s.glb" % names[n]).instantiate()
		add_child(p)
		p.position = Vector3((n - (names.size() - 1) / 2.0) * 0.9, 0.25, -5.0)
		var player := p.find_children("*", "AnimationPlayer", true, false)
		if player.size() > 0:
			var ap: AnimationPlayer = player[0]
			if ap.has_animation(anim):
				ap.get_animation(anim).loop_mode = Animation.LOOP_LINEAR
				ap.play(anim)
	var cam := Camera3D.new()
	cam.fov = 40.0
	cam.near = 0.03
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(0.35, 1.7, -2.6)
	cam.look_at(Vector3(0.0, 1.45, -5.0))
