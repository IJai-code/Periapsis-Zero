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
