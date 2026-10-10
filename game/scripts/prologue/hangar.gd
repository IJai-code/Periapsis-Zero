extends Node3D
## Prologue: the flight deck. Walk to the Kestrel, climb in, and watch her
## leave the Aster's bay: the moment the player becomes a pilot.

var _set: AsterHangar
var _walker: Player
var _board: Interactable
var _gone := false

func _ready() -> void:
	_set = AsterHangar.new()
	add_child(_set)
	_walker = Player.new()
	add_child(_walker)
	_walker.position = Vector3(-6.5, 0.15, -1.2)
	_walker.face(Vector3(0.0, 2.0, -14.0))
	_board = Interactable.new(Vector3(3.0, 3.0, 6.0), "[E] Climb into the Kestrel")
	_board.position = Vector3(0.0, 2.0, -14.0)
	add_child(_board)
	_board.activated.connect(_launch)
	Flow.music(false)
	_script()
	if "--launch" in OS.get_cmdline_user_args():
		_launch()

func _script() -> void:
	await get_tree().create_timer(0.8).timeout
	if _gone:
		return
	Hud.objective("Board your [Kestrel]", "Mid-deck, on the cradle")
	await Hud.say("Renn Ayers", "Flight deck, this is engineering. She's on the cradle, fuelled and warm.")
	if _gone:
		return
	await Hud.say("Renn Ayers", "Bring her back without holes in her. I'm the one who patches them.")

func _launch() -> void:
	if _gone:
		return
	_gone = true
	_walker.enabled = false
	Hud.clear_prompt()
	Hud.silence()
	await Hud.fade_out(0.5)
	Hud.clear_objective()
	Hud.silence()
	# The launch, from the deck by the open doors looking back.
	var cam := Camera3D.new()
	cam.fov = 48.0
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(5.5, 1.2, -29.0)
	cam.look_at(_set.kestrel.position + Vector3(0, 0.5, 0))
	cam.make_current()
	Hud.letterbox(true)
	Hud.fade_in(0.6)
	var k := _set.kestrel
	var glow := OmniLight3D.new()
	glow.light_color = Color(0.5, 0.8, 1.0)
	glow.light_energy = 0.0
	glow.omni_range = 9.0
	k.add_child(glow)
	glow.position = Vector3(0, 0, 7.5)
	Sfx.play("door", -6.0, 0.6)
	await get_tree().create_timer(0.8).timeout
	create_tween().tween_property(glow, "light_energy", 6.0, 1.2)
	Hud.say("Captain Hale", "Kestrel, Aster. You're clear to launch. Take station off our port side.", 3.5)
	var t := create_tween()
	t.tween_property(k, "position:y", 3.3, 1.6).set_trans(Tween.TRANS_SINE)
	await t.finished
	Sfx.play("boom", -4.0, 0.5)
	var follow := create_tween().set_parallel()
	follow.tween_property(k, "position:z", -140.0, 2.6).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	follow.tween_method(func(v: float): cam.look_at(k.global_position + Vector3(0, 0.5, 0)), 0.0, 1.0, 2.6)
	await get_tree().create_timer(2.2).timeout
	Hud.letterbox(false)
	Flow.go("flight")
