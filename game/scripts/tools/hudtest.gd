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
	# 3. A new objective while the last one's banner is still fading.
	Hud.objective("one")
	await get_tree().create_timer(4.6).timeout
	Hud.objective("two")
	await get_tree().create_timer(0.8).timeout
	fails += _check("banner over a fading banner", Hud._obj_big.modulate.a > 0.9)
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
	Report.line("HUDTEST %d failed" % fails)
	get_tree().quit()

func _check(name: String, ok: bool) -> int:
	Report.line("HUDTEST %s %s" % ["ok  " if ok else "FAIL", name])
	return 0 if ok else 1
