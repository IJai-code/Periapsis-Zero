shader_type sky;
// Deep space: a baked panorama (the Milky Way's glow from NASA's Deep Star
// Map and nebulae, scripts/tools/sky_bake.gd) under stars drawn live, so
// they stay sharp: three layers, each star at least a pixel or two across,
// the brightest with a soft glow. The Sun's disc and glare on top.

uniform sampler2D panorama : source_color, hint_default_black, filter_linear;
uniform float panorama_gain = 1.0;
uniform float star_gain = 1.0;

vec3 hash33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

vec3 stars(vec3 d, float scale, float density, float size, float gain) {
	vec3 p = d * scale;
	vec3 cell = floor(p);
	vec3 h = hash33(cell);
	if (h.x > density) return vec3(0.0);
	vec3 c = cell + 0.25 + 0.5 * hash33(cell + 7.1);
	float r = length(p - c);
	float s = size * mix(0.6, 1.3, h.y);
	float core = smoothstep(s, 0.0, r);
	// The glow stays well inside the star's cell (cut off at the cell's
	// edge it would draw a square).
	float glow = exp(-r * r / (s * s * 2.5)) * 0.3 * h.y * h.y * smoothstep(0.24, 0.1, r);
	// Colour by temperature: red dwarfs to blue giants, most near white.
	vec3 tint = mix(vec3(1.0, 0.7, 0.48), vec3(0.72, 0.84, 1.0), h.z);
	return tint * (core + glow) * gain * mix(0.6, 3.0, pow(h.y, 4.0));
}

void sky() {
	vec3 d = EYEDIR;
	float u = atan(d.x, -d.z) / 6.2831853 + 0.5;
	float v = acos(clamp(d.y, -1.0, 1.0)) / 3.1415927;
	vec3 col = texture(panorama, vec2(u, v)).rgb * panorama_gain;
	if (AT_CUBEMAP_PASS) {
		// The reflections and ambient need the glow, not the points.
		COLOR = col;
	} else {
		col += stars(d, 160.0, 0.32, 0.12, 1.0) * star_gain;
		col += stars(d, 380.0, 0.38, 0.16, 0.45) * star_gain;
		col += stars(d, 60.0, 0.12, 0.05, 4.0) * star_gain;
		if (LIGHT0_ENABLED) {
			float s = dot(d, LIGHT0_DIRECTION);
			col += vec3(1.0, 0.95, 0.88) * smoothstep(0.99985, 0.99995, s) * 400.0;
			col += vec3(1.0, 0.8, 0.6) * pow(max(s, 0.0), 900.0) * 6.0;
			col += vec3(1.0, 0.75, 0.5) * pow(max(s, 0.0), 40.0) * 0.08;
		}
		COLOR = col;
	}
}
