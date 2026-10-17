shader_type sky;
// Deep space over the Reach, drawn rather than painted: three layers of
// stars, a faint band of the galaxy with dust lanes, and the slow colour of
// distant nebulae. No textures (the panorama images rendered in the wrong
// colours on some browsers).

uniform float brightness = 1.0;

vec3 hash33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

float hash13(vec3 p) { return hash33(p).x; }

float noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
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
	vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.75, 0.85, 1.0), h.z);
	return tint * core * gain * mix(0.5, 2.6, pow(h.y, 4.0));
}

void sky() {
	vec3 d = EYEDIR;
	// The galaxy: a band round a tilted great circle, with dark lanes.
	vec3 axis = normalize(vec3(0.3, 0.9, 0.25));
	float band = exp(-pow(dot(d, axis) * 3.2, 2.0));
	float dust = noise(d * 7.0) * 0.6 + noise(d * 19.0) * 0.4;
	vec3 milky = vec3(0.55, 0.5, 0.62) * band * (0.25 + 0.75 * smoothstep(0.35, 0.75, dust)) * 0.09;
	float neb = noise(d * 2.4 + 4.0) * noise(d * 5.1);
	vec3 nebula = mix(vec3(0.22, 0.12, 0.3), vec3(0.08, 0.2, 0.26), noise(d * 1.7)) * smoothstep(0.2, 0.6, neb) * 0.18;
	vec3 col = milky + nebula;
	if (!AT_CUBEMAP_PASS) {
		col += stars(d, 170.0, 0.3, 0.12, 0.9);
		col += stars(d, 420.0, 0.36 + band * 0.4, 0.16, 0.4);
		col += stars(d, 64.0, 0.1, 0.05, 3.0);
	}
	COLOR = col * brightness;
}
