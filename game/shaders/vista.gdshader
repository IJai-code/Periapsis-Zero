shader_type spatial;
// The far mountains: forest (rendered leaves, tiled large) low and on the
// gentle slopes, bare rock on the steep, snow on the high peaks. Seen only
// from afar, through the haze; cheap.

uniform sampler2D canopy_map : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D rock_map : source_color, filter_linear_mipmap, repeat_enable;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(wnrm);
	float steep = 1.0 - smoothstep(0.55, 0.8, n.y);
	vec4 can = texture(canopy_map, wpos.xz / 140.0);
	vec3 forest = mix(vec3(0.03, 0.07, 0.02), can.rgb * vec3(0.7, 0.9, 0.6), can.a);
	vec3 rock = texture(rock_map, wpos.xy / 260.0 + wpos.zy / 300.0).rgb * vec3(0.95, 0.85, 0.72) * 1.4;
	vec3 col = mix(forest, rock, steep);
	col = mix(col, rock * 0.9, smoothstep(1400.0, 2000.0, wpos.y));
	float snow = smoothstep(2150.0, 2450.0, wpos.y + n.y * 220.0) * smoothstep(0.35, 0.6, n.y);
	col = mix(col, vec3(0.95, 0.96, 1.0), snow);
	ALBEDO = col;
	ROUGHNESS = mix(0.95, 0.6, snow);
	SPECULAR = 0.2;
}
