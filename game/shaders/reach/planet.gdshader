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
	EMISSION = veins();
	// Close up, the scans' light and dark as relief: the normal tipped by
	// how their brightness changes across the pixel.
	float near = 1.0 - smoothstep(10.0, 70.0, length(VERTEX));
	if (near > 0.0) {
		vec3 nn = normalize(lnrm);
		vec3 ww = pow(abs(nn), vec3(4.0));
		ww /= (ww.x + ww.y + ww.z);
		vec3 pp = lpos * detail_scale;
		float h = dot(mix(tri(ground_map, pp, ww), tri(rock_map, pp * 0.6, ww), tint.a), vec3(0.333));
		// Within a few steps, a second, finer layer of the same scans:
		// grains, grit and crumbs of soil at the scale of a boot, so the
		// ground holds up when you look straight down at it.
		float close = 1.0 - smoothstep(2.5, 9.0, length(VERTEX));
		if (close > 0.0) {
			float fine = dot(mix(tri(ground_map, pp * 5.3, ww), tri(rock_map, pp * 3.7, ww), tint.a), vec3(0.333));
			ALBEDO *= mix(1.0, clamp(0.55 + fine * 1.1, 0.6, 1.35), close * 0.6);
			h += fine * 0.35 * close;
		}
		vec3 bump = vec3(dFdx(h), dFdy(h), 0.0) * (1.6 + tint.a * 2.4) * near;
		NORMAL = normalize(NORMAL + vec3(-bump.x, -bump.y, 0.0));
		// The dark of the scan is the damp and the packed: a little
		// smoother there, so low light picks the ground out in patches.
		ROUGHNESS -= (1.0 - smoothstep(0.2, 0.55, h)) * 0.22 * near;
	}
}
