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
	// The floor: deep moss in the hollows, brighter grass on the rises, dry
	// clearings here and there, all drifting at several scales.
	float patch = vnoise(wpos.xz / 90.0) * 0.6 + vnoise(wpos.xz / 23.0) * 0.4;
	vec3 moss = vec3(0.18, 0.36, 0.16);
	vec3 grass = vec3(0.44, 0.66, 0.26);
	vec3 dry = vec3(0.62, 0.56, 0.32);
	vec3 floor_col = mix(moss, grass, smoothstep(0.35, 0.7, patch));
	floor_col = mix(floor_col, dry, smoothstep(0.78, 0.92, vnoise(wpos.xz / 160.0 + 7.0)) * 0.6);
	vec3 jungle = g * floor_col * mix(0.85, 1.12, drift) * 1.25;
	// Forest canopy (rendered leaves) over the land beyond the near ground:
	// on the flats and up the slopes, in big stands with clearings.
	// Two scales, turned against each other, so the leaves never tile.
	vec2 q = wpos.xz;
	vec4 can = texture(canopy_map, vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8) / 37.0 + drift * 0.8);
	vec4 can2 = texture(canopy_map, q / 83.0 - drift * 0.3);
	float stand = smoothstep(0.25, 0.45, vnoise(wpos.xz / 260.0) * 0.7 + drift * 0.5);
	float forest = smoothstep(380.0, 1100.0, dist) * stand * smoothstep(0.45, 0.72, n.y) * smoothstep(water_level + 4.0, water_level + 14.0, wpos.y);
	vec3 canopy = mix(vec3(0.03, 0.07, 0.025), mix(can.rgb, can2.rgb, 0.4), max(can.a, can2.a)) * vec3(0.8, 1.0, 0.75);
	jungle = mix(jungle, canopy, forest * 0.95);
	// Rock on the steep parts, mapped from the side it faces, in bands of
	// strata that wander a little.
	vec2 side = abs(n.x) > abs(n.z) ? wpos.zy / 14.0 : wpos.xy / 14.0;
	vec3 r = texture(rock_map, side * vec2(1.0, 0.35)).rgb * rock_tint * 1.6;
	// Strata: uneven beds, some thick, some thin, fading in and out.
	float bed = wpos.y * 0.31 + vnoise(wpos.xz / 55.0) * 6.0 + vnoise(side * 0.7) * 1.2;
	float strata = vnoise(vec2(bed, 3.7)) * 2.0 - 1.0;
	r *= 0.86 + 0.14 * strata * smoothstep(0.2, 0.6, vnoise(wpos.xz / 120.0));
	// Moss creeping onto the rock's upper faces.
	r = mix(r, moss * 1.3, smoothstep(0.35, 0.62, n.y) * 0.7);
	vec3 col = mix(r, jungle, flat_);
	// Pale sand where the river has worked the banks, then wet and dark.
	float bank = smoothstep(water_level + 5.0, water_level + 1.5, wpos.y);
	col = mix(col, vec3(0.62, 0.55, 0.42) * g * 1.8, bank * 0.7 * flat_);
	float wet = 1.0 - smoothstep(water_level, water_level + 1.6, wpos.y);
	col *= mix(1.0, 0.45, wet);
	ALBEDO = col;
	vec3 nm = flat_ > 0.5 ? texture(ground_normal, wpos.xz / 9.0).rgb : texture(rock_normal, side).rgb;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nm, 0.3 + 0.6 * fine);
	ROUGHNESS = mix(0.95, 0.35, wet);
	SPECULAR = 0.3;
}
