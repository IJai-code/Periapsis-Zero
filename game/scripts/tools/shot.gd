extends Node
## Verification capture: `godot --path game -- --shot out.png [--frames N]`
## renders N frames (default 120), saves the screen to out.png and quits.

var _path := ""
var _left := -1
var _at := -1.0
var _t := 0.0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
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

var _frames := 0
var _slow := 0
var _worst := 0.0

func _process(_dt: float) -> void:
	if _left < 0:
		return
	_t += _dt
	# Frame times after the first two seconds (loading is not lag).
	if _t > 2.0:
		_frames += 1
		_worst = maxf(_worst, _dt)
		if _dt > 1.0 / 40.0:
			_slow += 1
	if _at >= 0.0 and _t >= _at:
		_left = 1
	_left -= 1
	if _left == 0:
		_left = -1
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_path)
		Report.line("shot: " + _path)
		if _frames > 0:
			Report.line("FPS avg %.0f, worst frame %.0f ms, %d of %d frames slower than 40 fps" % [_frames / maxf(_t - 2.0, 0.01), _worst * 1000.0, _slow, _frames])
			Report.line("PERF process %.1f ms, physics %.1f ms, %d draw calls, %d k primitives, 3D scale %.2f" % [
				Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
				Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000,
				get_viewport().scaling_3d_scale])
		Report.finish(get_tree())
