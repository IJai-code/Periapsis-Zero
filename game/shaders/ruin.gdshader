shader_type spatial;
render_mode cull_disabled;
// The drowned city's towers: weathered concrete, rows of empty windows, moss
// climbing from the waterline and covering every ledge, vines in streaks.

uniform sampler2D moss_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;

varying vec3 lpos;
varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	lpos = VERTEX;
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec3 n = normalize(NORMAL);
	vec3 ln = normalize(wnrm);
	vec2 side = abs(lpos.x) > abs(lpos.z) * 0.999 ? lpos.zy : lpos.xy;
	vec3 concrete = texture(rock_map, side / 9.0).rgb * vec3(0.95, 0.93, 0.88) * 2.1;
	// Windows: a grid of dark openings, some floors gone entirely.
	vec2 cell = vec2(side.x / 4.2, side.y / 3.6);
	vec2 f = fract(cell);
	float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.85);
	float gone = step(0.86, hash(floor(cell.yy) + 3.0));
	win = max(win, gone * step(0.1, f.y));
	// The modelled towers have real window openings; no painted ones.
	win = 0.0;
	vec3 col = mix(concrete, vec3(0.02, 0.025, 0.02), win * 0.92);
	// Moss and vines.
	float base = 1.0 - smoothstep(4.0, 40.0 + 30.0 * vnoise(side * 0.05), wpos.y);
	float ledge = smoothstep(0.5, 0.8, ln.y);
	float vine = smoothstep(0.55, 0.85, vnoise(vec2(side.x * 0.25, side.y * 0.015))) * (1.0 - win * 0.5);
	float moss_amt = clamp(base + ledge + vine * 0.85, 0.0, 1.0);
	vec3 moss = texture(moss_map, side / 6.0).rgb * vec3(0.5, 0.82, 0.32);
	ALBEDO = mix(col, moss, moss_amt);
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
}
