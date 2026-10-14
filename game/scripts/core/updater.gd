extends Node
## Keeps a downloaded copy of the game current without downloading the app
## again.
##
## Each desktop release publishes, next to the apps, the game's data alone:
## a base pack (everything, published again only when the engine changes or
## the patches grow large) and a patch on that base (only the files that
## changed), with a manifest (update.json, written by scripts/godot-build.mjs).
## While the game runs this reads the manifest, downloads what this copy
## lacks into the user folder, checks each file's SHA-256 and keeps it.
## The next start uses it: the packs are mounted over the app's own before
## anything else loads (this is the first autoload, and it loads no other
## script), and the release's project settings come in through
## application/config/project_settings_override, which the engine reads at
## start. A release built on another engine version cannot be applied like
## that; then the title offers the new download instead.
##
## It also chooses the renderer, which can only change at start (the same
## override carries it). Forward+ is the full game; a weak PC gets the
## Compatibility renderer the browser build uses, which that PC runs well,
## with the same lighter content. Chosen in Settings (Graphics: Auto, Full
## detail, Performance); on Auto it falls back by itself when the graphics
## chip is integrated, when the last session never closed (a lock-up), or
## when the lowest quality tier still cannot hold the frame rate.

signal changed

## Where releases are published; `-- --update-url <url>` points a test copy
## at another manifest (its files are fetched from beside it).
const MANIFEST := "https://github.com/IJai-code/Periapsis-Zero/releases/download/desktop/update.json"
const DIR := "user://update"
const STATE := "user://update/state.cfg"
## Named in project.godot (template builds only): composed here from the
## release's settings and the renderer choice.
const OVERRIDE := "user://update/settings.cfg"
## The project settings of the release downloaded.
const RELEASE := "user://update/release.cfg"
## The renderer choice, and whether the last session closed.
const GRAPHICS := "user://graphics.cfg"
const LIGHT := "gl_compatibility"

enum { IDLE, CHECKING, DOWNLOADING, VERIFYING, READY, CURRENT, REINSTALL, FAILED }

var state := IDLE
## The newer release's date, for the title's notice.
var date := ""
## The build running now, with any update applied at start.
var running := 0
## The app's own build, as downloaded.
var _app := 0
var _manifest := {}
var _queue: Array = []
var _file := {}
var _total := 0
var _done := 0
var _http: HTTPRequest
var _hash: Thread
var _left := false

func _init() -> void:
	if not _desktop():
		return
	_graphics_start()
	if _enabled():
		_mount()
	_compose()

func _mount() -> void:
	_app = int(_read_json("res://build.json").get("build", 0))
	running = _app
	var cfg := ConfigFile.new()
	if cfg.load(STATE) != OK:
		_clear(false)
		return
	var build := int(cfg.get_value("update", "build", 0))
	var packs: PackedStringArray = cfg.get_value("update", "packs", PackedStringArray())
	# Only part-way: the files checked so far are kept for the next round.
	if build == 0:
		_clear(false)
		return
	# Downloaded for another copy of the app (a newer one installed since,
	# or an older one put back): not for this one.
	if build <= _app or int(cfg.get_value("update", "app", 0)) != _app or str(cfg.get_value("update", "engine", "")) != _engine():
		_clear(true)
		return
	for p in packs:
		if not FileAccess.file_exists(DIR.path_join(p)):
			_clear(true)
			return
	for p in packs:
		if not ProjectSettings.load_resource_pack(DIR.path_join(p), true):
			push_warning("Updater: could not mount %s" % p)
			_clear(true)
			return
	running = build
	print("Updater: running build %d on app build %d" % [build, _app])

func _ready() -> void:
	if not _desktop():
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	if _graphics_ready():
		return
	if not _enabled():
		return
	# After the title has loaded, so the check costs the start nothing.
	get_tree().create_timer(3.0, true, false, true).timeout.connect(_check)

## A desktop export, not the editor or the browser.
func _desktop() -> bool:
	return OS.has_feature("template") and OS.get_name() in ["macOS", "Windows", "Linux"]

