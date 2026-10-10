shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back;
// A shield taking a hit: a fresnel shell, brightest at the edge and round
// the point of impact (`hit`, in the shell's own space), fading by `fade`.

uniform vec3 tint : source_color = vec3(0.2, 0.8, 1.0);
uniform vec3 hit = vec3(0.0, 0.0, 1.0);
uniform float fade = 1.0;

varying vec3 local;

void vertex() {
	local = normalize(VERTEX);
}

void fragment() {
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.5);
	float spot = pow(max(dot(local, normalize(hit)), 0.0), 28.0);
	float cells = 0.75 + 0.25 * step(0.5, fract((local.x + local.y * 0.5) * 9.0)) * step(0.5, fract((local.y - local.z * 0.5) * 9.0));
	ALBEDO = tint * 2.0;
	ALPHA = (rim * 0.12 + spot * 1.2 * cells) * fade;
}
