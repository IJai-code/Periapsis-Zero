shader_type spatial;
render_mode cull_back;
// A lake or a sea on a small world: deep where it is deep, ripples moving
// across it, the sky in it at a glancing angle, glints in the sun.

uniform vec3 deep : source_color = vec3(0.03, 0.1, 0.12);
uniform vec3 shallow : source_color = vec3(0.1, 0.26, 0.24);

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
	lpos = VERTEX;
}

void fragment() {
	vec3 p = lpos;
	float a = noise(p * 0.18 + vec3(TIME * 0.4, 0.0, TIME * 0.3));
	float b = noise(p * 0.55 - vec3(TIME * 0.6, TIME * 0.2, 0.0));
	vec3 n = normalize(NORMAL + (VIEW_MATRIX * vec4(vec3(a - 0.5, 0.0, b - 0.5) * 0.25, 0.0)).xyz);
	NORMAL = n;
	float fres = pow(1.0 - clamp(dot(n, VIEW), 0.0, 1.0), 4.0);
	ALBEDO = mix(deep, shallow, a * 0.5);
	ROUGHNESS = 0.05;
	SPECULAR = 0.7;
	EMISSION = vec3(0.45, 0.55, 0.7) * fres * 0.25;
}
