extends Node
## Verification capture: `godot --path game -- --shot out.png [--frames N]`
## renders N frames (default 120), saves the screen to out.png and quits.

var _path := ""
var _left := -1
var _at := -1.0
var _t := 0.0

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--shot")
	if i < 0 or i + 1 >= args.size():
		return
	_path = args[i + 1]
	var f := args.find("--frames")
	_left = int(args[f + 1]) if f >= 0 and f + 1 < args.size() else 120
	# Or at a moment in time: `--at 7.5` (seconds of game time since start).
	var a := args.find("--at")
	if a >= 0 and a + 1 < args.size():
		_at = float(args[a + 1])
		_left = 1 << 30

func _process(_dt: float) -> void:
	if _left < 0:
		return
	_t += _dt
	if _at >= 0.0 and _t >= _at:
		_left = 1
	_left -= 1
	if _left == 0:
		_left = -1
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_path)
		print("shot: ", _path)
		get_tree().quit()
