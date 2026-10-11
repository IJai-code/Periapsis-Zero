shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, unshaded;
// A waterfall curtain: white water racing down in streaks, ragged at the
// edges, thinning to spray.

uniform float speed = 1.6;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV;
	float s = vnoise(vec2(uv.x * 40.0, uv.y * 3.0 + TIME * speed));
	float s2 = vnoise(vec2(uv.x * 90.0, uv.y * 8.0 + TIME * speed * 1.7));
	float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
	float a = clamp(s * 0.7 + s2 * 0.5, 0.0, 1.0) * edge;
	ALBEDO = mix(vec3(0.75, 0.82, 0.85), vec3(1.0), s2) * 1.3;
	ALPHA = a * 0.9;
}
