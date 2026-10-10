shader_type spatial;
// Earth from orbit: NASA day and night imagery, ocean glint from the specular
// mask, city lights only on the night side, a soft terminator.

uniform sampler2D day_map : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D night_map : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D spec_map : filter_linear_mipmap;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap;
uniform vec3 sun_dir = vec3(1.0, 0.0, 0.0);

varying vec3 world_n;

void vertex() {
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	float ocean = texture(spec_map, UV).r;
	vec3 day = texture(day_map, UV).rgb;
	// The imagery is graded bright for maps; from orbit the oceans read deep.
	ALBEDO = day * day * mix(0.9, 0.55, ocean);
	NORMAL_MAP = texture(normal_map, UV).rgb;
	NORMAL_MAP_DEPTH = 0.6 * (1.0 - ocean);
	ROUGHNESS = mix(0.95, 0.5, ocean);
	SPECULAR = mix(0.15, 0.35, ocean);
	float ndl = dot(normalize(world_n), normalize(sun_dir));
	vec3 lights = texture(night_map, UV).rgb;
	EMISSION = lights * lights * vec3(1.0, 0.8, 0.55) * smoothstep(0.05, -0.2, ndl) * 3.0;
}
