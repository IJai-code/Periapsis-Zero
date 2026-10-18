shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled;
// Foam where a waterfall lands (Falls): rings of white churning out from the
// middle and breaking up, thinning to nothing at the edge.

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float r = length(p);
	float ang = atan(p.y, p.x);
	float ring = noise(vec2(ang * 4.0, r * 7.0 - TIME * 1.6)) * 0.6 + noise(vec2(ang * 11.0 + 3.0, r * 16.0 - TIME * 2.4)) * 0.4;
	float body = smoothstep(1.0, 0.25, r);
	float foam = smoothstep(0.4, 0.75, ring) * body + smoothstep(0.45, 0.0, r) * 0.6;
	ALBEDO = vec3(0.93, 0.96, 1.0);
	ROUGHNESS = 0.7;
	EMISSION = vec3(0.1);
	ALPHA = clamp(foam, 0.0, 0.9);
}