## Updating, unless a test run says not to.
func _enabled() -> bool:
	return _desktop() and not "--noupdate" in OS.get_cmdline_user_args()

## How far the current download has got, 0 to 1, over all its files.
func progress() -> float:
	if _total <= 0:
		return 0.0
	var now := _http.get_downloaded_bytes() if _http and state == DOWNLOADING else 0
	return clampf(float(_done + now) / _total, 0.0, 1.0)

func download_size() -> int:
	return _total

## Start the game again on the downloaded release.
func restart() -> void:
	_leave()
	OS.create_instance(PackedStringArray())
	get_tree().quit()

## Close the session before another copy starts: the new copy must not
## read it as a crash, and this one must not touch the record once it has
## handed over.
func _leave() -> void:
	var g := _g()
	g.set_value("session", "open", false)
	g.save(GRAPHICS)
	_left = true

func _check() -> void:
	_to(CHECKING)
	var url := MANIFEST
	var args := OS.get_cmdline_user_args()
	var i := args.find("--update-url")
	if i >= 0 and i + 1 < args.size():
		url = args[i + 1]
	_http = HTTPRequest.new()
	_http.timeout = 20.0
	add_child(_http)
	_http.request_completed.connect(_on_manifest.bind(url), CONNECT_ONE_SHOT)
	if _http.request(url) != OK:
		_to(FAILED)

func _on_manifest(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, url: String) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_to(FAILED)
		return
	var m = JSON.parse_string(body.get_string_from_utf8())
	if typeof(m) != TYPE_DICTIONARY or not m.has("build") or not m.has("platforms"):
		_to(FAILED)
		return
	_manifest = m
	var build := int(m.build)
	date = str(m.get("date", ""))
	if build <= running:
		_to(CURRENT)
		return
	var plat: Dictionary = m.platforms.get(OS.get_name(), {})
	if str(m.get("engine", "")) != _engine() or plat.is_empty():
		_to(REINSTALL)
		return
	# Already downloaded, waiting for the next start?
	var cfg := ConfigFile.new()
	if cfg.load(STATE) == OK and int(cfg.get_value("update", "build", 0)) == build and int(cfg.get_value("update", "app", 0)) == _app:
		_to(READY)
		return
	# The base, unless this app is it; then the patch on it, if any.
	_queue = []
	if int(m.base) != _app:
		_queue.append(plat.base)
	if plat.get("patch") is Dictionary:
		_queue.append(plat.patch)
	if _queue.is_empty():
		_to(CURRENT)
		return
	_total = 0
	for f in _queue:
		f["url"] = url.get_base_dir().path_join(str(f.file))
		_total += int(f.size)
	DirAccess.make_dir_recursive_absolute(DIR)
	_next()

func _next() -> void:
	# Kept from an earlier, interrupted round: the base, already checked.
	while not _queue.is_empty() and _verified(_queue[0]):
		_done += int(_queue[0].size)
		_queue.pop_front()
	if _queue.is_empty():
		_finish()
		return
	_file = _queue.pop_front()
	_to(DOWNLOADING)
	_http.download_file = DIR.path_join(str(_file.file) + ".part")
	_http.use_threads = true
	_http.timeout = 0.0
	_http.body_size_limit = -1
	_http.request_completed.connect(_on_file, CONNECT_ONE_SHOT)
	if _http.request(str(_file.url)) != OK:
		_to(FAILED)

