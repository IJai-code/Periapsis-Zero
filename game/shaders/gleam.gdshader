// The gleam: a river of tiny living lights drinking the Lantern and drifting
// down into the Nadir. A ribbon along a curve (each vertex sits on the
// curve, its NORMAL the curve's tangent, UV.y which edge), turned to face
// the eye here, so it reads as a thread of light from any side. Motes flow
// along it toward the Nadir; it brightens where it leaves the star and
// where it spirals into the disk.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled, world_vertex_coords;

uniform float width = 210.0;
uniform float flow = 0.012;
uniform float power = 1.0;
uniform vec3 hot = vec3(1.0, 0.78, 0.42);
uniform vec3 cool = vec3(0.55, 0.8, 1.0);

varying float edge;
varying float along;
varying float near;

void vertex() {
	vec3 t = normalize(NORMAL);
	vec3 view = normalize(VERTEX - CAMERA_POSITION_WORLD);
	vec3 side = cross(t, view);
	float sl = length(side);
	side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
	float w = width * COLOR.r;
	VERTEX += side * w * (UV.y * 2.0 - 1.0);
	edge = UV.y * 2.0 - 1.0;
	along = UV.x;
	near = length(VERTEX - CAMERA_POSITION_WORLD);
}

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	float x = along;
	float core = exp(-edge * edge * 5.0);
	// The current: broad streaks, and motes riding them.
	float s = x * 900.0 - TIME * flow * 900.0;
	float streak = vnoise(vec2(s * 0.05, edge * 3.0)) * 0.7 + vnoise(vec2(s * 0.2, edge * 7.0)) * 0.3;
	vec2 cell = vec2(s * 1.6, edge * 9.0);
	float mote = smoothstep(0.93, 1.0, hash(floor(cell))) * smoothstep(0.5, 0.0, length(fract(cell) - 0.5));
	// Bright where it leaves the star and where it goes in.
	float ends = 0.35 + 0.65 * (smoothstep(0.25, 0.0, x) + smoothstep(0.82, 1.0, x));
	vec3 c = mix(hot, cool, smoothstep(0.2, 0.95, x));
	float i = (core * (0.3 + streak * 0.7) * 0.55 + mote * core * 2.2) * ends * power;
	// Never a blinding sheet right in front of you.
	i *= smoothstep(30.0, 260.0, near);
	ALBEDO = c * i;
}
