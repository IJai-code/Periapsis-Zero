// Shared by planet.gdshader (the body you are on, lit by the engine) and
// planet_far.gdshader (every other body, lit by hand from the Lantern).
// Vertex colour carries the art (rgb) and how much is bare rock (a); two
// photo-scanned materials add detail, mapped from three sides in the body's
// own space so nothing slides as it moves.

uniform sampler2D ground_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float detail_scale = 0.12;

varying vec3 lpos;
varying vec3 lnrm;
varying vec4 tint;

vec3 tri(sampler2D t, vec3 p, vec3 w) {
	return texture(t, p.zy).rgb * w.x + texture(t, p.xz).rgb * w.y + texture(t, p.xy).rgb * w.z;
}

vec3 surface_albedo(float dist) {
	vec3 n = normalize(lnrm);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 p = lpos * detail_scale;
	float fade = 1.0 - smoothstep(80.0, 600.0, dist);
	vec3 g = tri(ground_map, p, w);
	vec3 r = tri(rock_map, p * 0.6, w);
	vec3 tex = mix(g, r, tint.a);
	float lum = dot(tex, vec3(0.333));
	// Detail as light and dark round the painted colour, fading with range.
	return tint.rgb * mix(1.0, clamp(lum * 2.2, 0.35, 1.7), fade * 0.8);
}
