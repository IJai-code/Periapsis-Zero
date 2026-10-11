extends Node3D
## Act One: Hearth's berth 09. The repaired Kestrel on her cradle; up the
## ladder, and out for Mara's test flight.

var _set: AsterHangar
var _player: Player
var _board: Interactable
var _gone := false

func _ready() -> void:
	_set = AsterHangar.new()
	add_child(_set)
	Surfaces.collide(_set.kestrel)
	_set.add_ladder(Vector3(-2.7, 0.0, -17.2))
	var sign := Label3D.new()
	sign.text = "HEARTH  ·  BERTH 09"
	sign.font = Style.mono_bold
	sign.pixel_size = 0.006
	sign.font_size = 96
	sign.modulate = Style.BONE.darkened(0.2)
	sign.position = Vector3(-8.7, 6.5, -8.0)
	sign.rotation_degrees = Vector3(0, 90, 0)
	add_child(sign)
	_player = Player.new()
	add_child(_player)
	_player.position = Vector3(-6.5, 0.15, -1.2)
	_player.face(Vector3(0.0, 2.0, -14.0))
	_board = Interactable.new(Vector3(1.2, 2.4, 1.4), "[E] Climb into the Kestrel", 1.8)
	_board.position = Vector3(-2.7, 1.2, -17.2)
	add_child(_board)
	_board.activated.connect(_launch)
	Flow.music(false)
	await get_tree().create_timer(0.8).timeout
	Hud.objective("Board your [Kestrel]", "The ladder at her cockpit, port side")
	Hud.waypoint(_board, "KESTREL")
	Hud.say("Mara Voss", "Berth nine. The yard patched the holes. Try not to make new ones.")

func _launch() -> void:
	if _gone:
		return
	_gone = true
	_player.enabled = false
	Hud.clear_prompt()
	Hud.waypoint(null)
	await Hud.fade_out(0.5)
	Hud.clear_objective()
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
	Sfx.play("door", -6.0, 0.6)
	await get_tree().create_timer(0.8).timeout
	var t := create_tween()
	t.tween_property(k, "position:y", 3.8, 1.4).set_trans(Tween.TRANS_SINE)
	await t.finished
	Sfx.play("boom", -4.0, 0.5)
	var f := create_tween().set_parallel()
	f.tween_property(k, "position:z", -140.0, 2.4).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	f.tween_method(func(_v: float): cam.look_at(k.global_position + Vector3(0, 0.5, 0)), 0.0, 1.0, 2.4)
	await get_tree().create_timer(2.0).timeout
	Hud.letterbox(false)
	Flow.go("test_flight")
