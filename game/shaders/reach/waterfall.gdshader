shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, unshaded;
// A falling sheet of water: streaks running down (UV.y grows downward),
// white where it breaks, thinning at its edges.

uniform vec4 tint : source_color = vec4(0.72, 0.86, 0.95, 1.0);
uniform float speed = 1.6;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV;
	float t = TIME * speed;
	float streak = noise(vec2(uv.x * 26.0, uv.y * 3.0 - t * 3.0)) * 0.6 + noise(vec2(uv.x * 61.0, uv.y * 7.0 - t * 5.0)) * 0.4;
	float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
	float foam = smoothstep(0.55, 1.0, uv.y) * 0.6 + smoothstep(0.55, 0.85, streak) * 0.5;
	ALBEDO = mix(tint.rgb, vec3(1.0), clamp(foam, 0.0, 1.0));
	ALPHA = clamp((0.35 + streak * 0.55) * edge, 0.0, 0.92);
}
