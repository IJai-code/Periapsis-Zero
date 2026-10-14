extends Node
## Photo mode: F2 anywhere in the game stops time, hides the interface and
## hands over a free camera; a click keeps the picture.
##
## Desktop: a PNG in Pictures/Periapsis Zero. Browser: the PNG downloads.
##
##   Right drag  look        W A S D  move     Space / C  up, down
##   Shift       faster      Q / E    roll     Wheel      zoom
##   F           focus blur (full detail only)  Click  take the picture
##   H           hide these hints               F2 / Esc  back to the game

const KEY := KEY_F2

var active := false
var _cam: Camera3D
var _was: Camera3D
var _hidden: Array = []
var _layer: CanvasLayer
var _hint: Label
var _toast: Label
var _yaw := 0.0
var _pitch := 0.0
var _roll := 0.0
var _look := false
var _dof := false
var _attrs: CameraAttributesPractical
var _toast_t := 0.0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# A check: `-- --phototest out.png` enters photo mode after a few
	# seconds, swings the camera round and keeps a picture there.
	var args := OS.get_cmdline_user_args()
	var i := args.find("--phototest")
	if i >= 0 and i + 1 < args.size():
		await get_tree().create_timer(9.0, true, false, true).timeout
		_enter()
		_yaw += 2.4
		_pitch -= 0.15
		for n in 30:
			await get_tree().process_frame
		await _capture(args[i + 1])
		Report.line("PHOTO active %s, paused %s, saved %s" % [active, get_tree().paused, FileAccess.file_exists(args[i + 1])])
		_leave()
		await get_tree().process_frame
		Report.line("PHOTO after leaving: paused %s, hud visible %s" % [get_tree().paused, Hud.visible])
		Report.finish(get_tree())

func _input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		if e.keycode == KEY:
			if active:
				_leave()
			else:
				_enter()
			get_viewport().set_input_as_handled()
			return
		if active and e.keycode == KEY_ESCAPE:
			_leave()
			get_viewport().set_input_as_handled()
			return
	if not active:
		return
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_look = mb.pressed
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			_capture()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_cam.fov = maxf(_cam.fov - 2.5, 12.0)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_cam.fov = minf(_cam.fov + 2.5, 110.0)
	elif e is InputEventMouseMotion and _look:
		var mm := e as InputEventMouseMotion
		_yaw -= mm.relative.x * 0.004
		_pitch = clampf(_pitch - mm.relative.y * 0.004, -1.5, 1.5)
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_H:
				_hint.visible = not _hint.visible
			KEY_F:
				_toggle_focus()
	# Nothing reaches the game underneath while the picture is set up.
	get_viewport().set_input_as_handled()

func _enter() -> void:
	var was := get_viewport().get_camera_3d()
	if was == null or get_tree().paused or Flow._busy:
		return
	active = true
	_was = was
	get_tree().paused = true
	# Every interface layer goes, the HUD and the film grain with it.
	_hidden = []
	for l in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if (l as CanvasLayer).visible:
			_hidden.append(l)
			(l as CanvasLayer).visible = false
	_cam = Camera3D.new()
	_cam.top_level = true
	_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_cam.fov = was.fov
	_cam.near = was.near
	_cam.far = was.far
	_cam.environment = was.environment
	add_child(_cam)
	_cam.global_transform = was.global_transform
	var e := _cam.global_basis.get_euler(EULER_ORDER_YXZ)
	_pitch = e.x
	_yaw = e.y
	_roll = e.z
	_cam.current = true
	_dof = false
	_ui()
	Sfx.play("click", -6.0, 0.7)

func _leave() -> void:
	active = false
	_look = false
	if is_instance_valid(_was):
		_was.current = true
	if is_instance_valid(_cam):
		_cam.queue_free()
	for l in _hidden:
		if is_instance_valid(l):
			(l as CanvasLayer).visible = true
	_hidden = []
	if is_instance_valid(_layer):
		_layer.queue_free()
	get_tree().paused = false

func _process(dt: float) -> void:
	if _toast and _toast_t > 0.0:
		_toast_t -= dt
		_toast.modulate.a = clampf(_toast_t, 0.0, 1.0)
	if not active or not is_instance_valid(_cam):
		return
	var b := Basis.from_euler(Vector3(_pitch, _yaw, _roll), EULER_ORDER_YXZ)
	var move := Vector3(
		float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
		float(Input.is_key_pressed(KEY_SPACE)) - float(Input.is_key_pressed(KEY_C)),
		float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W)))
	var speed := 40.0 if Input.is_key_pressed(KEY_SHIFT) else 6.0
	_roll += (float(Input.is_key_pressed(KEY_Q)) - float(Input.is_key_pressed(KEY_E))) * dt * 0.8
	_cam.global_transform = Transform3D(b, _cam.global_position + b * move * speed * dt)
	if _dof and _attrs:
		_attrs.dof_blur_far_distance = _focus_distance() * 1.6
		_attrs.dof_blur_near_distance = _focus_distance() * 0.5

## Focus blur, on what the centre of the frame looks at.
func _toggle_focus() -> void:
	if not Flow.high_quality():
		_flash("Focus blur needs Full detail graphics")
		return
	_dof = not _dof
	if _dof:
		_attrs = CameraAttributesPractical.new()
		_attrs.dof_blur_far_enabled = true
		_attrs.dof_blur_near_enabled = true
		_attrs.dof_blur_amount = 0.12
		_attrs.dof_blur_far_transition = 30.0
		_attrs.dof_blur_near_transition = 1.0
		_cam.attributes = _attrs
	else:
		_cam.attributes = null
	_flash("Focus blur on" if _dof else "Focus blur off")

func _focus_distance() -> float:
	var from := _cam.global_position
	var to := from - _cam.global_basis.z * 5000.0
	var hit := _cam.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))
	return from.distance_to(hit.position) if not hit.is_empty() else 300.0

func _capture(to := "") -> void:
	var hint := _hint.visible
	_hint.visible = false
	_toast.visible = false
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	_hint.visible = hint
	_toast.visible = true
	var name := "Periapsis Zero %s.png" % Time.get_datetime_string_from_system().replace("T", " ").replace(":", "-")
	if to != "":
		img.save_png(to)
	elif Flow.on_web():
		JavaScriptBridge.download_buffer(img.save_png_to_buffer(), name, "image/png")
		_flash("Picture saved to your downloads")
	else:
		var dir := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES).path_join("Periapsis Zero")
		DirAccess.make_dir_recursive_absolute(dir)
		var ok := img.save_png(dir.path_join(name)) == OK
		_flash(("Saved to Pictures, Periapsis Zero") if ok else "Could not save the picture")
	Sfx.play("click", -2.0, 1.4)

func _ui() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 50
	add_child(_layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = Style.theme()
	_layer.add_child(root)
	_hint = Style.label("PHOTO MODE    Right drag  look    W A S D  move    Space / C  up, down    Shift  faster    Q / E  roll    Wheel  zoom    F  focus    Click  take the picture    H  hide    F2  back", 14, Style.BONE, Style.mono)
	_hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hint.offset_bottom = -28
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_hint)
	_toast = Style.label("", 20, Style.EMBER, Style.sans_bold)
	_toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast.offset_top = 40
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_toast)

func _flash(text: String) -> void:
	_toast.text = text
	_toast_t = 2.5
	_toast.modulate.a = 1.0
