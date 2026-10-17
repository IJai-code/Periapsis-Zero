class_name Valley
## The valley's own pieces (art/godot/hearth_valley.py): its tall pines,
## the cliff segments, and the material the pines share.

static var _meshes := {}
static var _pine_mat: ShaderMaterial

## The first mesh in res://art/valley-<name>.glb.
static func mesh(name: String) -> Mesh:
	if _meshes.has(name):
		return _meshes[name]
	var scene: Node = load("res://art/valley-%s.glb" % name).instantiate()
	var mi: MeshInstance3D = scene.find_children("*", "MeshInstance3D", true, false)[0]
	var m := mi.mesh
	scene.free()
	_meshes[name] = m
	return m

## The pines: vertex colour (alpha is how far the wind moves it), lit on
## both faces, the crown swaying more the higher it is.
static func pine_material() -> ShaderMaterial:
	if _pine_mat:
		return _pine_mat
	var s := Shader.new()
	s.code = """shader_type spatial;
render_mode cull_disabled;
// Tall pines: vertex colour; the crown moves in a slow wind, more toward
// the top (alpha says how loose each part is). A little light through the
// needles from behind.
void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float t = TIME * 0.55 + o.x * 0.031 + o.z * 0.027 + o.y * 0.02;
	float h = max(VERTEX.y, 0.0) / 24.0;
	float w = (sin(t) * 0.7 + sin(t * 2.3 + 1.7) * 0.3) * h * h * 0.55 * (0.35 + COLOR.a);
	VERTEX.x += w;
	VERTEX.z += w * 0.6;
}
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.92;
	SPECULAR = 0.15;
	BACKLIGHT = COLOR.rgb * 0.45 * COLOR.a;
}"""
	_pine_mat = ShaderMaterial.new()
	_pine_mat.shader = s
	return _pine_mat

static func clear_cache() -> void:
	_meshes.clear()
	_pine_mat = null
