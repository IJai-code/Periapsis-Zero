shader_type spatial;
render_mode cull_back;
// The body you are on: lit by the engine (shadows, the flashlight).
#include "res://shaders/reach/planet_inc.gdshaderinc"

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
	tint = COLOR;
}

void fragment() {
	ALBEDO = surface_albedo(length(VERTEX));
	ROUGHNESS = mix(0.95, 0.8, tint.a);
	SPECULAR = 0.25;
	// Close up, the scans' light and dark as relief: the normal tipped by
	// how their brightness changes across the pixel.
	float near = 1.0 - smoothstep(10.0, 70.0, length(VERTEX));
	if (near > 0.0) {
		vec3 nn = normalize(lnrm);
		vec3 ww = pow(abs(nn), vec3(4.0));
		ww /= (ww.x + ww.y + ww.z);
		vec3 pp = lpos * detail_scale;
		float h = dot(mix(tri(ground_map, pp, ww), tri(rock_map, pp * 0.6, ww), tint.a), vec3(0.333));
		vec3 bump = vec3(dFdx(h), dFdy(h), 0.0) * (1.6 + tint.a * 2.4) * near;
		NORMAL = normalize(NORMAL + vec3(-bump.x, -bump.y, 0.0));
	}
}
