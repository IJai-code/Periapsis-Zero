// Rain: a box of falling streaks round the camera, the whole shower one
// draw. Each streak's place is worked out here from its seed and the
// shower's drift, so nothing is moved on the CPU (Weather).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

// The box (metres) and how far the shower has fallen and blown through it.
uniform vec3 box = vec3(26.0, 16.0, 26.0);
uniform vec3 drift = vec3(0.0);
// How hard it rains (0..1): the share of streaks drawn, and how bright.
uniform float amount = 0.0;
// The slant the wind gives it, and the light it catches.
uniform vec3 fall = vec3(0.12, -1.0, 0.05);
uniform vec3 tone : source_color = vec3(0.7, 0.76, 0.85);
// Under a roof or in the cockpit: nothing falls this close.
uniform float keep_off = 0.0;

varying float a;

void vertex() {
	vec3 seed = INSTANCE_CUSTOM.rgb;
	vec3 p = mod(seed * box + drift, box) - box * 0.5;
	float len = 0.45 + INSTANCE_CUSTOM.a * 0.5;
	vec3 along = normalize(fall);
	vec3 side = normalize(cross(along, p + vec3(0.0001, 0.0, 0.0)));
	float d = length(p.xz);
	VERTEX = p + side * VERTEX.x * (0.008 + d * 0.0026) + along * VERTEX.y * len;
	a = step(INSTANCE_CUSTOM.a, amount)
		* smoothstep(max(0.5, keep_off), max(0.5, keep_off) + 1.5, d)
		* (1.0 - smoothstep(box.x * 0.36, box.x * 0.5, d));
}

void fragment() {
	ALBEDO = tone;
	// Thin at both ends, and soft across.
	ALPHA = a * 0.42 * (1.0 - abs(UV.y - 0.5) * 2.0) * (1.0 - abs(UV.x - 0.5) * 1.6);
}
