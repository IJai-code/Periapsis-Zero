shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, fog_disabled, shadows_disabled;
// The Lantern: a boiling surface of hot cells and darker lanes, brightest at
// the centre of its disc. `heat` reddens it as it ages; `flicker` makes it
// stutter before the collapse. Drawn after the air, so it shows through.

uniform float heat = 0.0;
uniform float flicker = 0.0;
uniform float power = 1.0;

varying vec3 lpos;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	lpos = normalize(VERTEX);
}

void fragment() {
	vec3 p = lpos * 9.0;
	float cells = noise(p + TIME * 0.15) * 0.6 + noise(p * 2.3 - TIME * 0.22) * 0.4;
	float centre = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	vec3 hot = mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 0.42, 0.18), heat);
	vec3 cool = mix(vec3(1.0, 0.45, 0.15), vec3(0.6, 0.12, 0.05), heat);
	vec3 c = mix(cool, hot, smoothstep(0.35, 0.75, cells)) * (0.65 + 0.6 * pow(centre, 0.6));
	// A dying star stutters slowly (a strobe would be hard to look at).
	float fl = 1.0 - flicker * 0.3 * (0.5 + 0.5 * sin(TIME * 2.4) * sin(TIME * 0.9 + 1.0));
	ALBEDO = c * 4.0 * power * fl;
	ALPHA = 1.0;
}
