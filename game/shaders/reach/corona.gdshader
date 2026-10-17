shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, depth_test_disabled, fog_disabled, shadows_disabled, cull_disabled;
// The Lantern's glare: a soft halo on a camera-facing quad, with faint rays.

uniform vec3 color : source_color = vec3(1.0, 0.7, 0.4);
uniform float power = 1.0;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0, 0, 0), vec4(0, length(MODEL_MATRIX[1].xyz), 0, 0), vec4(0, 0, length(MODEL_MATRIX[2].xyz), 0), vec4(0, 0, 0, 1));
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	float rays = 0.8 + 0.2 * sin(a * 9.0 + TIME * 0.2) * sin(a * 5.0 - TIME * 0.13);
	float glow = exp(-r * 5.0) * 1.4 + exp(-r * 1.6) * 0.25 * rays;
	ALBEDO = color * glow * power * smoothstep(1.0, 0.85, r);
}
