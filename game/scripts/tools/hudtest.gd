extends Node
## HUD checks, `-- --hudtest`: the sequences that used to leave text
## invisible, each followed by a check that the text is on screen.

func _ready() -> void:
	if "--pausemenu" in OS.get_cmdline_user_args():
		await get_tree().create_timer(2.0).timeout
		Hud.pause(true)
		return
	if not "--hudtest" in OS.get_cmdline_user_args():
		return
	await get_tree().create_timer(1.5).timeout
	var fails := 0
	# 1. A prompt shown just after another is cleared.
	Hud.prompt("first")
	Hud.clear_prompt()
	Hud.prompt("second")
	await get_tree().create_timer(1.0).timeout
	fails += _check("prompt after clear", Hud._help.modulate.a > 0.9 and Hud._help_text.text.contains("second") and Hud._play_ui.modulate.a > 0.9)
	# 2. An objective set during a cutscene shows after it.
	Hud.objective("before")
	Hud.letterbox(true)
	await get_tree().create_timer(0.3).timeout
	Hud.objective("during")
	await get_tree().create_timer(0.3).timeout
	Hud.letterbox(false)
	await get_tree().create_timer(1.0).timeout
	fails += _check("objective after cutscene", Hud._obj_small.modulate.a > 0.9 and Hud._play_ui.modulate.a > 0.9 and Hud._obj_text.text.contains("during"))
	# 3. A new objective straight after another: the corner shows the new
	# one, and nothing is announced across the middle of the screen.
	Hud.objective("one")
	await get_tree().create_timer(0.4).timeout
	Hud.objective("two")
	await get_tree().create_timer(0.8).timeout
	fails += _check("new objective replaces the last", Hud._obj_small.modulate.a > 0.9 and Hud._obj_text.text.contains("two") and Hud._obj_big.modulate.a < 0.05)
	# 4. A prompt shown during a cutscene appears when it ends.
	Hud.letterbox(true)
	Hud.prompt("cut")
	await get_tree().create_timer(0.3).timeout
	Hud.letterbox(false)
	await get_tree().create_timer(0.8).timeout
	fails += _check("prompt from a cutscene", Hud._help.modulate.a > 0.9 and Hud._play_ui.modulate.a > 0.9)
	# 5. Subtitles after silence.
	Hud.say("Mara Voss", "one")
	Hud.silence()
	Hud.say("Mara Voss", "two")
	await get_tree().create_timer(0.8).timeout
	fails += _check("subtitle after silence", Hud._sub.modulate.a > 0.9 and Hud._sub.text.contains("two"))
	# 6. A caller waiting on a line that is cut returns then, not when its
	# timer would have ended (scripts await lines in order).
	Hud.silence()
	var out := {"at": -1}
	_wait_say(out)
	await get_tree().create_timer(0.3).timeout
	var cut := Time.get_ticks_msec()
	Hud.silence()
	await get_tree().create_timer(0.2).timeout
	fails += _check("caller released by silence", out.at >= cut and out.at - cut < 150)
	Report.line("HUDTEST %d failed" % fails)
	Report.finish(get_tree())

func _wait_say(out: Dictionary) -> void:
	await Hud.say("Mara Voss", "a long line that is cut", 6.0)
	out.at = Time.get_ticks_msec()

func _check(name: String, ok: bool) -> int:
	Report.line("HUDTEST %s %s" % ["ok  " if ok else "FAIL", name])
	return 0 if ok else 1
