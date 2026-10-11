shader_type spatial;
render_mode cull_disabled;
// Jungle canopies: leaf masses that sway in the wind, each tree its own green,
// sunlit edges glowing where light comes through from behind.

uniform vec3 base_color : source_color = vec3(0.11, 0.25, 0.06);
uniform float sway = 0.6;

varying vec3 tint;

void vertex() {
	float h = max(VERTEX.y, 0.0);
	vec3 o = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float t = TIME * 0.8 + o.x * 0.013 + o.z * 0.017;
	VERTEX.x += sin(t) * sway * h * 0.03;
	VERTEX.z += cos(t * 1.3) * sway * h * 0.02;
	tint = COLOR.rgb;
}

void fragment() {
	ALBEDO = base_color * tint * 1.6;
	ROUGHNESS = 0.85;
	SPECULAR = 0.2;
	BACKLIGHT = vec3(0.45, 0.6, 0.18);
}
