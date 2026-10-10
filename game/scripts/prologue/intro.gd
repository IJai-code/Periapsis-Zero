extends Node3D
## The opening film: how the player got here. Six shots with narration:
## the world, the lanes, the Hollow, the pilot, the Aster and the job.
## Any of Enter, Space or Escape skips to the corridor.

const SUN := Vector3(0.7, 0.25, -0.67)
var _shot: Node3D
var _skipping := false

func _ready() -> void:
	Flow.music(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Hud.letterbox(true)
	Hud.prompt("[Enter] Skip the opening", 6.0)
	_film()

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and e.keycode in [KEY_ENTER, KEY_SPACE, KEY_ESCAPE]:
		get_viewport().set_input_as_handled()
		_skip()

func _skip() -> void:
	if _skipping:
		return
	_skipping = true
	Hud.letterbox(false)
	Flow.go("corridor")

func _new_shot(sun := SUN, exposure := 1.0) -> Camera3D:
	if _shot:
		_shot.queue_free()
	_shot = Node3D.new()
	add_child(_shot)
	Space.environment(_shot, sun, exposure)
	var cam := Camera3D.new()
	cam.fov = 40.0
	cam.near = 0.1
	cam.far = 120_000.0
	_shot.add_child(cam)
	cam.make_current()
	return cam

func _moon(at: Vector3, radius: float) -> void:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0
	s.radial_segments = 96
	s.rings = 48
	var m := StandardMaterial3D.new()
	m.albedo_texture = load("res://assets/textures/moon_color.jpg")
	m.roughness = 1.0
	s.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = s
	mi.position = at
	_shot.add_child(mi)

func _move(cam: Camera3D, from: Vector3, to: Vector3, look: Vector3, seconds: float, look_to := Vector3.INF) -> void:
	cam.position = from
	cam.look_at(look)
	var end_look := look if look_to == Vector3.INF else look_to
	create_tween().tween_method(func(k: float):
		if is_instance_valid(cam):
			cam.position = from.lerp(to, k)
			cam.look_at(look.lerp(end_look, k)), 0.0, 1.0, seconds).set_trans(Tween.TRANS_SINE)

func _cut(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout
	if not _skipping:
		await Hud.fade_out(0.7)

func _film() -> void:
	await get_tree().process_frame
	# 1. The world.
	var cam := _new_shot()
	_shot.add_child(Earth.toward(Vector3(-0.35, -0.2, -1.0), 22_000_000.0, SUN, 0.002))
	_moon(Vector3(9_000.0, 2_400.0, -64_000.0), 1_000.0)
	_move(cam, Vector3.ZERO, Vector3(0, 0, -800.0), Vector3(-0.1, -0.05, -1.0) * 1000.0, 11.0)
	Hud.fade_in(1.5)
	Hud.narrate("[3091.] Two hundred million people live between the Earth and the Moon.", 4.5)
	await _cut(7.5)
	if _skipping: return
	# 2. The lanes.
	cam = _new_shot()
	_shot.add_child(Earth.below(420_000.0, SUN))
	for c in [["freighter2", Vector3(0, 0, 0)], ["freighter3", Vector3(70, 20, 160)], ["freighter2", Vector3(-60, -15, 300)]]:
		var f := Hull.model(c[0])
		f.position = c[1]
		_shot.add_child(f)
		var tw := create_tween()
		tw.tween_property(f, "position:z", c[1].z - 120.0, 10.0)
	_move(cam, Vector3(110, 10, 40), Vector3(90, 18, -60), Vector3(0, 0, -40), 9.0, Vector3(0, 0, -140))
	Hud.fade_in(1.0)
	Hud.narrate("Everything they need crosses the [lanes] between them: water, metal, medicine.", 4.5)
	await _cut(7.0)
	if _skipping: return
	# 3. The Hollow.
	cam = _new_shot(Vector3(-0.5, 0.2, 0.84), 0.8)
	_shot.add_child(Earth.below(420_000.0, Vector3(-0.5, 0.2, 0.84)))
	var victim := Hull.model("freighter3")
	victim.position = Vector3(40, -30, -700)
	_shot.add_child(victim)
	# Three raiders streak away from the camera toward the freighter ahead.
	for i in 3:
		var r := Hull.model("raider")
		var start := Vector3(-9.0 + i * 9.0, -3.0 + (i % 2) * 4.0, 18.0 - i * 6.0)
		r.position = start
		_shot.add_child(r)
		var tw := create_tween()
		tw.tween_property(r, "position", Vector3(30 + i * 6, -22, -660), 6.5).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	_move(cam, Vector3(2, 6, 44), Vector3(0, 4, 34), Vector3(0, -2, -100), 7.0, Vector3(30, -20, -700))
	Hud.fade_in(0.8)
	Hud.narrate("Since spring, something has been hunting the convoys. The lanes call them [the Hollow].", 4.5)
	await get_tree().create_timer(4.0).timeout
	if _skipping: return
	Fx.explode(_shot, victim.global_position + Vector3(0, 5, 0), 40.0)
	await _cut(3.2)
	if _skipping: return
	# 4. The pilot.
	if _shot:
		_shot.queue_free()
	_shot = Node3D.new()
	add_child(_shot)
	var bay := AsterHangar.new()
	_shot.add_child(bay)
	var pilot := Person.make("pilot")
	pilot.suit_tint = Color(0.42, 0.45, 0.36)
	_shot.add_child(pilot)
	pilot.position = Vector3(-3.2, 0.05, -9.5)
	pilot.rotation.y = deg_to_rad(200.0)
	cam = Camera3D.new()
	cam.fov = 34.0
	cam.far = 120_000.0
	_shot.add_child(cam)
	cam.make_current()
	_move(cam, Vector3(-6.0, 1.7, -4.5), Vector3(-5.0, 1.6, -6.2), Vector3(-2.2, 1.4, -11.0), 8.0, Vector3(-1.5, 1.5, -12.5))
	Hud.fade_in(1.0)
	Hud.narrate("You fly escort. One fighter, one licence, and [debts] you don't talk about.", 4.5)
	await _cut(7.0)
	if _skipping: return
	# 5. The Aster and the job.
	cam = _new_shot()
	_shot.add_child(Earth.below(420_000.0, SUN))
	var aster := Hull.model("freighter")
	_shot.add_child(aster)
	_move(cam, Vector3(-150, 30, 160), Vector3(-110, 15, 60), Vector3(0, 0, 0), 9.0)
	Hud.fade_in(1.0)
	Hud.narrate("Tonight the [Aster] leaves Harbor orbit with six ships and a hold full of vaccine. She needs an escort.", 5.0)
	await get_tree().create_timer(7.5).timeout
	if _skipping: return
	await Hud.fade_out(1.2)
	Hud.narrate("This is how it started.", 2.5)
	await get_tree().create_timer(4.2).timeout
	_skip()
