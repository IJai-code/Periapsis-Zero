class_name Report
## Test output that survives a hung exit: each line is printed and, when
## the run was given `--result <file>`, appended to that file at once.

static func line(text: String) -> void:
	print(text)
	var args := OS.get_cmdline_user_args()
	var i := args.find("--result")
	if i < 0 or i + 1 >= args.size():
		return
	var f := FileAccess.open(args[i + 1], FileAccess.READ_WRITE if FileAccess.file_exists(args[i + 1]) else FileAccess.WRITE)
	if f:
		f.seek_end()
		f.store_line(text)
		f.close()

## Let audio's mix thread release stopped playback before quitting a test.
## Immediate quit while MP3 playback is active leaks it during engine teardown.
static func finish(tree: SceneTree, code := 0) -> void:
	var flow := tree.root.get_node("Flow")
	if is_instance_valid(flow._music):
		var playback: AudioStreamPlayback = flow._music.get_stream_playback() if flow._music.playing else null
		if playback:
			playback.stop()
		flow._music.stop()
		flow._music.stream = null
		flow._music.queue_free()
	await tree.create_timer(0.5, true, false, true).timeout
	tree.quit(code)
