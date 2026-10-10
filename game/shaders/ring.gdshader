shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;
// A shockwave: a thin bright ring on a quad, its alpha from `fade`.

uniform vec3 tint : source_color = vec3(1.0, 0.7, 0.4);
uniform float fade = 1.0;
uniform float width = 0.08;

void fragment() {
	float r = length(UV * 2.0 - 1.0);
	float ring = smoothstep(1.0 - width, 1.0 - width * 0.5, r) * smoothstep(1.0, 1.0 - width * 0.4, r);
	float inner = smoothstep(1.0, 0.0, r) * 0.08;
	ALBEDO = tint * 3.0;
	ALPHA = (ring + inner) * fade;
}
