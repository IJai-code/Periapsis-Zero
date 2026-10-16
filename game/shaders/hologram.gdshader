shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;
// A street hologram: light with no surface, scanlines climbing through it,
// its edges brightest, a flicker now and then.

uniform vec3 tint : source_color = vec3(0.2, 0.85, 1.0);
uniform float strength = 1.6;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float scan = 0.55 + 0.45 * sin(wpos.y * 26.0 - TIME * 6.0);
	float band = smoothstep(0.0, 0.08, fract(wpos.y * 0.35 - TIME * 0.4)) * 0.7 + 0.3;
	float rim = pow(1.0 - abs(dot(NORMAL, VIEW)), 2.0);
	float flick = 0.88 + 0.12 * step(0.96, fract(sin(floor(TIME * 18.0)) * 43758.5));
	ALBEDO = tint * strength * (0.25 + rim * 1.2) * scan * band * flick;
}
