// A thread of light standing over a place that holds a part of the
// Engine's song: a quad (UV.x across, UV.y up it) turned to the eye and
// kept a few pixels wide, so it reads from orbit and from beside it.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled, world_vertex_coords;

uniform vec3 tint : source_color = vec3(1.0, 0.8, 0.5);
uniform float height = 900.0;
uniform float power = 1.0;

varying float edge;
varying float up_it;

void vertex() {
	vec3 base = MODEL_MATRIX[3].xyz;
	vec3 up = normalize(MODEL_MATRIX[1].xyz);
	vec3 at = base + up * UV.y * height;
	vec3 view = at - CAMERA_POSITION_WORLD;
	float dist = length(view);
	vec3 side = cross(up, view);
	float sl = length(side);
	side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
	edge = UV.x * 2.0 - 1.0;
	up_it = UV.y;
	VERTEX = at + side * edge * max(0.7, dist * 0.003);
}

void fragment() {
	float core = 1.0 - abs(edge);
	float a = core * core * pow(1.0 - up_it, 1.4) * smoothstep(0.0, 0.01, up_it);
	a *= 0.72 + 0.28 * sin(TIME * 1.6 - up_it * 26.0);
	ALBEDO = tint * 1.8;
	ALPHA = clamp(a * power, 0.0, 1.0);
}
