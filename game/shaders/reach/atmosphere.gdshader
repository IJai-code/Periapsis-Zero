shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, blend_mix, shadows_disabled, fog_disabled;
// A body's air, on a sphere at the top of it, drawn from the inside (its far
// side). Along each view ray through the air the shader sums thickness
// (densest low down) and how lit each sample is: blue by day, gold to red
// where the light comes in low, dark by night. Opaque where bright, clear
// where dark, so stars show at night and the limb glows from space.

uniform vec3 center = vec3(0.0);
uniform float planet_r = 280.0;
uniform float air_r = 420.0;
uniform vec3 star_pos = vec3(0.0);
uniform vec3 day : source_color = vec3(0.36, 0.58, 1.0);
uniform vec3 dusk : source_color = vec3(1.0, 0.45, 0.2);
uniform float strength = 1.0;
uniform float star_power = 1.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

vec2 hit(vec3 o, vec3 d, float r) {
	float b = dot(o, d);
	float c = dot(o, o) - r * r;
	float h = b * b - c;
	if (h < 0.0) return vec2(-1.0);
	h = sqrt(h);
	return vec2(-b - h, -b + h);
}

void fragment() {
	vec3 cam = CAMERA_POSITION_WORLD - center;
	vec3 dir = normalize(wpos - CAMERA_POSITION_WORLD);
	vec2 a = hit(cam, dir, air_r);
	float t0 = max(a.x, 0.0);
	float t1 = a.y;
	vec2 g = hit(cam, dir, planet_r);
	if (g.x > 0.0) t1 = min(t1, g.x);
	float len = max(t1 - t0, 0.0);
	vec3 sun = normalize(star_pos - center);
	float scale_h = (air_r - planet_r) * 0.28;
	vec3 sum = vec3(0.0);
	float depth = 0.0;
	for (int i = 0; i < 6; i++) {
		vec3 p = cam + dir * (t0 + len * (float(i) + 0.5) / 6.0);
		float hgt = max(length(p) - planet_r, 0.0);
		float rho = exp(-hgt / scale_h);
		float elev = dot(normalize(p), sun);
		float lit = smoothstep(-0.22, 0.12, elev);
		vec3 c = mix(dusk, day, smoothstep(-0.02, 0.35, elev));
		sum += c * rho * lit;
		depth += rho;
	}
	// Thick enough that a clear day is blue overhead, not just at the rim.
	float k = len / (air_r - planet_r) * 2.2;
	sum *= k / 6.0;
	depth *= k / 6.0;
	// The glow round the Lantern itself, through the air.
	float mie = pow(max(dot(dir, normalize(star_pos - CAMERA_POSITION_WORLD)), 0.0), 24.0);
	vec3 col = sum * 1.3 + vec3(1.0, 0.85, 0.65) * mie * depth * 0.8;
	// Seen from outside, the limb is a long path through the air: softer.
	float inside = 1.0 - smoothstep(air_r * 0.98, air_r * 1.02, length(cam));
	col *= strength * star_power * mix(0.5, 1.0, inside);
	ALBEDO = col;
	ALPHA = clamp(max(col.r, max(col.g, col.b)) * 1.6, 0.0, 1.0) * clamp(depth * 2.5, 0.0, 1.0);
}
