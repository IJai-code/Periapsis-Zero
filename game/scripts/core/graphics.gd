extends Node
## The renderer, chosen per PC. Forward+ is the full game; a weak PC gets
## the Compatibility renderer the browser build uses (through ANGLE on
## Windows, as browsers do), with the same lighter content and quality
## tiers. Settings, Graphics: Auto, Full detail or Performance. On Auto it
## turns light by itself when the graphics chip is integrated, when the
## last session never closed (a lock-up or a crash), or when the lowest
## quality tier still cannot hold the frame rate (Flow).
##
## The renderer can only change at start, so the choice is written onto the
## end of the settings override the engine reads then (the file the updater
## keeps the downloaded release's settings in), and when it differs from
## the running one the game starts again, once.
##
## An autoload after the updater, so it comes from the mounted release and
## improves with updates (the updater itself never does).

const OVERRIDE := "user://update/settings.cfg"
const STATE := "user://graphics.cfg"
const LIGHT := "gl_compatibility"
## Where this script's part of the override starts.
const MARK := "; The renderer (scripts/core/graphics.gd)"

var _left := false

func _ready() -> void:
	if not available():
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	var g := _g()
	var method := RenderingServer.get_current_rendering_method()
	var auto_free := graphics_mode() == "auto" and light_reason() == "" and method != LIGHT
	# A session that never closed, its process gone: a lock-up or a crash.
	var pid := int(g.get_value("session", "pid", 0))
	if auto_free and bool(g.get_value("session", "open", false)) and str(g.get_value("session", "renderer", "")) != LIGHT \
			and pid != OS.get_process_id() and (pid == 0 or not OS.is_process_running(pid)):
		g.set_value("graphics", "fallback", "crash")
	elif auto_free and _weak_gpu():
		g.set_value("graphics", "fallback", "gpu")
	g.save(STATE)
	compose()
	var want_light := _wants_light()
	var tried := str(g.get_value("session", "restarted_for", ""))
	var want := LIGHT if want_light else "forward_plus"
	if (method == LIGHT) != want_light and tried != want:
		print("Graphics: restarting on %s (%s)" % [want, light_reason()])
		g.set_value("session", "restarted_for", want)
		g.save(STATE)
		restart()
		return
	g.set_value("session", "restarted_for", "")
	g.set_value("session", "open", true)
	g.set_value("session", "pid", OS.get_process_id())
	g.set_value("session", "renderer", method)
	g.set_value("session", "adapter", RenderingServer.get_video_adapter_name())
	g.save(STATE)
	print("Graphics: %s on %s" % [method, RenderingServer.get_video_adapter_name()])

## A desktop export: the editor and the browser have their renderer fixed.
func available() -> bool:
	return OS.has_feature("template") and OS.get_name() in ["macOS", "Windows", "Linux"]

## "auto", "full" or "light".
func graphics_mode() -> String:
	return str(_g().get_value("graphics", "mode", "auto"))

## Why Auto chose the light renderer ("gpu", "crash", "frame rate"), or "".
func light_reason() -> String:
	return str(_g().get_value("graphics", "fallback", ""))

## The renderer running now is the light one.
func is_light() -> bool:
	return RenderingServer.get_current_rendering_method() == LIGHT

## Choose the renderer; true when it differs from the one running, so the
## game must start again to use it. Choosing Auto again clears its fallback.
func set_graphics_mode(mode: String) -> bool:
	var g := _g()
	g.set_value("graphics", "mode", mode)
	if mode == "auto":
		g.set_value("graphics", "fallback", "")
	g.save(STATE)
	compose()
	return _wants_light() != is_light()

## On Auto, the full renderer could not keep up: the light one from the
## next start. True when this changed anything.
func request_light(reason: String) -> bool:
	if not available() or is_light() or graphics_mode() != "auto" or light_reason() != "":
		return false
	var g := _g()
	g.set_value("graphics", "fallback", reason)
	g.save(STATE)
	compose()
	return true

## Why Auto turned to the light renderer, the first time the title asks
## after it did (then ""), so the player is told once.
func take_notice() -> String:
	var r := light_reason()
	if not available() or not is_light() or graphics_mode() != "auto" or r == "":
		return ""
	var g := _g()
	if str(g.get_value("graphics", "told", "")) == r:
		return ""
	g.set_value("graphics", "told", r)
	g.save(STATE)
	return r

## Start the game again (on whatever the override now says). The session
## is closed first: the new copy must not read it as a crash, and this one
## must not touch the record once it has handed over.
func restart() -> void:
	_close()
	_left = true
	OS.create_instance(PackedStringArray())
	get_tree().quit()

## The override for the next start: whatever the updater put there (the
## release's settings) without this script's old part, then the renderer.
func compose() -> void:
	if not available():
		return
	var text := FileAccess.get_file_as_string(OVERRIDE) if FileAccess.file_exists(OVERRIDE) else ""
	var at := text.find(MARK)
	if at >= 0:
		text = text.substr(0, at)
	if _wants_light():
		text += "\n%s\n[rendering]\n\nrenderer/rendering_method=\"%s\"\n" % [MARK, LIGHT]
	if text.strip_edges().is_empty():
		if FileAccess.file_exists(OVERRIDE):
			DirAccess.remove_absolute(OVERRIDE)
		return
	DirAccess.make_dir_recursive_absolute(OVERRIDE.get_base_dir())
	var f := FileAccess.open(OVERRIDE, FileAccess.WRITE)
	if f:
		f.store_string(text)

func _wants_light() -> bool:
	var mode := graphics_mode()
	return mode == "light" or (mode == "auto" and light_reason() != "")

func _g() -> ConfigFile:
	var g := ConfigFile.new()
	g.load(STATE)
	return g

func _weak_gpu() -> bool:
	# For testing the light path on a strong machine.
	if "--weak-gpu" in OS.get_cmdline_user_args():
		return true
	var who := (RenderingServer.get_video_adapter_vendor() + " " + RenderingServer.get_video_adapter_name()).to_lower()
	# Apple's chips are integrated and run the full game well.
	if "apple" in who:
		return false
	return RenderingServer.get_video_adapter_type() in [RenderingDevice.DEVICE_TYPE_INTEGRATED_GPU,
		RenderingDevice.DEVICE_TYPE_CPU, RenderingDevice.DEVICE_TYPE_VIRTUAL_GPU, RenderingDevice.DEVICE_TYPE_OTHER]

## A clean exit closes this copy's session (not a later copy's).
func _notification(what: int) -> void:
	if (what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_EXIT_TREE) and available() and not _left:
		_close()

func _close() -> void:
	var g := _g()
	if int(g.get_value("session", "pid", 0)) == OS.get_process_id() and bool(g.get_value("session", "open", false)):
		g.set_value("session", "open", false)
		g.save(STATE)
