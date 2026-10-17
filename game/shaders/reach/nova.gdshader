shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled, fog_disabled;
// The Lantern's last light: a shell of blue-white fire racing outward, its
// rim blazing (seen edge-on), its face torn into streaming filaments.

uniform float intensity = 1.0;
uniform float age = 0.0;

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
	vec3 n = normalize(lpos);
	float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float rim = pow(1.0 - facing, 2.2);
	float streaks = noise(n * 9.0 + vec3(0.0, age * 0.6, 0.0)) * 0.6 + noise(n * 23.0 - age * 0.4) * 0.4;
	float body = smoothstep(0.35, 0.85, streaks);
	vec3 col = mix(vec3(0.55, 0.8, 1.0), vec3(1.0, 1.0, 1.0), rim);
	ALBEDO = col * (rim * 3.0 + body * 0.6 + 0.08) * intensity;
}
