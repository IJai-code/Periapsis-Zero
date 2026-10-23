class_name Grass
## Grass round the places people live: Poly Haven's scanned grass, dandelions
## and daisies (art/godot/grass_cards.py renders each clump into one sheet),
## each tuft three crossed cards, a whole field one draw. The tips sway in a
## slow wind that rolls across the field; far tufts sink into the ground
## rather than vanish. Stood on the sphere along its up; kept off paths and
## out of buildings.

const SHEET := "res://art/grass/grass-cards.png"
const COLS := 4
const ROWS := 2
# Each tile's size in metres as scanned (grass-cards.json), and how often
# it is picked: the dense clumps make the field, the tall stems and the
# flowers are scattered through it.
const SIZES := [0.336, 0.298, 0.227, 0.330, 0.420, 0.331, 0.230, 0.272]
const WEIGHTS := [0.06, 0.06, 0.34, 0.36, 0.04, 0.04, 0.05, 0.05]

static var _mesh: ArrayMesh
static var _mat: ShaderMaterial

## One tuft: three cards a third of a turn apart, each a unit square from
## the ground up (scaled by its instance), its UV the whole tile (the shader
## moves it to the instance's tile).
static func _cards() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 3:
		var a := PI * k / 3.0
		var side := Vector3(cos(a), 0, sin(a)) * 0.5
		var c := [-side, side, side + Vector3.UP, -side + Vector3.UP]
		var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		for i: int in [0, 1, 2, 0, 2, 3]:
			st.set_normal(Vector3.UP)
			st.set_uv(uv[i])
			st.add_vertex(c[i])
	return st.commit()

static func material() -> ShaderMaterial:
	if _mat:
		return _mat
	var s := Shader.new()
	s.code = """shader_type spatial;
render_mode cull_disabled;
uniform sampler2D sheet : source_color, filter_linear_mipmap, repeat_disable;
uniform float fade_end = 120.0;
varying float tip;
varying float shade;
// INSTANCE_CUSTOM: r = the tile (0..7), g = a tint.
void vertex() {
	float tile = floor(INSTANCE_CUSTOM.r * 255.0 + 0.5);
	UV = (UV + vec2(mod(tile, 4.0), floor(tile / 4.0))) / vec2(4.0, 2.0);
	tip = VERTEX.y;
	shade = INSTANCE_CUSTOM.g;
	vec3 w = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float t = TIME * 1.1 + w.x * 0.13 + w.z * 0.09 + w.y * 0.05;
	float gust = sin(t) * 0.6 + sin(t * 2.3 + w.x * 0.4) * 0.3;
	VERTEX.x += gust * 0.08 * tip * tip;
	VERTEX.z += cos(t * 0.7) * 0.05 * tip * tip;
	// Far tufts sink into the ground, so the field's edge never pops.
	float d = length(w - (INV_VIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
	VERTEX.y *= 1.0 - smoothstep(fade_end * 0.7, fade_end, d);
}
void fragment() {
	vec4 c = texture(sheet, UV);
	// Mipmaps thin the blades' alpha far off: lifted, so they stay.
	ALPHA = clamp(c.a * 1.5, 0.0, 1.0);
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	// A little greener than the scans (the crater is watered), each tuft
	// its own shade.
	vec3 col = c.rgb * vec3(0.92, 1.08, 0.82) * mix(0.85, 1.2, shade);
	// Darker at the root, where the blades shade each other.
	col *= mix(0.55, 1.0, smoothstep(0.0, 0.45, tip));
	ALBEDO = col;
	ROUGHNESS = 0.9;
	SPECULAR = 0.12;
	BACKLIGHT = col * 0.45;
}"""
	_mat = ShaderMaterial.new()
	_mat.shader = s
	_mat.set_shader_parameter("sheet", load(SHEET))
	return _mat

static func _pick(r: float) -> int:
	var acc := 0.0
	for i in WEIGHTS.size():
		acc += WEIGHTS[i]
		if r < acc:
			return i
	return 3

## A field round a site's frame origin: `count` tufts within `radius`
## metres, not within any [point, radius] in `keep_clear` (body space).
## `chunked` puts a frame between four equal batches: the browser can still
## paint while a field is made.
static func field(site: Site, frame: Transform3D, radius: float, count: int, keep_clear: Array, seed: int, chunked := false) -> void:
	if not _mesh:
		_mesh = _cards()
	# The light renderer (the browser, weak PCs): fewer, a little bigger.
	var lite := Flow.lite()
	if lite:
		count = int(count * 0.65)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var list: Array[Transform3D] = []
	var tiles: PackedInt32Array = []
	var tries := 0
	var batch := maxi(1, count / 4)
	while list.size() < count and tries < count * 3:
		tries += 1
		if chunked and tries % batch == 0:
			await site.get_tree().process_frame
		# Thickest near the middle, thinning outward.
		var r := radius * pow(rng.randf(), 0.72)
		var a := rng.randf() * TAU
		var g := site.ground(Vector2(cos(a), sin(a)) * r, frame)
		var ok := true
		for c in keep_clear:
			if g.origin.distance_to(c[0]) < float(c[1]):
				ok = false
				break
		# Not in the water, not on bare rock.
		var d := g.origin.normalized()
		if Worlds.height(site.body.key, d, site.body.radius) < site.body.sea + 0.4:
			ok = false
		if not ok:
			continue
		var tile := _pick(rng.randf())
		# Scanned clumps are a hand high: grown to knee height in the middle
		# of the field, shorter toward its edge.
		var grow := rng.randf_range(1.6, 2.6) * lerpf(1.15, 0.8, r / radius) * (1.15 if lite else 1.0)
		var b := g.basis.rotated(g.basis.y, rng.randf() * TAU).scaled(Vector3.ONE * SIZES[tile] * grow)
		list.append(Transform3D(b, g.origin - g.basis.y * 0.03))
		tiles.append(tile)
	if list.is_empty():
		return
	# Instances relative to the field's middle (visibility is measured to
	# the node).
	var mid := frame.origin
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = _mesh
	mm.instance_count = list.size()
	for i in list.size():
		var xf: Transform3D = list[i]
		mm.set_instance_transform(i, Transform3D(xf.basis, xf.origin - mid))
		mm.set_instance_custom_data(i, Color(tiles[i] / 255.0, rng.randf(), 0, 0))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = material()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = mid
	mi.visibility_range_end = radius + 120.0
	site.add_child(mi)

static func clear_cache() -> void:
	_mesh = null
	_mat = null
