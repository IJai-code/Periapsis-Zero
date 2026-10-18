shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// A curtain of aurora: long folds drifting along its length, hot at the hem,
// thinning to nothing at the top and at both ends. `night` fades it with the
// Lantern's own setting.

uniform vec4 low_color : source_color = vec4(0.18, 0.95, 0.6, 1.0);
uniform vec4 high_color : source_color = vec4(0.34, 0.44, 1.0, 1.0);
uniform float night = 0.0;
uniform float seed = 0.0;
uniform float strength = 0.3;
// A ring runs all the way round: no fading at its ends, or the seam shows.
uniform float ring = 1.0;

void fragment() {
	float x = UV.x;
	float y = UV.y;
	float t = TIME * 0.085 + seed * 11.0;
	// Folds: two long waves beating against each other.
	float fold = sin(x * 19.0 + t * 2.1) * 0.5 + 0.5;
	fold *= sin(x * 6.5 - t * 1.2 + 1.7) * 0.5 + 0.5;
	// Nothing at the ends; a hem at the bottom, a slow thinning above it.
	float ends = mix(smoothstep(0.0, 0.13, x) * smoothstep(1.0, 0.87, x), 1.0, ring);
	float curtain = smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.42, 1.0, y));
	float a = ends * curtain * (0.22 + 0.78 * fold) * night;
	// The hem glows: the particles come down here.
	a *= 1.0 + 0.9 * exp(-y * 13.0);
	vec3 c = mix(low_color.rgb, high_color.rgb, smoothstep(0.0, 0.8, y));
	ALBEDO = c * 1.7;
	ALPHA = clamp(a * strength, 0.0, 1.0);
}
