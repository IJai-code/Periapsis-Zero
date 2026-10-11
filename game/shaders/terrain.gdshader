shader_type spatial;
// Wild ground: jungle floor on the flats, sandstone on the slopes, wet dark
// banks by the water, all mapped from above and the side in world space (no
// UVs), with large-scale colour drift so the land never repeats.

uniform sampler2D ground_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ground_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D rock_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D canopy_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 rock_tint = vec3(0.86, 0.74, 0.6);
uniform float water_level = -1.0;

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
	float flat_ = smoothstep(0.62, 0.86, n.y);
	float dist = length(wpos - CAMERA_POSITION_WORLD);
	float fine = 1.0 - smoothstep(60.0, 420.0, dist);
	float drift = vnoise(wpos.xz / 420.0);
	// Ground: two scales of the scan (the fine one fades out with distance,
	// where it would only crawl), tinted to wet jungle green.
	vec3 g = mix(texture(ground_map, wpos.xz / 53.0).rgb, texture(ground_map, wpos.xz / 9.0).rgb, 0.55 * fine);
	vec3 jungle = g * mix(vec3(0.34, 0.6, 0.24), vec3(0.5, 0.72, 0.3), drift) * 0.9;
	// Forest canopy (rendered leaves) on gentle ground, in large patches.
	vec4 can = texture(canopy_map, wpos.xz / 24.0 + drift * 0.8);
	float forest = smoothstep(0.12, 0.4, drift + 0.2) * smoothstep(0.7, 0.9, n.y) * smoothstep(water_level + 4.0, water_level + 14.0, wpos.y);
	vec3 canopy = mix(vec3(0.05, 0.1, 0.03), can.rgb, can.a) * vec3(0.85, 1.0, 0.8);
	jungle = mix(jungle, canopy, forest * 0.9);
	// Rock on the steep parts, mapped from the side it faces.
	vec2 side = abs(n.x) > abs(n.z) ? wpos.zy / 14.0 : wpos.xy / 14.0;
	vec3 r = texture(rock_map, side * vec2(1.0, 0.35)).rgb * rock_tint * 1.6;
	vec3 col = mix(r, jungle, flat_);
	float wet = 1.0 - smoothstep(water_level, water_level + 3.0, wpos.y);
	col *= mix(1.0, 0.45, wet);
	ALBEDO = col;
	vec3 nm = flat_ > 0.5 ? texture(ground_normal, wpos.xz / 9.0).rgb : texture(rock_normal, side).rgb;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nm, 0.3 + 0.6 * fine);
	ROUGHNESS = mix(0.95, 0.35, wet);
	SPECULAR = 0.3;
}
