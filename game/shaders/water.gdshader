shader_type spatial;
render_mode cull_disabled;
// River and lake water: deep green-blue, ripples moving downstream, the sky
// and sun in it at a glancing angle.

uniform vec3 deep : source_color = vec3(0.04, 0.12, 0.13);
uniform vec3 shallow : source_color = vec3(0.12, 0.3, 0.26);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 p = wpos.xz;
	float t = TIME;
	// Three scales of ripple running downstream, the small ones fastest.
	float a = vnoise(p * 0.11 + vec2(0.0, t * 0.5));
	float b = vnoise(p * 0.37 - vec2(t * 0.35, t * 1.1));
	float c = vnoise(p * 1.3 + vec2(t * 0.8, t * 1.9));
	vec3 n = normalize(vec3((a - 0.5) * 0.35 + (b - 0.5) * 0.25 + (c - 0.5) * 0.12, 1.0, (b - 0.5) * 0.3 + (c - 0.5) * 0.1));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 5.0);
	// The evening sky in it at a glancing angle, the water's own colour
	// looking down; glints where the small ripples catch the sun.
	vec3 sky = mix(vec3(0.55, 0.62, 0.75), vec3(1.0, 0.72, 0.45), smoothstep(0.6, 1.0, a));
	ALBEDO = mix(deep, shallow, a * 0.45 + c * 0.1);
	ROUGHNESS = 0.04;
	METALLIC = 0.0;
	SPECULAR = 0.7;
	EMISSION = sky * fres * 0.55 + vec3(1.0, 0.85, 0.6) * pow(c * b, 6.0) * 0.6;
}