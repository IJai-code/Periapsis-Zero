extends Node3D
## A person in the Aster's corridor, for render checks:
##   godot --path game res://scenes/person_preview.tscn -- --person hale --anim talk --shot out.png

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--person")
	var who: String = args[i + 1] if i >= 0 else "hale"
	var a := args.find("--anim")
	var anim: String = args[a + 1] if a >= 0 else "idle"
	if "--side" in args:
		# A plain studio: floor, sky light, a key from the front.
		var env := Environment.new()
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color(0.16, 0.17, 0.2)
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.6, 0.62, 0.68)
		env.ambient_light_energy = 0.6
		env.tonemap_mode = Environment.TONE_MAPPER_AGX
		var we := WorldEnvironment.new()
		we.environment = env
		add_child(we)
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-35, 60, 0)
		sun.light_energy = 2.0
		sun.shadow_enabled = true
		add_child(sun)
		var floor := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(20, 20)
		floor.mesh = pm
		floor.position = Vector3(0, 0.25, -5)
		add_child(floor)
	else:
		add_child(AsterCorridor.new())
	var names := who.split(",")
	for n in names.size():
		var p := Person.make(names[n])
		add_child(p)
		if anim == "talk":
			p.talk.call_deferred(true)
		elif anim != "idle":
			p.locomote.call_deferred(1.7 if anim == "walk" else (4.4 if anim == "run" else 0.0), anim.begins_with("crouch"))
		# `--mouth 0.4`: hold the mouth open that far, for checking the face.
		var mo := args.find("--mouth")
		if mo >= 0:
			p.set_meta("hold_mouth", float(args[mo + 1]))
		p.position = Vector3((n - (names.size() - 1) / 2.0) * 0.9, 0.25, -5.0)

	var cam := Camera3D.new()
	cam.fov = 40.0
	cam.near = 0.03
	cam.far = 120_000.0
	add_child(cam)
	var close := "--close" in args
	if "--side" in args:
		cam.fov = 30.0
		cam.position = Vector3(4.2, 1.0, -5.0)
		cam.look_at(Vector3(0.0, 0.95, -5.0))
		return
	# `--eye 1.62`: the face's height, for framing shorter people close.
	var e := args.find("--eye")
	var eye: float = float(args[e + 1]) if e >= 0 else 1.88
	cam.position = Vector3(0.12, eye + 0.05, -4.15) if close else Vector3(0.35, 1.7, -2.6)
	cam.look_at(Vector3(0.0, eye, -5.0) if close else Vector3(0.0, 1.45, -5.0))
	if close:
		var key := OmniLight3D.new()
		key.position = Vector3(0.6, 2.2, -4.0)
		key.omni_range = 3.0
		key.light_energy = 1.4
		key.light_color = Color(1.0, 0.92, 0.82)
		add_child(key)
