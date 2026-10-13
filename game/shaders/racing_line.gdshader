shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// The racing line's chevrons: a pulse running forward along the route
// (INSTANCE_CUSTOM.x is the distance along it), fading out close to the
// camera and far away.

varying float along;
varying float dist;

void vertex() {
	along = INSTANCE_CUSTOM.x;
	dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float pulse = 0.35 + 0.65 * pow(fract(along / 140.0 - TIME * 1.1), 6.0);
	float fade = smoothstep(22.0, 60.0, dist) * (1.0 - smoothstep(500.0, 950.0, dist));
	ALBEDO = vec3(0.35, 1.2, 1.6) * pulse * fade;
}
