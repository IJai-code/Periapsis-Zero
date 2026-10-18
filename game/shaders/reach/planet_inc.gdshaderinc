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
	vec3 c = tint.rgb;
	// Big patches across the land (the ground scan sampled metres wide):
	// darker, lusher hollows and drier, yellower rises, so a plain of grass
	// is never one colour from the air.
	float macro = dot(tri(ground_map, lpos * 0.011, w), vec3(0.333));
	float macro2 = dot(tri(rock_map, lpos * 0.0043 + vec3(0.37), w), vec3(0.333));
	float patch = smoothstep(0.3, 0.7, macro * 0.6 + macro2 * 0.8 - 0.1);
	vec3 lush = c * vec3(0.58, 0.72, 0.6);
	vec3 dry = c * vec3(1.16, 1.06, 0.7);
	c = mix(c, mix(lush, dry, patch), (1.0 - tint.a) * 0.9);
	// Grass that green is a cartoon: a little of its saturation out.
	float gl = dot(c, vec3(0.3, 0.55, 0.15));
	c = mix(c, vec3(gl), 0.18 * (1.0 - tint.a));
	// Rock: beds in bands up the faces (wavering, not ruled), each a little
	// warmer or cooler; dark streaks of water running down; cracks.
	float rad = length(lpos);
	float wob = (macro - 0.5) * 6.0;
	float bed = sin(rad * 0.55 + wob) * 0.5 + 0.5;
	float bed2 = sin(rad * 1.7 + wob * 2.3) * 0.5 + 0.5;
	vec3 band = mix(vec3(0.84, 0.76, 0.66), vec3(1.08, 0.98, 0.86), bed) * mix(0.9, 1.05, bed2);
	float streak = smoothstep(0.55, 0.85, dot(tri(rock_map, vec3(lpos.x * 0.09, rad * 0.008, lpos.z * 0.09), w), vec3(0.333)));
	vec3 rock = c * band * (1.0 - streak * 0.28);
	c = mix(c, rock, tint.a);
	// Fine detail as light and dark round the colour, fading with range.
	return c * mix(1.0, clamp(lum * 2.2, 0.35, 1.7), fade * 0.8);
}
