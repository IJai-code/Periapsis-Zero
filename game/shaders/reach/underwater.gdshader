shader_type canvas_item;
// Under water (ReachHud.underwater): the view seen through it, wavering a
// little, tinted green-blue, darker at the edges, with the light from the
// surface rippling down across it.

uniform sampler2D screen : hint_screen_texture, filter_linear;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 wob = vec2(sin(uv.y * 22.0 + TIME * 1.8), cos(uv.x * 18.0 + TIME * 1.4)) * 0.0035;
	vec3 c = texture(screen, uv + wob).rgb;
	c = mix(c, c * vec3(0.45, 0.85, 0.9) + vec3(0.0, 0.05, 0.06), 0.75);
	// Light from the surface: bright threads sliding across, strongest high.
	float caus = noise(uv * vec2(14.0, 9.0) + vec2(TIME * 0.4, TIME * 0.25));
	caus = smoothstep(0.62, 0.9, caus) * (1.0 - uv.y) * 0.35;
	c += vec3(0.5, 0.85, 0.85) * caus;
	float v = smoothstep(1.25, 0.45, length(uv - 0.5) * 1.6);
	COLOR = vec4(c * mix(0.55, 1.0, v), 1.0);
}
