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
	if (AT_CUBEMAP_PASS) {
		COLOR = col * 1.5 * brightness;
	} else {
		col += stars(EYEDIR, 160.0, 0.32, 0.12, 1.0) * star_gain;
		col += stars(EYEDIR, 380.0, 0.38, 0.16, 0.45) * star_gain;
		// The grain between them: thousands of stars too faint to name, which
		// is what makes a sky look deep rather than painted.
		col += stars(EYEDIR, 760.0, 0.5, 0.14, 0.16) * star_gain;
		col += stars(EYEDIR, 60.0, 0.12, 0.05, 4.0) * star_gain;
		COLOR = col * brightness;
	}
}
