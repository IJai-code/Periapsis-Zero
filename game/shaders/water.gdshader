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
	float a = vnoise(p * 0.08 + vec2(0.0, t * 0.6));
	float b = vnoise(p * 0.21 - vec2(t * 0.3, t * 0.9));
	vec3 n = normalize(vec3((a - 0.5) * 0.5 + (b - 0.5) * 0.3, 1.0, (b - 0.5) * 0.5));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	ALBEDO = mix(deep, shallow, a * 0.5);
	ROUGHNESS = 0.06;
	METALLIC = 0.0;
	SPECULAR = 0.6 + fres * 0.4;
	EMISSION = vec3(0.6, 0.65, 0.7) * fres * 0.25;
}
