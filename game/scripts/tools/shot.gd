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
	process_priority = -100000
	_last = Node.new()
	_last.process_priority = 100000
	_last.set_script(_EndTimer)
	_last.set_meta("shot", self)
	add_child(_last)
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	var f := args.find("--frames")
	_left = int(args[f + 1]) if f >= 0 and f + 1 < args.size() else 120
	# Or at a moment in time: `--at 7.5` (seconds of game time since start).
	var a := args.find("--at")
	if a >= 0 and a + 1 < args.size():
		_at = float(args[a + 1])
		_left = 1 << 30

var _frames := 0
## Every node's _process this frame, timed between this autoload (first:
## lowest priority number) and a node that runs last.
var _script_ms := 0.0
var _t0 := 0
var _last: Node
var _slow := 0
var _worst := 0.0

func _process(_dt: float) -> void:
	if _left < 0:
		return
	_t0 = Time.get_ticks_usec()
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
		# Headless (the check suite): nothing is drawn, so nothing to wait
		# for and nothing to save.
		var drawn := DisplayServer.get_name() != "headless"
		if drawn:
			await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image() if drawn else null
		if img:
			img.save_png(_path)
		Report.line("shot: " + _path + ("" if img else " (headless, not drawn)"))
		if _frames > 0:
			var vp := get_viewport().get_viewport_rid()
			Report.line("RENDER cpu %.1f ms, gpu %.1f ms; scripts %.1f ms (process callbacks), physics %.1f ms" % [
				RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu(),
				RenderingServer.viewport_get_measured_render_time_gpu(vp), _script_ms, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0])
			Report.line("FPS avg %.0f, worst frame %.0f ms, %d of %d frames slower than 40 fps" % [_frames / maxf(_t - 2.0, 0.01), _worst * 1000.0, _slow, _frames])
			Report.line("PERF process %.1f ms, physics %.1f ms, %d draw calls, %d k primitives, 3D scale %.2f" % [
				Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
				Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000,
				get_viewport().scaling_3d_scale])
		Report.finish(get_tree())

func _end_of_process() -> void:
	if _t > 2.0:
		_script_ms = lerpf(_script_ms, (Time.get_ticks_usec() - _t0) / 1000.0, 0.05)

const _EndTimer := preload("res://scripts/tools/shot_end.gd")
