extends Node
## Bakes the space panoramas: `godot --path game res://scenes/sky_bake.tscn
## -- --stars <NASA starmap .exr> --out art/sky`. Writes space-<name>.jpg
## (2048 x 1024), one per part of space, each with its own nebula colours.
## Run on a machine with a GPU; the result is committed, not built at load.

const REGIONS := {
	# Harbor orbit, the prologue: blue-violet with a magenta heart.
	"harbor": [Color(0.32, 0.22, 0.95), Color(0.95, 0.28, 0.62), Color(0.25, 0.65, 1.0), Vector3(0.6, 0.25, 0.75), 1.0],
	# Hearth, L1: teal and gold.
	"hearth": [Color(0.12, 0.62, 0.72), Color(0.95, 0.62, 0.25), Color(0.35, 0.85, 0.75), Vector3(-0.7, 0.3, -0.6), 2.0],
	# The Aster's grave: embers and rust.
	"field": [Color(0.75, 0.18, 0.12), Color(1.0, 0.5, 0.18), Color(0.45, 0.25, 0.75), Vector3(0.5, -0.1, -0.85), 3.0],
}

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var src: String = args[args.find("--stars") + 1]
	var out: String = args[args.find("--out") + 1]
	var img := Image.load_from_file(src)
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	for name in REGIONS:
		var r: Array = REGIONS[name]
		var vp := SubViewport.new()
		vp.size = Vector2i(2048, 1024)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		var rect := ColorRect.new()
		rect.size = Vector2(2048, 1024)
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/sky_bake.gdshader")
		m.set_shader_parameter("stars", tex)
		m.set_shader_parameter("col_a", r[0])
		m.set_shader_parameter("col_b", r[1])
		m.set_shader_parameter("col_c", r[2])
		m.set_shader_parameter("focus", r[3])
		m.set_shader_parameter("seed", r[4])
		rect.material = m
		vp.add_child(rect)
		add_child(vp)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var shot := vp.get_texture().get_image()
		var path := "%s/space-%s.jpg" % [out, name]
		shot.save_jpg(ProjectSettings.globalize_path("res://" + path) if not path.begins_with("/") else path, 0.92)
		print("sky: ", path)
		vp.queue_free()
	get_tree().quit()
