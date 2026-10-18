shader_type spatial;
render_mode blend_add, depth_draw_never, cull_disabled, unshaded;
// A comet's tail (WorldLook): UV.y runs from the nucleus (1) out to the
// end (0) of a long cone; bright and narrow near the head, fading and
// fraying along its length into streaks that stream away.

uniform vec4 color : source_color = vec4(0.55, 0.8, 1.0, 1.0);
uniform float strength = 1.0;
uniform float flow = 0.25;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	// The cylinder's UV.y runs from its top (the head, at the nucleus) down.
	float along = UV.y;
	float streak = noise(vec2(UV.x * 24.0, along * 6.0 - TIME * flow)) * 0.6 + noise(vec2(UV.x * 60.0, along * 14.0 - TIME * flow * 1.7)) * 0.4;
	float head = pow(1.0 - along, 1.3) * smoothstep(0.0, 0.04, along);
	// Brightest down the middle of the cone as seen, nothing at its sides
	// or its far end: gas, not a solid.
	float face = pow(abs(dot(NORMAL, VIEW)), 3.0);
	float k = head * (0.35 + 0.65 * streak * streak) * face * strength * 0.9;
	ALBEDO = color.rgb * k;
}
