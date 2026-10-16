shader_type spatial;
// A wet street at night. Puddles lie where a slow noise says; in them the
// scene above reflects, by a cheap planar trick: the view ray is mirrored
// in the ground, points along it are projected back to the screen and the
// screen is sampled there (neon streaks down into the wet, as it does in
// the rain). Between puddles the asphalt is damp and dull. Rain dimples the
// puddles. Works in both renderers (no ray marching, four taps).

uniform sampler2D albedo_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D screen : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform float scale = 0.35;
uniform vec3 tint : source_color = vec3(0.42, 0.42, 0.46);
uniform float wet = 0.65;
uniform float puddles = 0.55;

varying vec3 wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	vec3 base = texture(albedo_map, p * scale).rgb * tint;
	float pool = smoothstep(puddles, puddles + 0.12, noise(p * 0.18) * 0.65 + noise(p * 0.7) * 0.35);
	// Rain rings in the puddles.
	vec2 c = floor(p * 1.5);
	float t = fract(TIME * 0.8 + hash(c));
	float ring = smoothstep(0.03, 0.0, abs(length(fract(p * 1.5) - 0.5 - (hash(c + 3.1) - 0.5) * 0.4) - t * 0.4)) * (1.0 - t);
	NORMAL_MAP = mix(texture(normal_map, p * scale).xyz, vec3(0.5 + ring * 0.25, 0.5, 1.0), pool);
	NORMAL_MAP_DEPTH = mix(1.0, 0.3, pool);
	// The mirrored view ray, sampled at four distances.
	vec3 n = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	vec3 r = reflect(normalize(VERTEX), n);
	vec3 refl = vec3(0.0);
	float wsum = 0.0;
	for (int i = 0; i < 4; i++) {
		float d = 3.0 * pow(2.2, float(i));
		vec4 clip = PROJECTION_MATRIX * vec4(VERTEX + r * d + vec3(ring * 0.15, 0.0, 0.0), 1.0);
		vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
		float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, clip.w);
		refl += textureLod(screen, uv, 1.5 + float(i)).rgb * inside;
		wsum += inside;
	}
	refl /= max(wsum, 1.0);
	float fresnel = 0.25 + 0.75 * pow(1.0 - clamp(dot(normalize(-VERTEX), n), 0.0, 1.0), 3.0);
	float k = mix(wet * 0.35, 1.0, pool) * fresnel;
	ALBEDO = base * mix(1.0, 0.45, mix(wet, 1.0, pool));
	ROUGHNESS = mix(mix(0.9, 0.45, wet), 0.04, pool);
	EMISSION = refl * k * 0.9;
}
