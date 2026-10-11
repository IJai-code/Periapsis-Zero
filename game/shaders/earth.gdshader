shader_type spatial;
// Earth from orbit: NASA day and night imagery. Deep oceans with the Sun's
// glint, land with relief, city lights only on the night side, and the air
// itself: a blue haze that thickens toward the limb on the day side and
// warms to orange along the terminator. Cloud shadows darken the ground.

uniform sampler2D day_map : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D night_map : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D spec_map : filter_linear_mipmap;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap;
uniform sampler2D cloud_map : filter_linear_mipmap_anisotropic;
uniform vec3 sun_dir = vec3(1.0, 0.0, 0.0);
uniform float drift = 0.0;

varying vec3 world_n;

void vertex() {
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	float ocean = texture(spec_map, UV).r;
	vec3 day = texture(day_map, UV).rgb;
	// Oceans read deep navy from orbit; land keeps its colour, a little richer.
	vec3 land = pow(day, vec3(1.25)) * 1.05;
	vec3 sea = mix(vec3(0.004, 0.018, 0.05), day * vec3(0.35, 0.55, 0.8), 0.35);
	vec3 albedo = mix(land, sea, ocean);
	float cloud = texture(cloud_map, UV + vec2(drift, 0.0) + vec2(0.0012, 0.0006)).r;
	albedo *= 1.0 - smoothstep(0.25, 0.9, cloud) * 0.45;
	ALBEDO = albedo;
	NORMAL_MAP = texture(normal_map, UV).rgb;
	NORMAL_MAP_DEPTH = 0.8 * (1.0 - ocean);
	ROUGHNESS = mix(0.92, 0.32, ocean);
	SPECULAR = mix(0.2, 0.55, ocean);
	vec3 n = normalize(world_n);
	float ndl = dot(n, normalize(sun_dir));
	vec3 lights = texture(night_map, UV).rgb;
	EMISSION = lights * lights * vec3(1.0, 0.78, 0.5) * smoothstep(0.08, -0.22, ndl) * 2.6 * (1.0 - cloud * 0.7);
	// The atmosphere seen from above: haze grows toward the limb, blue by
	// day, orange at the terminator.
	float rim = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float haze = pow(rim, 2.2);
	float lit = smoothstep(-0.18, 0.3, ndl);
	float dusk = exp(-ndl * ndl * 28.0);
	vec3 sky = mix(vec3(1.0, 0.42, 0.14), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.3, ndl));
	EMISSION += sky * (haze * 0.85 + 0.04) * (lit * 0.55 + dusk * 0.25);
}
