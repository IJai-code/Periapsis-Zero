shader_type spatial;
render_mode cull_disabled;
// Leaf cards: real leaves composed in Blender (art/godot/foliage_cards.py),
// cut out by their alpha. The crown's normals point outward from its centre
// (art/godot/flora.py), so a crown shades as one mass; both faces keep that
// normal. Light comes through from behind; the crown sways, more at the top.

uniform sampler2D card : source_color, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(1.0);
uniform float sway = 1.0;
uniform float cutoff = 0.45;

varying vec3 inst;

void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float h = max(VERTEX.y, 0.0);
	float t = TIME * 0.9 + o.x * 0.021 + o.z * 0.017;
	float bend = h * h * 0.0009 * sway;
	VERTEX.x += sin(t) * bend + sin(t * 3.7 + VERTEX.y) * 0.04 * sway * min(h, 4.0);
	VERTEX.z += cos(t * 1.2) * bend * 0.7;
	inst = COLOR.rgb;
}

void fragment() {
	vec4 c = texture(card, UV);
	ALBEDO = c.rgb * tint * inst;
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = cutoff;
	// Keep the crown's outward normal on both faces.
	if (!FRONT_FACING) {
		NORMAL = -NORMAL;
	}
	ROUGHNESS = 0.75;
	SPECULAR = 0.25;
	BACKLIGHT = c.rgb * vec3(0.6, 0.75, 0.35);
}
