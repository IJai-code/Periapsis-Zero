class_name SongTells
extends Node
## What you know changes what you see. Once the Engine has asked for its
## song (Lore "wan_song"), a thread of light stands over each place that
## still holds a part of it, in that part's colour, and goes out when the
## part is learned. Nothing in the world is moved or changed by this: the
## lights are added over it, and before the Engine has asked there are none.

const HEIGHT := 900.0
## Part, world, landmark, colour.
const PARTS := [
	["song_phantom", "phantom", "shrine", Color(0.62, 0.86, 1.0)],
	["song_hearth", "hearthstone", "zerog", Color(1.0, 0.56, 0.2)],
	["song_ashfall", "ashfall", "vault", Color(0.96, 0.4, 0.34)],
	["song_verdance", "verdance", "pillars", Color(0.45, 1.0, 0.62)],
	["song_nadir", "nadir", "abe", Color(0.74, 0.58, 1.0)],
]

var reach: Reach
var _beams := {}
var _t := 0.0

static func _quad() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for uv: Vector2 in [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 0), Vector2(1, 1), Vector2(0, 1)]:
		st.set_uv(uv)
		st.add_vertex(Vector3(uv.x - 0.5, uv.y, 0.0))
	return st.commit()

func _ready() -> void:
	var quad := _quad()
	var shader: Shader = load("res://shaders/song_tell.gdshader")
	for p in PARTS:
		var key: String = p[1]
		var parent: Node3D
		var at := Transform3D.IDENTITY
		if key == "nadir":
			if not reach.nadir:
				continue
			parent = reach.nadir.tern
		else:
			var b: ReachBody = reach.system.bodies[key]
			parent = b.node
			at = Worlds.place(b, p[2])
		var m := MeshInstance3D.new()
		m.mesh = quad
		var mat := ShaderMaterial.new()
		mat.shader = shader
		mat.set_shader_parameter("tint", p[3])
		mat.set_shader_parameter("height", HEIGHT)
		m.material_override = mat
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# The shader stands it up and turns it: tell the culling how big it is.
		m.custom_aabb = AABB(Vector3(-60, 0, -60), Vector3(120, HEIGHT, 120))
		m.transform = at
		m.visible = false
		parent.add_child(m)
		_beams[p[0]] = m
	refresh()

## Which lights stand now (also called by the checks).
func refresh() -> int:
	var asked := Lore.known("wan_song") and not reach.finished
	var lit := 0
	for part: String in _beams:
		var on := asked and not Lore.known(part)
		(_beams[part] as MeshInstance3D).visible = on
		if on:
			lit += 1
	return lit

func _process(dt: float) -> void:
	_t -= dt
	if _t <= 0.0:
		_t = 1.0
		refresh()
