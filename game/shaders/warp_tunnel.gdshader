shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// The warp tunnel: streaks of light racing past along a long open cylinder
// round the ship, fading at both ends. `strength` brings it in and out.

uniform float strength = 0.0;
uniform float rush = 3.0;

float hash(float n) { return fract(sin(n * 91.7) * 43758.5453); }

void fragment() {
	float a = UV.x * 90.0;
	float lane = floor(a);
	float h = hash(lane);
	float y = fract(UV.y * (2.0 + h * 3.0) + TIME * rush * (0.6 + h));
	float across = 1.0 - abs(fract(a) - 0.5) * 2.0;
	float streak = pow(across, 10.0) * smoothstep(0.0, 0.5, y) * smoothstep(1.0, 0.7, y) * step(0.35, h);
	float ends = smoothstep(0.0, 0.25, UV.y) * smoothstep(1.0, 0.75, UV.y);
	vec3 col = mix(vec3(0.18, 0.83, 1.0), vec3(0.96, 0.91, 0.81), hash(lane + 3.0));
	float haze = 0.04 * ends;
	ALBEDO = (col * streak * 2.6 + vec3(0.2, 0.5, 0.9) * haze) * ends * strength;
}
