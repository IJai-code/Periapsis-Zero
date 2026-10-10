shader_type sky;
// Deep space: hashed stars at two densities, a dusty Milky Way band and the
// Sun's disc and glare. Everything bright here is HDR so the glow picks it up.

uniform vec3 band_axis = vec3(0.32, 0.88, 0.35);
uniform float star_gain = 1.0;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

float noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
	return s;
}

vec3 stars(vec3 d, float scale, float density) {
	vec3 p = d * scale;
	vec3 cell = floor(p);
	vec3 h = hash33(cell);
	if (h.x > density) return vec3(0.0);
	vec3 c = cell + 0.2 + 0.6 * hash33(cell + 7.1);
	float r = length(p - c);
	float size = mix(0.03, 0.11, h.y * h.y);
	float b = smoothstep(size, 0.0, r);
	// Star colour by temperature: red dwarfs to blue giants, most near white.
	vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.7, 0.82, 1.0), h.z);
	return tint * b * mix(1.5, 18.0, pow(h.y, 6.0));
}

void sky() {
	vec3 d = EYEDIR;
	vec3 col = vec3(0.0);
	// The galactic band: brightest along a great circle, broken by dust lanes.
	float lat = dot(d, normalize(band_axis));
	float band = exp(-lat * lat * 18.0);
	float dust = fbm(d * 6.0 + 3.0);
	float glow = fbm(d * 2.5) * band;
	col += vec3(0.16, 0.13, 0.11) * glow * smoothstep(0.35, 0.75, dust) * 0.9;
	col += vec3(0.05, 0.06, 0.1) * band * 0.35;
	// More stars where the band is, as in the real sky.
	col += stars(d, 140.0, 0.22 + band * 0.4) * star_gain;
	col += stars(d, 320.0, 0.25 + band * 0.5) * 0.5 * star_gain;
	// The Sun: a hard disc and a soft halo.
	if (LIGHT0_ENABLED) {
		float s = dot(d, LIGHT0_DIRECTION);
		col += vec3(1.0, 0.95, 0.88) * smoothstep(0.99985, 0.99995, s) * 400.0;
		col += vec3(1.0, 0.8, 0.6) * pow(max(s, 0.0), 900.0) * 6.0;
		col += vec3(1.0, 0.75, 0.5) * pow(max(s, 0.0), 40.0) * 0.08;
	}
	COLOR = col;
}
