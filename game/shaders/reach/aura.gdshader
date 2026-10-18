shader_type spatial;
render_mode blend_add, depth_draw_never, cull_back, unshaded;
// A glow round a world (WorldLook): brightest at its edge, breathing, and
// wavering, the Phantom's quantum shimmer.

uniform vec4 color : source_color = vec4(0.6, 0.4, 1.0, 1.0);
uniform float strength = 1.0;
uniform float pulse = 0.6;

void fragment() {
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.4);
	float breathe = 0.7 + 0.3 * sin(TIME * pulse * 6.2831);
	float waver = 0.85 + 0.15 * sin(UV.x * 40.0 + TIME * 2.0) * sin(UV.y * 31.0 - TIME * 1.3);
	ALBEDO = color.rgb * rim * strength * breathe * waver;
}
