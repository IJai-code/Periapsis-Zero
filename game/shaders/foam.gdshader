shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, unshaded, shadows_disabled;
// Churning foam where the falls hit the river: white, swirling, fading out
// at the edges of the pool.

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float r = length(p * vec2(1.0, 1.4));
	float t = TIME * 0.4;
	float f = vnoise(p * 9.0 + vec2(t, -t * 1.3)) * 0.6 + vnoise(p * 23.0 - vec2(t * 2.0, t)) * 0.4;
	float a = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.75, f + (1.0 - r) * 0.35);
	ALBEDO = vec3(0.92, 0.96, 0.97);
	ALPHA = a * 0.85;
}
