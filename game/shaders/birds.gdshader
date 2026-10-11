shader_type spatial;
render_mode cull_disabled, unshaded;
// Flocks wheeling round the pillars: each bird a flapping chevron, each one
// on its own circle (radius, height, speed and phase in its instance data).

varying float shadeval;

void vertex() {
	vec4 d = INSTANCE_CUSTOM;
	float ang = TIME * d.z + d.w * 6.2831;
	float rad = d.x;
	vec3 pos = vec3(cos(ang) * rad, d.y + sin(ang * 2.0 + d.w * 9.0) * 6.0, sin(ang) * rad);
	vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(d.z));
	vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
	float flap = sin(TIME * 9.0 + d.w * 40.0) * abs(VERTEX.x) * 0.8;
	vec3 local = right * VERTEX.x + vec3(0.0, 1.0, 0.0) * (VERTEX.y + flap) + fwd * VERTEX.z;
	// Instances sit at their flock's centre, unrotated: offsets are local.
	VERTEX = pos + local * 1.4;
	shadeval = 0.6 + 0.4 * abs(VERTEX.x);
}

void fragment() {
	ALBEDO = vec3(0.05, 0.05, 0.06) * shadeval;
}
