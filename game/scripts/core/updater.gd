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
## This script is never itself updated: it runs from the app as downloaded,
## before anything is mounted. Keep it small and put anything that should
## improve with releases elsewhere (the renderer choice is graphics.gd).

signal changed

## Where releases are published; `-- --update-url <url>` points a test copy
## at another manifest (its files are fetched from beside it).
const MANIFEST := "https://github.com/IJai-code/Periapsis-Zero/releases/download/desktop/update.json"
const DIR := "user://update"
const STATE := "user://update/state.cfg"
## Named in project.godot (template builds only): the downloaded
## release's settings; graphics.gd adds the renderer to the end.
const OVERRIDE := "user://update/settings.cfg"

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

func _init() -> void:
	if _enabled():
		_mount()

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
	OS.create_instance(PackedStringArray())
	get_tree().quit()

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
	var f := FileAccess.open(OVERRIDE, FileAccess.WRITE)
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
	# The renderer choice goes back on the end of the settings.
	var graphics := get_node_or_null("/root/Graphics")
	if graphics:
		graphics.compose()
	# Whatever else is in the folder is from an older round.
	var keep := [STATE.get_file(), OVERRIDE.get_file()]
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
	if FileAccess.file_exists(OVERRIDE):
		DirAccess.remove_absolute(OVERRIDE)
	if files and DirAccess.dir_exists_absolute(DIR):
		for name in DirAccess.get_files_at(DIR):
			DirAccess.remove_absolute(DIR.path_join(name))

func _to(s: int) -> void:
	state = s
	changed.emit()

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
