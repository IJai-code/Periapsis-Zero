shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, unshaded, shadows_disabled;
// A curtain of falling water: glassy and dark at the lip, breaking up as it
// accelerates into white streaks and clumps, ragged at the edges, thinning
// to spray at the foot. UV.y runs down the fall.

uniform float speed = 1.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	float v = UV.y;
	// Falling water speeds up: the pattern moves faster the further down.
	float fall = v * v * 2.2 - TIME * speed * (0.6 + v * 1.4);
	float columns = vnoise(vec2(UV.x * 34.0, 0.5));
	float streak = vnoise(vec2(UV.x * 70.0 + columns * 3.0, fall * 9.0));
	float clump = vnoise(vec2(UV.x * 16.0, fall * 3.0));
	float fine = vnoise(vec2(UV.x * 160.0, fall * 22.0));
	float white = clamp(streak * 0.6 + clump * 0.5 + fine * 0.3 - 0.35 + v * 0.45, 0.0, 1.0);
	// Glassy at the lip, white lower down.
	vec3 glass = vec3(0.32, 0.42, 0.42);
	vec3 col = mix(glass, vec3(0.92, 0.95, 0.96), smoothstep(0.05, 0.4, v) * white);
	float edge = smoothstep(0.0, 0.08 + columns * 0.06, UV.x) * smoothstep(1.0, 0.92 - columns * 0.06, UV.x);
	float a = mix(0.75, 0.95, white) * edge;
	// Gaps between the falling clumps, and thinning to spray at the foot.
	a *= mix(1.0, smoothstep(0.15, 0.55, clump + fine * 0.3), smoothstep(0.3, 0.9, v));
	a *= 1.0 - smoothstep(0.88, 1.0, v) * 0.6;
	ALBEDO = col * 1.25;
	ALPHA = a;
}
