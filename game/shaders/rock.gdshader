shader_type spatial;
render_mode cull_disabled;
// Sandstone pillars, arches and cliffs: rock mapped from the side, streaked
// by water running down it, with moss and jungle wherever a surface faces
// the sky, and darker toward the base where the mist keeps it wet.

uniform sampler2D rock_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D moss_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 rock_tint = vec3(0.86, 0.74, 0.6);

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec3 n = normalize(wnrm);
	vec2 side = abs(n.x) > abs(n.z) ? wpos.zy : wpos.xy;
	vec3 r = texture(rock_map, side / vec2(16.0, 40.0)).rgb;
	r = mix(r, texture(rock_map, side / 5.0).rgb, 0.5) * rock_tint * 1.7;
	// Vertical water streaks and bands of strata.
	float streak = vnoise(vec2(side.x * 0.35, side.y * 0.01));
	float strata = vnoise(vec2(side.x * 0.02, side.y * 0.12));
	r *= mix(0.62, 1.12, streak) * mix(0.85, 1.08, strata);
	// Moss where the rock faces up, and in patches on the walls.
	float up = smoothstep(0.35, 0.75, n.y);
	float patch = smoothstep(0.62, 0.8, vnoise(side * 0.03 + 7.0)) * 0.7;
	float moss_amt = clamp(up + patch * (1.0 - up), 0.0, 1.0);
	vec3 moss = texture(moss_map, wpos.xz / 7.0 + side / 9.0).rgb * vec3(0.55, 0.85, 0.35);
	vec3 col = mix(r, moss, moss_amt);
	ALBEDO = col * mix(0.7, 1.0, smoothstep(-20.0, 140.0, wpos.y));
	NORMAL_MAP = texture(rock_normal, side / 8.0).rgb;
	ROUGHNESS = 0.92;
	SPECULAR = 0.25;
}
