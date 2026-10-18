shader_type spatial;
render_mode cull_disabled, depth_draw_never, specular_schlick_ggx;
// A lake or a sea on a small world. How deep the water is at each pixel (the
// scene's depth behind it, less the surface's) colours it: clear and warm
// over the shallows, deep teal further out; foam where it meets a shore or a
// post; ripples moving across it; the sky in it at a glancing angle; glints
// in the sun.

uniform vec3 deep : source_color = vec3(0.02, 0.12, 0.16);
uniform vec3 shallow : source_color = vec3(0.16, 0.42, 0.4);
uniform vec3 sky_tint : source_color = vec3(0.55, 0.7, 0.85);
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;

varying vec3 lpos;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	lpos = VERTEX;
}

void fragment() {
	vec3 p = lpos;
	float a = noise(p * 0.22 + vec3(TIME * 0.35, 0.0, TIME * 0.27));
	float b = noise(p * 0.7 - vec3(TIME * 0.55, TIME * 0.2, 0.0));
	float c = noise(p * 2.1 + vec3(0.0, TIME * 0.8, TIME * 0.6));
	vec3 ripple = vec3(a - 0.5, 0.0, b - 0.5) * 0.22 + vec3(c - 0.5, 0.0, 0.5 - c) * 0.08;
	vec3 n = normalize(NORMAL + (VIEW_MATRIX * vec4(ripple, 0.0)).xyz);
	NORMAL = n;
	// How much water lies between this surface and what is behind it.
	float raw = texture(depth_tex, SCREEN_UV).r;
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, raw);
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	ndc.z = raw * 2.0 - 1.0;
#endif
	vec4 behind = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	behind.xyz /= behind.w;
	float depth = max(-behind.z - (-VERTEX.z), 0.0);
	float d = smoothstep(0.0, 3.2, depth);
	vec3 col = mix(shallow, deep, d);
	// Foam: a ragged band at the very edge.
	float foam = smoothstep(0.45, 0.05, depth) * smoothstep(0.35, 0.65, noise(p * 3.0 + vec3(TIME * 0.4)));
	col = mix(col, vec3(0.92, 0.95, 0.95), foam * 0.8);
	float fres = pow(1.0 - clamp(dot(n, VIEW), 0.0, 1.0), 3.0);
	ALBEDO = col;
	ALPHA = clamp(mix(0.45, 0.94, d) + foam * 0.5 + fres * 0.3, 0.0, 1.0);
	ROUGHNESS = mix(0.04, 0.4, foam);
	SPECULAR = 0.8;
	EMISSION = sky_tint * fres * 0.35;
}
