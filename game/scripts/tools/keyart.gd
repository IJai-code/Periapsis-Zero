extends Node3D
## Stills for the site, rendered off-screen at full size whatever the
## window is:
##   godot --path game res://scenes/keyart.tscn -- --keyart hero --out x.png
## Shots: hero (the Kestrel over Earth, the convoy behind), convoy (the
## Aster under escort), raid (the Hollow coming in).

const SIZE := Vector2i(2400, 1350)

var _view: SubViewport
var _frames := 0
var _out := ""

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--keyart")
	var shot: String = args[i + 1] if i >= 0 and i + 1 < args.size() else "hero"
	var o := args.find("--out")
	_out = args[o + 1] if o >= 0 and o + 1 < args.size() else "user://keyart.png"
	_view = SubViewport.new()
	_view.size = SIZE
	_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_view.msaa_3d = Viewport.MSAA_4X
	_view.use_taa = true
	_view.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	add_child(_view)
	var cam := Camera3D.new()
	cam.far = 120_000.0
	cam.near = 0.2
	_view.add_child(cam)
	match shot:
		"convoy": _convoy(cam)
		"raid": _raid(cam)
		_: _hero(cam)

func _process(_dt: float) -> void:
	_frames += 1
	if _frames == 90:
		await RenderingServer.frame_post_draw
		_view.get_texture().get_image().save_png(_out)
		print("keyart: ", _out)
		get_tree().quit()

func _hero(cam: Camera3D) -> void:
	var sun := Vector3(0.6, 0.4, 0.45)
	Space.environment(_view, sun, 1.05, "field")
	_view.add_child(Earth.toward(Vector3(-0.15, -1.0, -0.06), 380_000.0, sun))
	cam.fov = 40.0
	cam.rotation_degrees = Vector3(3.0, 0.0, 0.0)
	# The site's hero box puts its words on the left half: everything right
	# of centre, clear of the dark fade along its bottom.
	_kestrel(Vector3(7.2, -0.6, -24.0), Vector3(-8.0, 124.0, -14.0), 0.9)
	_freighter("freighter", Vector3(40.0, 70.0, -330.0), Vector3(0.0, 72.0, 0.0))
	_freighter("freighter2", Vector3(190.0, 150.0, -660.0), Vector3(0.0, 66.0, 0.0))

func _convoy(cam: Camera3D) -> void:
	var sun := Vector3(0.55, 0.45, 0.5)
	Space.environment(_view, sun, 1.0, "harbor")
	_view.add_child(Earth.toward(Vector3(0.2, -1.0, -0.6), 420_000.0, sun))
	cam.fov = 45.0
	cam.rotation_degrees = Vector3(-4.0, 12.0, 0.0)
	_freighter("freighter", Vector3(-20.0, -10.0, -230.0), Vector3(0.0, 64.0, 4.0))
	_freighter("freighter3", Vector3(-200.0, 30.0, -520.0), Vector3(0.0, 70.0, 0.0))
	_kestrel(Vector3(14.0, 3.0, -60.0), Vector3(4.0, 70.0, 12.0), 0.7)
	_kestrel(Vector3(-50.0, 12.0, -120.0), Vector3(2.0, 66.0, -8.0), 0.7)

func _raid(cam: Camera3D) -> void:
	var sun := Vector3(-0.6, 0.3, -0.7)
	Space.environment(_view, sun, 1.0, "field")
	cam.fov = 42.0
	_freighter("freighter", Vector3(40.0, -30.0, -320.0), Vector3(0.0, 110.0, 0.0))
	for p in [Vector3(-6.0, 1.0, -34.0), Vector3(-22.0, 6.0, -70.0), Vector3(12.0, 9.0, -95.0)]:
		var r := Hull.model("raider")
		_view.add_child(r)
		r.position = p
		r.rotation_degrees = Vector3(-4.0, -160.0, 14.0)
		_plume(r, Vector3(-1.6, 0.1, 7.5), 0.55, 7.0, Color(1.0, 0.75, 0.45), Color(1.0, 0.25, 0.08))
		_plume(r, Vector3(1.6, 0.1, 7.5), 0.55, 7.0, Color(1.0, 0.75, 0.45), Color(1.0, 0.25, 0.08))

func _kestrel(at: Vector3, rot: Vector3, power: float) -> void:
	var k := Hull.model("kestrel")
	_view.add_child(k)
	k.position = at
	k.rotation_degrees = rot
	for x in [-1.62, 1.62]:
		_plume(k, Vector3(x, 0.0, 7.3), 0.42, 5.0, Color(0.75, 0.9, 1.0), Color(0.2, 0.45, 1.0), power)

func _freighter(kind: String, at: Vector3, rot: Vector3) -> void:
	var f := Hull.model(kind)
	_view.add_child(f)
	f.position = at
	f.rotation_degrees = rot

func _plume(on: Node3D, at: Vector3, radius: float, length: float, hot: Color, cool: Color, power := 1.0) -> void:
	var c := CylinderMesh.new()
	c.top_radius = radius
	c.bottom_radius = 0.05
	c.height = length
	c.radial_segments = 16
	c.rings = 1
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/plume.gdshader")
	m.set_shader_parameter("power", power)
	m.set_shader_parameter("hot", hot)
	m.set_shader_parameter("cool", cool)
	c.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = c
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.rotation_degrees = Vector3(-90, 0, 0)
	mi.position = at + Vector3(0, 0, length / 2.0)
	on.add_child(mi)
