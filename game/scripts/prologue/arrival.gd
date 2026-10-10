extends Node3D
## Prologue, part three: nine days later, Hearth's medical bay. The player
## wakes in a bed; Mara Voss, the dockmaster, is there. She says what
## happened and what the player wants now: pay off Rook, and find who sold
## the Aster's route. Then the way into Act One.

var _cam: Camera3D
var _mara: Person
var _ui: Control
var _beeping := true

func _ready() -> void:
	add_child(HearthMedbay.new())
	_mara = Person.make("mara")
	add_child(_mara)
	_mara.position = Vector3(0.25, 0.0, -4.3)
	_mara.rotation.y = deg_to_rad(-60.0)
	# Lying in the bed: the head on the pillow, looking at the ceiling.
	_cam = Camera3D.new()
	_cam.fov = 62.0
	_cam.near = 0.03
	_cam.far = 120_000.0
	add_child(_cam)
	_cam.position = Vector3(-1.2, 0.95, -5.45)
	_cam.look_at(Vector3(-1.0, 2.9, -4.6))
	_cam.make_current()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Flow.music(false)
	_beep()
	_script()

func _beep() -> void:
	while _beeping and is_inside_tree():
		Sfx.play("beep", -20.0)
		await get_tree().create_timer(0.95).timeout

func _look(at: Vector3, seconds: float, move := Vector3.INF) -> void:
	var from := _cam.global_transform
	var to := Transform3D(Basis(), _cam.global_position if move == Vector3.INF else move)
	to = to.looking_at(at, Vector3.UP)
	var t := create_tween()
	t.tween_method(func(k: float): _cam.global_transform = from.interpolate_with(to, k), 0.0, 1.0, seconds).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await t.finished

func _script() -> void:
	Hud.wake(9.0)
	await get_tree().create_timer(1.2).timeout
	await Hud.card("NINE DAYS LATER", "HEARTH STATION · EARTH-MOON L1", 2.2)
	var face := Vector3(0.25, 1.62, -4.3)
	_mara.face(Vector3(-1.2, 1.0, -5.4))
	_mara.talk(true)
	await Hud.say("Mara Voss", "There you are. Don't sit up yet.")
	_mara.talk(false)
	await _look(face, 2.2)
	_mara.talk(true)
	await Hud.say("Mara Voss", "Mara Voss, dockmaster at Hearth. Salvage found your Kestrel on her beacon, nine days ago.")
	_mara.talk(false)
	# Sitting up.
	await _look(face, 2.0, Vector3(-1.15, 1.32, -5.0))
	_mara.talk(true)
	await Hud.say("Mara Voss", "You were the only one they pulled out of that field. Six ships. Nobody else.")
	await Hud.say("Mara Voss", "A man called Rook paid for your recovery. Forty thousand. He'll want it back, and he's patient until he isn't.")
	await Hud.say("Mara Voss", "One more thing. The Aster's flight recorder came in with your ship. Whatever happened out there is on it.")
	await Hud.say("Mara Voss", "Your captain said they knew your route. Somebody sold it. Find out who.")
	_mara.talk(false)
	_beeping = false
	_goals()

func _goals() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 6
	add_child(layer)
	_ui = Control.new()
	_ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui.theme = Style.theme()
	_ui.modulate.a = 0.0
	layer.add_child(_ui)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.grow_horizontal = Control.GROW_DIRECTION_BOTH
	v.grow_vertical = Control.GROW_DIRECTION_BOTH
	v.add_theme_constant_override("separation", 18)
	_ui.add_child(v)
	v.add_child(Style.label("PROLOGUE COMPLETE · YOUR GOALS", 16, Style.EMBER, Style.mono_bold))
	for g in [["Pay back Rook", "₡ 40,000 owed for your recovery"], ["Find who sold the Aster", "The flight recorder is the only witness"]]:
		var p := PanelContainer.new()
		p.add_theme_stylebox_override("panel", Style.panel(12))
		var row := VBoxContainer.new()
		row.add_child(Style.label(g[0], 34, Style.BONE, Style.sans_bold))
		row.add_child(Style.label(g[1], 20, Style.MUTE))
		p.add_child(row)
		p.custom_minimum_size = Vector2(620, 0)
		v.add_child(p)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 12)
	v.add_child(gap)
	var go := Button.new()
	go.text = "Continue to Act One"
	go.pressed.connect(Flow.open_act_one)
	v.add_child(go)
	v.add_child(Style.label("Act One plays in your browser at periapsiszero.dev, with your pilot's story picked up at Hearth.", 16, Style.MUTE))
	var back := Button.new()
	back.text = "Back to the title"
	back.pressed.connect(func(): Flow.go("title"))
	v.add_child(back)
	Flow.set_progress("prologue_done", true)
	Sfx.play("objective", -4.0)
	create_tween().tween_property(_ui, "modulate:a", 1.0, 1.2)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	go.grab_focus()
