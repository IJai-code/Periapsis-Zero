shader_type spatial;
render_mode specular_schlick_ggx;
// Crystal: dark glassy body, sharp highlights off each facet, light that
// seems to come from inside (a pattern seen along the refracted view, so it
// shifts as you move round it), and a bright fresnel rim.
uniform vec3 tint : source_color = vec3(0.6, 0.45, 1.0);
uniform float glow = 0.35;
uniform float clarity = 0.5;

float hash3(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

varying vec3 obj;

void vertex() {
	obj = VERTEX;
}

void fragment() {
	float nv = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float fres = pow(1.0 - nv, 3.0);
	// Into the stone along the bent view: veils and flaws deeper in.
	vec3 r = refract(-VIEW, NORMAL, 0.66);
	vec3 rw = (INV_VIEW_MATRIX * vec4(r, 0.0)).xyz;
	vec3 p = obj * 2.2 + rw * 1.6;
	float veil = noise3(p * 1.7) * 0.6 + noise3(p * 4.3) * 0.4;
	float flaw = smoothstep(0.72, 0.9, noise3(p * 3.1 + 7.0));
	// Brighter toward the tips (light gathers where the crystal narrows).
	float tipk = smoothstep(0.2, 2.6, obj.y);
	vec3 inner = tint * (0.25 + 0.75 * veil) * (0.55 + 0.6 * tipk) + vec3(flaw) * 0.35 * clarity;
	ALBEDO = tint * 0.08;
	ROUGHNESS = 0.04;
	METALLIC = 0.0;
	SPECULAR = 0.9;
	EMISSION = inner * glow + tint * fres * 0.5;
	BACKLIGHT = tint * 0.5;
}
