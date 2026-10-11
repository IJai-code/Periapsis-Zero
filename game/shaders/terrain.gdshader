shader_type spatial;
// Wild ground: jungle floor on the flats, sandstone on the slopes, wet dark
// banks by the water, all mapped from above and the side in world space (no
// UVs), with large-scale colour drift so the land never repeats.

uniform sampler2D ground_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ground_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D rock_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_normal : hint_normal, filter_linear_mipmap, repeat_enable;
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
	vec2 top = wpos.xz / 9.0;
	vec3 g = texture(ground_map, top).rgb;
	vec3 g2 = texture(ground_map, wpos.xz / 53.0).rgb;
	g = mix(g, g2, 0.45);
	// Side mapping for rock: the axis the surface faces most.
	vec2 side = abs(n.x) > abs(n.z) ? wpos.zy / 14.0 : wpos.xy / 14.0;
	vec3 r = texture(rock_map, side * vec2(1.0, 0.35)).rgb * rock_tint * 1.6;
	float drift = vnoise(wpos.xz / 420.0);
	// The scan is a meadow; the valley is jungle: deeper, wetter greens.
	vec3 jungle = g * mix(vec3(0.34, 0.6, 0.24), vec3(0.5, 0.72, 0.3), drift) * 0.9;
	vec3 col = mix(r, jungle, flat_);
	// Wet banks and shallows.
	float wet = 1.0 - smoothstep(water_level, water_level + 3.0, wpos.y);
	col *= mix(1.0, 0.45, wet);
	ALBEDO = col;
	vec3 nm = mix(texture(rock_normal, side).rgb, texture(ground_normal, top).rgb, flat_);
	NORMAL_MAP = nm;
	ROUGHNESS = mix(0.95, 0.35, wet);
	SPECULAR = 0.3;
}
