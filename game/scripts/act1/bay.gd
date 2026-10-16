extends Node3D
## Act One: Hearth's berth 09. The repaired Kestrel on her cradle; up the
## ladder, and out for Mara's test flight.

var _set: AsterHangar
var _player: Player
var _board: Node3D
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
	# No key: walking up to the ladder's foot starts the climb.
	_board = Node3D.new()
	_board.position = Vector3(-2.7, 1.2, -17.2)
	add_child(_board)
	Flow.music(false)
	await get_tree().create_timer(0.8).timeout
	Hud.objective("Board your [Kestrel]", "The ladder at her cockpit, port side")
	Hud.waypoint(_board, "KESTREL")
	Hud.say("Mara Voss", "Berth nine. The yard patched the holes. Try not to make new ones.")

func _process(_dt: float) -> void:
	if not _gone and _player.enabled and Vector2(_player.global_position.x - _set.ladder_foot.x, _player.global_position.z - _set.ladder_foot.z).length() < 1.1:
		_launch()

func _launch() -> void:
	if _gone:
		return
	_gone = true
	Report.line("BOARD climbing")
	Hud.clear_prompt()
	Hud.waypoint(null)
	await _set.climb_aboard(_player)
	# The pilot is in the cockpit now, not on the deck.
	_player.visible = false
	_player.process_mode = Node.PROCESS_MODE_DISABLED
	Hud.clear_objective()
	var cam := Camera3D.new()
	cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	cam.fov = 48.0
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(5.5, 1.2, -29.0)
	cam.look_at(_set.kestrel.position + Vector3(0, 0.5, 0))
	cam.make_current()
	Hud.letterbox(true)
	var k := _set.kestrel
	k.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	Sfx.play("door", -6.0, 0.6)
	await _set.retract_ladder()
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