func _on_file(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		DirAccess.remove_absolute(DIR.path_join(str(_file.file) + ".part"))
		_to(FAILED)
		return
	_to(VERIFYING)
	_hash = Thread.new()
	_hash.start(_sha256.bind(DIR.path_join(str(_file.file) + ".part")))

func _process(_dt: float) -> void:
	if _hash and not _hash.is_alive():
		var sum: String = _hash.wait_to_finish()
		_hash = null
		var part := DIR.path_join(str(_file.file) + ".part")
		if sum != str(_file.sha256):
			push_warning("Updater: %s failed its checksum" % _file.file)
			DirAccess.remove_absolute(part)
			_to(FAILED)
			return
		DirAccess.rename_absolute(part, DIR.path_join(str(_file.file)))
		_mark_verified(_file)
		_done += int(_file.size)
		_next()

func _finish() -> void:
	var packs := PackedStringArray()
	if int(_manifest.base) != _app:
		packs.append(str(_manifest.platforms[OS.get_name()].base.file))
	var patch = _manifest.platforms[OS.get_name()].get("patch")
	if patch is Dictionary:
		packs.append(str(patch.file))
	# The settings first: a state without them would mount the packs on the
	# old settings; settings without a state are cleared at the next start.
	var f := FileAccess.open(RELEASE, FileAccess.WRITE)
	if f == null:
		_to(FAILED)
		return
	f.store_string(str(_manifest.get("settings", "")))
	f.close()
	var cfg := ConfigFile.new()
	cfg.load(STATE)
	cfg.set_value("update", "build", int(_manifest.build))
	cfg.set_value("update", "date", date)
	cfg.set_value("update", "app", _app)
	cfg.set_value("update", "engine", _engine())
	cfg.set_value("update", "packs", packs)
	cfg.save(STATE)
	_compose()
	# Whatever else is in the folder is from an older round.
	var keep := [STATE.get_file(), OVERRIDE.get_file(), RELEASE.get_file()]
	for name in DirAccess.get_files_at(DIR):
		if not name in packs and not name in keep:
			DirAccess.remove_absolute(DIR.path_join(name))
	_to(READY)
	print("Updater: build %d downloaded" % int(_manifest.build))

func _verified(f: Dictionary) -> bool:
	var cfg := ConfigFile.new()
	return FileAccess.file_exists(DIR.path_join(str(f.file))) and cfg.load(STATE) == OK \
		and str(cfg.get_value("verified", str(f.file), "")) == str(f.sha256)

func _mark_verified(f: Dictionary) -> void:
	var cfg := ConfigFile.new()
	cfg.load(STATE)
	cfg.set_value("verified", str(f.file), str(f.sha256))
	cfg.save(STATE)

## Forget a downloaded release (and with `files`, delete it): it is not for
## this copy of the app. The settings it brought go with it.
func _clear(files: bool) -> void:
	if FileAccess.file_exists(RELEASE):
		DirAccess.remove_absolute(RELEASE)
	if files and DirAccess.dir_exists_absolute(DIR):
		for name in DirAccess.get_files_at(DIR):
			DirAccess.remove_absolute(DIR.path_join(name))

func _to(s: int) -> void:
	state = s
	changed.emit()

# --- The renderer ------------------------------------------------------------

## The renderer can be chosen: a desktop export.
func graphics_available() -> bool:
	return _desktop()

## "auto", "full" or "light".
func graphics_mode() -> String:
	return str(_g().get_value("graphics", "mode", "auto"))

## Why Auto chose the light renderer ("gpu", "crash", "frame rate"), or "".
func light_reason() -> String:
	return str(_g().get_value("graphics", "fallback", ""))

## Why Auto turned to the light renderer, the first time the title asks
## after it did (then ""), so the player is told once.
func take_notice() -> String:
	var r := light_reason()
	if not _desktop() or not is_light() or graphics_mode() != "auto" or r == "":
		return ""
	var g := _g()
	if str(g.get_value("graphics", "told", "")) == r:
		return ""
	g.set_value("graphics", "told", r)
	g.save(GRAPHICS)
	return r

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
	g.save(GRAPHICS)
	_compose()
	changed.emit()
	return _wants_light() != is_light()

## On Auto, the full renderer could not keep up: the light one from the
## next start. True when this changed anything.
func request_light(reason: String) -> bool:
	if not _desktop() or is_light() or graphics_mode() != "auto" or light_reason() != "":
		return false
	var g := _g()
	g.set_value("graphics", "fallback", reason)
	g.save(GRAPHICS)
	_compose()
	changed.emit()
	return true

func _wants_light() -> bool:
	var mode := graphics_mode()
	return mode == "light" or (mode == "auto" and light_reason() != "")

func _g() -> ConfigFile:
	var g := ConfigFile.new()
	g.load(GRAPHICS)
	return g

## At start, before anything renders: a session that never closed was a
## lock-up or a crash, and on the full renderer that means the light one.
func _graphics_start() -> void:
	var g := _g()
	if bool(g.get_value("session", "open", false)) and str(g.get_value("session", "renderer", "")) != LIGHT \
			and graphics_mode() == "auto" and light_reason() == "":
		g.set_value("graphics", "fallback", "crash")
		g.save(GRAPHICS)

## Once the renderer is up: on Auto, an integrated graphics chip (an Apple
## one excepted: those run the full game well) goes light. If the running
## renderer is not the one wanted, start again on the right one, once (a
## renderer that will not start must not loop). True when restarting.
func _graphics_ready() -> bool:
	var g := _g()
	var method := RenderingServer.get_current_rendering_method()
	if method != LIGHT and graphics_mode() == "auto" and light_reason() == "" and _weak_gpu():
		g.set_value("graphics", "fallback", "gpu")
		g.save(GRAPHICS)
		_compose()
	var want := LIGHT if _wants_light() else "forward_plus"
	var tried := str(g.get_value("session", "restarted_for", ""))
	if (method == LIGHT) != (want == LIGHT) and tried != want:
		print("Updater: restarting on %s (%s)" % [want, light_reason()])
		g.set_value("session", "restarted_for", want)
		g.save(GRAPHICS)
		_leave()
		OS.create_instance(PackedStringArray())
		get_tree().quit()
		return true
	g.set_value("session", "restarted_for", "")
	g.set_value("session", "open", true)
	g.set_value("session", "renderer", method)
	g.set_value("session", "adapter", RenderingServer.get_video_adapter_name())
	g.save(GRAPHICS)
	print("Updater: renderer %s on %s" % [method, RenderingServer.get_video_adapter_name()])
	return false

func _weak_gpu() -> bool:
	# For testing the light path on a strong machine.
	if "--weak-gpu" in OS.get_cmdline_user_args():
		return true
	var vendor := (RenderingServer.get_video_adapter_vendor() + " " + RenderingServer.get_video_adapter_name()).to_lower()
	if "apple" in vendor:
		return false
	return RenderingServer.get_video_adapter_type() in [RenderingDevice.DEVICE_TYPE_INTEGRATED_GPU,
		RenderingDevice.DEVICE_TYPE_CPU, RenderingDevice.DEVICE_TYPE_VIRTUAL_GPU, RenderingDevice.DEVICE_TYPE_OTHER]

## A clean exit: the session closed.
func _notification(what: int) -> void:
	if (what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_EXIT_TREE) and _desktop() and not _left:
		var g := _g()
		if bool(g.get_value("session", "open", false)):
			g.set_value("session", "open", false)
			g.save(GRAPHICS)

## The override the engine reads at the next start: the downloaded
## release's settings, then the renderer.
func _compose() -> void:
	if not _desktop():
		return
	var text := FileAccess.get_file_as_string(RELEASE) if FileAccess.file_exists(RELEASE) else ""
	if _wants_light():
		text += "\n[rendering]\n\nrenderer/rendering_method=\"%s\"\n" % LIGHT
	if text.strip_edges().is_empty():
		if FileAccess.file_exists(OVERRIDE):
			DirAccess.remove_absolute(OVERRIDE)
		return
	DirAccess.make_dir_recursive_absolute(DIR)
	var f := FileAccess.open(OVERRIDE, FileAccess.WRITE)
	if f:
		f.store_string(text)

static func _sha256(path: String) -> String:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	while f.get_position() < f.get_length():
		ctx.update(f.get_buffer(1 << 20))
	return ctx.finish().hex_encode()

static func _engine() -> String:
	var v := Engine.get_version_info()
	return "%d.%d.%d.%s" % [v.major, v.minor, v.patch, v.status]

static func _read_json(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var d = JSON.parse_string(f.get_as_text())
	return d if d is Dictionary else {}
