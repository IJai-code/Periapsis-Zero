shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back;
// A shield taking a hit: a fresnel shell, brightest at the edge and round
// the point of impact (`hit`, in the shell's own space), fading by `fade`.

uniform vec3 tint : source_color = vec3(0.3, 0.55, 1.0);
uniform vec3 hit = vec3(0.0, 0.0, 1.0);
uniform float fade = 1.0;

varying vec3 local;

void vertex() {
	local = VERTEX / max(length(VERTEX), 0.0001);
}

void fragment() {
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.5);
	// A hit at the very centre has no direction: never normalise a zero
	// vector (the NaN it makes spreads across the whole screen in the glow).
	vec3 h = length(hit) > 0.0001 ? hit / length(hit) : vec3(0.0, 0.0, 1.0);
	// The flare stays round the point hit: a whole glowing shell hid the
	// ship it was on (players read it as a cloud their shots could not cross).
	float spot = pow(max(dot(local, h), 0.0), 48.0);
	float cells = 0.75 + 0.25 * step(0.5, fract((local.x + local.y * 0.5) * 9.0)) * step(0.5, fract((local.y - local.z * 0.5) * 9.0));
	ALBEDO = tint * 1.5;
	ALPHA = (rim * 0.035 + spot * 0.9 * cells) * fade;
}
