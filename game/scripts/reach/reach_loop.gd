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

func _ready() -> void:
	loops = int(Flow.progress("reach_loops", 0))

func _process(_dt: float) -> void:
	if ending or not reach:
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

## The end of the loop: the Lantern falls in on itself and takes you with it.
func _collapse() -> void:
	ending = true
	var sys: ReachSystem = reach.system
	var hud: ReachHud = reach.hud
	var lan: Lantern = reach.lantern
	Sfx.play("big", 0.0, 0.5)
	var t := create_tween()
	t.tween_property(lan, "collapse", 1.0, 3.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	t.parallel().tween_property(sys, "pull", 600.0, 3.6).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	await get_tree().create_timer(3.0).timeout
	await hud.fade_to(Color(0.85, 0.93, 1.0, 1.0), 0.9)
	wake("collapse")

## Death: the light goes white and you wake.
func die(cause: String) -> void:
	if ending:
		return
	ending = true
	Report.line("LOOP ended: %s at %.0f s" % [cause, (reach.system as ReachSystem).t])
	var hud: ReachHud = reach.hud
	var words := {"impact": "You hit the ground too hard.", "suffocation": "Your air ran out.", "crash": "The Kestrel broke apart.",
		"lantern": "You fell into the Lantern.", "drones": "Rook's drones found you."}
	Sfx.play("big", -6.0, 0.8)
	await hud.fade_to(Color(1.0, 1.0, 1.0, 1.0), 1.4)
	hud.caption(words.get(cause, ""), 2.5)
	await get_tree().create_timer(1.8).timeout
	wake(cause)

## Wake at the campfire: the loop begins again.
func wake(cause := "") -> void:
	loops += 1
	Flow.set_progress("reach_loops", loops)
	var first := loops == 1 and cause == ""
	ending = false
	_song_started = false
	var hud: ReachHud = reach.hud
	await hud.fade_to(Color(0, 0, 0, 1), 0.4 if cause != "" else 0.0)
	reach.reset_loop()
	await get_tree().create_timer(0.8).timeout
	# Eyes opening: open, a slow blink, open.
	var p: Explorer = reach.player
	p.enabled = false
	p.set_pitch(1.05)
	await hud.fade_to(Color(0, 0, 0, 0.35), 1.2)
	await hud.fade_to(Color(0, 0, 0, 0.95), 0.25)
	await hud.fade_to(Color(0, 0, 0, 0.0), 1.0)
	var tw := create_tween()
	tw.tween_method(func(k: float): p.set_pitch(k), 1.05, 0.05, 2.2).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await tw.finished
	p.enabled = true
	woke.emit(loops, first)
