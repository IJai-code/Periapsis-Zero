shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;
// The cloud deck, a few kilometres above the surface: NASA's cloud cover,
// sharpened, lit by the Sun, faintly orange along the terminator and dark on
// the night side.

uniform sampler2D cloud_map : filter_linear_mipmap_anisotropic;
uniform float drift = 0.0;
uniform vec3 sun_dir = vec3(1.0, 0.0, 0.0);

varying vec3 world_n;

void vertex() {
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	float c = texture(cloud_map, UV + vec2(drift, 0.0)).r;
	float a = smoothstep(0.12, 0.85, c);
	float ndl = dot(normalize(world_n), normalize(sun_dir));
	float dusk = exp(-ndl * ndl * 30.0);
	// No ambient on the night side: clouds there are all but invisible.
	float lit = smoothstep(-0.22, 0.12, ndl);
	ALBEDO = mix(vec3(0.82, 0.84, 0.88), vec3(1.0, 0.62, 0.38), dusk * 0.6) * (0.04 + 0.96 * lit);
	// Thin at the limb, as the real deck looks edge-on.
	float rim = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	ALPHA = a * 0.92 * (1.0 - pow(rim, 6.0) * 0.6);
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
