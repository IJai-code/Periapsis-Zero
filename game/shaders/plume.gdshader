shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;
// An engine plume: a cone of hot gas, white-blue at the nozzle, fading and
// cooling along its length, flickering. `power` (0..1+) sets brightness.

uniform float power = 0.5;
uniform vec3 hot : source_color = vec3(0.75, 0.9, 1.0);
uniform vec3 cool : source_color = vec3(0.2, 0.45, 1.0);

void fragment() {
	// UV.y runs 0 at the nozzle to 1 at the tip on a CylinderMesh.
	float along = UV.y;
	float edge = pow(clamp(dot(NORMAL, VIEW), 0.0, 1.0), 1.5);
	float flick = 0.85 + 0.15 * sin(TIME * 60.0 + along * 20.0);
	vec3 c = mix(hot, cool, smoothstep(0.0, 0.6, along));
	ALBEDO = c * (1.0 - along) * (1.0 - along) * edge * power * 3.0 * flick;
}
