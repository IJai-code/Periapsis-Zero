extends Node3D
## The end of what is built of Act One so far: Hearth from outside, the
## pilot's standing, and the way on.

func _ready() -> void:
	var sun := Vector3(0.5, 0.35, 0.8)
	Space.environment(self, sun, 1.0, "hearth")
	add_child(Earth.toward(Vector3(-0.3, -0.5, 1.0), 9_000_000.0, sun, 0.003))
	var st: Node3D = load("res://art/station-hearth.glb").instantiate()
	add_child(st)
	Surfaces.apply(st)
	var cam := Camera3D.new()
	cam.fov = 40.0
	cam.far = 120_000.0
	add_child(cam)
	cam.position = Vector3(150, 80, -380)
	cam.look_at(Vector3(-110, -10, -40))
	create_tween().tween_property(cam, "position", Vector3(140, 70, -340), 30.0)
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = Style.theme()
	layer.add_child(root)
	var wash := ColorRect.new()
	wash.color = Color(Style.VOID, 0.0)
	wash.set_anchors_preset(Control.PRESET_FULL_RECT)
	wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var g := Gradient.new()
	g.set_color(0, Color(Style.VOID, 0.9))
	g.set_color(1, Color(Style.VOID, 0.0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill_to = Vector2(1, 0)
	var tr := TextureRect.new()
	tr.texture = gt
	tr.stretch_mode = TextureRect.STRETCH_SCALE
	tr.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	tr.custom_minimum_size = Vector2(1000, 0)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(tr)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	v.offset_left = 96
	v.grow_vertical = Control.GROW_DIRECTION_BOTH
	v.add_theme_constant_override("separation", 14)
	root.add_child(v)
	var done: bool = Flow.progress("act1_descent", false)
	v.add_child(Style.label("ACT ONE COMPLETE · ACT TWO IN PRODUCTION" if done else "ACT ONE · TO BE CONTINUED", 16, Style.EMBER, Style.mono_bold))
	v.add_child(Style.label("The Hollow are Rook's." if done else "Hearth knows your name now.", 52, Style.BONE, Style.sans_bold))
	if done:
		v.add_child(Style.label("And the governor's seal is on his permits.", 28, Style.BONE, Style.sans))
	v.add_child(Style.label("₡ %s in hand  ·  ₡ %s still owed to Rook" % [Hud._thousands(Flow.credits()), Hud._thousands(Flow.debt())], 22, Style.MUTE, Style.mono))
	var note := Style.label("Act Two, the governor, is being built. Until then there is more to fly in the browser edition's open career: courier runs, the Drift, and the Hollow.", 20, Style.MUTE)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(620, 0)
	v.add_child(note)
	var go := Button.new()
	go.text = "Open the browser edition's career"
	go.pressed.connect(Flow.open_act_one)
	v.add_child(go)
	var well := Button.new()
	well.text = "Fly Down the Well again"
	well.pressed.connect(func(): Flow.go("descent"))
	v.add_child(well)
	var box := Button.new()
	box.text = "Fly Black Box again"
	box.pressed.connect(func(): Flow.go("blackbox"))
	v.add_child(box)
	var again := Button.new()
	again.text = "Fly the test flight again"
	again.pressed.connect(func(): Flow.go("test_flight"))
	v.add_child(again)
	var title := Button.new()
	title.text = "Back to the title"
	title.pressed.connect(func(): Flow.go("title"))
	v.add_child(title)
	go.grab_focus()
