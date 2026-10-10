extends Node3D
## Prologue, part three: nine days later, Hearth. Mara says what happened and
## what the player wants now: pay off Rook, and find who sold the Aster's
## route. Then the way into Act One.

const SUN := Vector3(0.9, 0.25, -0.35)

var _cam: Camera3D
var _t := 0.0
var _ui: Control

func _ready() -> void:
	Space.environment(self, SUN, 0.9)
	# Hearth, high above Earth: the planet small and whole in the window.
	var earth := Earth.toward(Vector3(0.25, -0.12, -1.0), 30_000_000.0, SUN, 0.002)
	add_child(earth)
	_cam = Camera3D.new()
	_cam.fov = 45.0
	_cam.far = 120_000.0
	add_child(_cam)
	Flow.music(true)
	_script()

func _process(dt: float) -> void:
	_t += dt
	_cam.rotation = Vector3(sin(_t * 0.05) * 0.01, sin(_t * 0.03) * 0.05, 0.0)

func _script() -> void:
	await get_tree().create_timer(1.5).timeout
	await Hud.card("NINE DAYS LATER", "HEARTH STATION · EARTH-MOON L1", 2.5)
	await Hud.say("Mara Voss", "There you are. Don't sit up yet. I'm Mara Voss, dockmaster at Hearth.")
	await Hud.say("Mara Voss", "Salvage found your Kestrel on her beacon. You were the only one they pulled out of that field.")
	await Hud.say("Mara Voss", "A man called Rook paid for your recovery. Forty thousand. He'll want it back, and he's patient until he isn't.")
	await Hud.say("Mara Voss", "One more thing. The Aster's flight recorder came in with your ship. Whatever happened out there is on it.")
	await Hud.say("Mara Voss", "Your captain said they knew your route. Somebody sold it. Find out who.")
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
