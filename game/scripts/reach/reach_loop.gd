class_name ReachLoop
extends Node
## Twenty-two minutes. The Lantern reddens as the loop goes on, stutters
## from 20:00, and at 22:00 collapses into Periapsis Zero: its pull spikes,
## everything falls toward it, the light goes blue-white, and you wake at
## the campfire, the same morning. Dying ends the loop early.

signal woke(loop: int, first: bool)
signal collapsing

const FLICKER_AT := 1200.0
const SONG_AT := 1262.0

var reach: Node
var loops := 0
var ending := false
var _song_started := false
var _warp: ColorRect
var _warp_mat: ShaderMaterial

func _ready() -> void:
	loops = int(Flow.progress("reach_loops", 0))
	var layer := CanvasLayer.new()
	layer.layer = 5
	add_child(layer)
	_warp = ColorRect.new()
	_warp.set_anchors_preset(Control.PRESET_FULL_RECT)
	_warp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_warp_mat = ShaderMaterial.new()
	_warp_mat.shader = load("res://shaders/reach/warp.gdshader")
	_warp.material = _warp_mat
	_warp.visible = false
	layer.add_child(_warp)

## The last minute and a half: the view bends toward the Lantern.
func _bend(t: float) -> void:
	var k := smoothstep(SONG_AT - 30.0, ReachSystem.LOOP, t) * 0.85
	if reach.finished:
		k = 0.0
	_warp.visible = k > 0.01
	if not _warp.visible:
		return
	_warp_mat.set_shader_parameter("amount", k + (reach.lantern.collapse as float) * 0.6)
	var cam := get_viewport().get_camera_3d()
	var star: Vector3 = reach.system.world("lantern")
	var c := Vector2(0.5, 0.5)
	if cam and not cam.is_position_behind(star):
		c = cam.unproject_position(star) / get_viewport().get_visible_rect().size
	_warp_mat.set_shader_parameter("center", c.clamp(Vector2(-0.5, -0.5), Vector2(1.5, 1.5)))

func _process(_dt: float) -> void:
	if not reach:
		return
	_bend((reach.system as ReachSystem).t)
	if ending:
		return
	var sys: ReachSystem = reach.system
	var t := sys.t
	var lan: Lantern = reach.lantern
	lan.heat = clampf(t / ReachSystem.LOOP, 0.0, 1.0) * 0.85
	lan.flicker = smoothstep(FLICKER_AT, ReachSystem.LOOP, t)
	if t >= SONG_AT and not _song_started:
		_song_started = true
		collapsing.emit()
	if t >= ReachSystem.LOOP:
		_collapse()

## The end of the loop: the Lantern falls in on itself, and then goes: a
## shell of light races out through the Reach. When it reaches you, white;
## the loop's memories rush past backwards; you wake.
func _collapse() -> void:
	ending = true
	var sys: ReachSystem = reach.system
	var hud: ReachHud = reach.hud
	var lan: Lantern = reach.lantern
	Sfx.play("big", 0.0, 0.5)
	var t := create_tween()
	t.tween_property(lan, "collapse", 1.0, 3.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	t.parallel().tween_property(sys, "pull", 600.0, 3.6).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	await get_tree().create_timer(3.2).timeout
	# Periapsis Zero: a flash, and the shell.
	lan.nova()
	Sfx.play("warp", 0.0, 0.5)
	Sfx.play("big", 2.0, 0.35)
	hud.fade_to(Color(0.85, 0.93, 1.0, 0.55), 0.12)
	await get_tree().create_timer(0.15).timeout
	hud.fade_to(Color(0.85, 0.93, 1.0, 0.0), 0.8)
	# Until it is on you (or long enough: from far out, it still comes).
	var waited := 0.0
	while waited < 9.0:
		var cam := get_viewport().get_camera_3d()
		var d := cam.global_position.distance_to(sys.world("lantern")) if cam else 0.0
		if lan.nova_r >= d - 150.0:
			break
		await get_tree().process_frame
		waited += get_process_delta_time()
	await hud.fade_to(Color(0.85, 0.93, 1.0, 1.0), 0.35)
	await _remember()
	wake("collapse")

## Death: the light goes white, the memories, and you wake.
func die(cause: String) -> void:
	if ending:
		return
	ending = true
	Report.line("LOOP ended: %s at %.0f s" % [cause, (reach.system as ReachSystem).t])
	var hud: ReachHud = reach.hud
	var words := {"impact": "You hit the ground too hard.", "suffocation": "Your air ran out.", "crash": "Your ship broke apart.",
		"lantern": "You flew into the star.", "drones": "Rook's drones found you."}
	Sfx.play("big", -6.0, 0.8)
	await hud.fade_to(Color(1.0, 1.0, 1.0, 1.0), 1.4)
	hud.caption(words.get(cause, ""), 2.5)
	await get_tree().create_timer(1.6).timeout
	await _remember()
	wake(cause)

## The loop's pictures, backwards, into the light (skipped by checks).
func _remember() -> void:
	var mem: Memories = reach.memories
	if not mem or Reach._testing(OS.get_cmdline_user_args()):
		return
	await mem.play()
	mem.clear()

## Wake at the campfire: the loop begins again. Dying fades out first; a
## collapse has already gone white. Then the morning itself (Wake): lying
## with your eyes shut, the lids opening on the sky, sitting up, standing.
func wake(cause := "") -> void:
	loops += 1
	Flow.set_progress("reach_loops", loops)
	var first := loops == 1 and cause == ""
	ending = false
	_song_started = false
	var hud: ReachHud = reach.hud
	await hud.fade_to(Color(0, 0, 0, 1), 0.4 if cause != "" else 0.0)
	reach.reset_loop()
	await get_tree().create_timer(0.5).timeout
	var w := Wake.new()
	w.reach = reach
	reach.add_child(w)
	await w.morning(first)
	woke.emit(loops, first)
