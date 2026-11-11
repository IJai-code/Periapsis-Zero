shader_type sky;
// The sky over the Reach: the nebulae the Kestrel flew through to get here
// (the original game's painted panorama, art/sky/space-hearth.jpg) turned
// so their brightest clouds stand over Hearth at night, under stars drawn
// live so they stay sharp: three layers, the brightest with a soft glow.
// (No TIME here: a sky that uses it is relit every frame.) The air of a world covers it by day (atmosphere.gdshader).

uniform sampler2D panorama : source_color, hint_default_black, filter_linear_mipmap;
uniform float panorama_gain = 0.9;
uniform float star_gain = 1.0;
uniform float yaw = 3.1415927;
uniform float tilt = 0.25;
uniform float brightness = 1.0;

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
	float glow = exp(-r * r / (s * s * 2.5)) * 0.3 * h.y * h.y * smoothstep(0.24, 0.1, r);
	vec3 tint = mix(vec3(1.0, 0.7, 0.48), vec3(0.72, 0.84, 1.0), h.z);
	return tint * (core + glow) * gain * mix(0.6, 3.0, pow(h.y, 4.0));
}

// The giant beyond the Reach's edge: a banded world far bigger than any
// in the Reach, too far to fly to, hanging in the sky over every world. It
// is lit from the Lantern (the sun light's direction), its night side
// nearly black against the nebulae, a thin bright limb of air at the edge.
// (World space: set once by the game, over the village's fire.)
uniform vec3 giant_dir = vec3(0.42, 0.2, -0.88);
uniform float giant_size = 0.27;
uniform float giant_gain = 1.7;

float vnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash33(i).x;
	float b = hash33(i + vec3(1, 0, 0)).x;
	float c = hash33(i + vec3(0, 1, 0)).x;
	float d = hash33(i + vec3(1, 1, 0)).x;
	float e = hash33(i + vec3(0, 0, 1)).x;
	float g = hash33(i + vec3(1, 0, 1)).x;
	float h = hash33(i + vec3(0, 1, 1)).x;
	float k = hash33(i + vec3(1, 1, 1)).x;
	return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

// Colour of the giant where the view meets it (alpha: how much of it is
// there), or nothing.
vec4 giant(vec3 d, vec3 sun) {
	vec3 g = normalize(giant_dir);
	float R = giant_size;
	float b = dot(d, g);
	float disc = b * b - (1.0 - R * R);
	// The air's halo just beyond the limb.
	float off = sqrt(max(0.0, 1.0 - b * b));
	float halo_k = smoothstep(R * 1.12, R, off) * step(0.0, b);
	if (disc <= 0.0) {
		vec3 nh = normalize(d - g * b);
		float lit = clamp(dot(nh, sun) * 0.8 + 0.25, 0.0, 1.0);
		return vec4(vec3(0.55, 0.72, 1.0) * halo_k * halo_k * lit * 0.5, 0.0);
	}
	vec3 hit = d * (b - sqrt(disc));
	vec3 n = normalize(hit - g);
	// Bands along a tilted axis, pulled about by storms.
	vec3 axis = normalize(vec3(0.25, 1.0, 0.15));
	vec3 q = n * 3.0;
	float warp = vnoise(q * 2.0) * 0.6 + vnoise(q * 5.0) * 0.25;
	float lat = dot(n, axis) + (warp - 0.42) * 0.16;
	float band = sin(lat * 26.0) * 0.5 + 0.5;
	float fine = sin(lat * 71.0 + warp * 4.0) * 0.5 + 0.5;
	vec3 cream = vec3(0.86, 0.74, 0.58);
	vec3 rust = vec3(0.62, 0.32, 0.17);
	vec3 deep = vec3(0.36, 0.17, 0.11);
	vec3 col = mix(rust, cream, smoothstep(0.25, 0.85, band));
	col = mix(col, deep, smoothstep(0.7, 1.0, fine) * 0.45);
	// One great storm, a pale oval.
	vec3 eye = normalize(vec3(0.6, -0.25, 0.75));
	float storm = smoothstep(0.24, 0.1, length((n - eye) * vec3(1.0, 1.8, 1.0)));
	col = mix(col, vec3(0.93, 0.85, 0.74), storm * 0.8);
	float ndl = dot(n, sun);
	float day = smoothstep(-0.08, 0.25, ndl);
	// Limb darkening, and the air lit at the rim on the day side.
	float mu = clamp(dot(n, -d), 0.0, 1.0);
	vec3 lit = col * day * (0.35 + 0.65 * pow(mu, 0.35));
	float rim = pow(1.0 - mu, 4.0) * smoothstep(-0.2, 0.3, ndl);
	lit += vec3(0.55, 0.72, 1.0) * rim * 0.8;
	// The night side: a faint glow off the nebulae, never quite black.
	lit += col * 0.025;
	float edge = smoothstep(0.0, 0.004, disc);
	return vec4(lit, edge);
}

void sky() {
	// Turn the painting: its brightest clouds over the village by night.
	vec3 d = EYEDIR;
	float cy = cos(yaw);
	float sy = sin(yaw);
	d = vec3(cy * d.x - sy * d.z, d.y, sy * d.x + cy * d.z);
	float ct = cos(tilt);
	float st = sin(tilt);
	d = vec3(d.x, ct * d.y - st * d.z, st * d.y + ct * d.z);
	float u = atan(d.x, -d.z) / 6.2831853 + 0.5;
	float v = acos(clamp(d.y, -1.0, 1.0)) / 3.1415927;
	vec3 col = texture(panorama, vec2(u, v)).rgb * panorama_gain;
	vec4 gi = giant(EYEDIR, normalize(LIGHT0_DIRECTION));
	if (AT_CUBEMAP_PASS) {
		col = mix(col, gi.rgb * giant_gain, gi.a) + gi.rgb * (1.0 - gi.a) * giant_gain;
		COLOR = col * 1.5 * brightness;
	} else {
		col += stars(EYEDIR, 160.0, 0.32, 0.12, 1.0) * star_gain;
		col += stars(EYEDIR, 380.0, 0.38, 0.16, 0.45) * star_gain;
		// The grain between them: thousands of stars too faint to name, which
		// is what makes a sky look deep rather than painted.
		col += stars(EYEDIR, 760.0, 0.5, 0.14, 0.16) * star_gain;
		col += stars(EYEDIR, 60.0, 0.12, 0.05, 4.0) * star_gain;
		// The giant covers the stars and the nebulae behind it.
		col = mix(col, gi.rgb * giant_gain, gi.a) + gi.rgb * (1.0 - gi.a) * giant_gain;
		COLOR = col * brightness;
	}
}
