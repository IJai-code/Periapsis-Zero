shader_type canvas_item;
// The camera's own look over every scene: a soft vignette and a fine,
// moving grain, the way a lens and film would leave it. Under the HUD.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float vignette = 0.32;
uniform float grain = 0.035;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	vec3 c = texture(screen_tex, SCREEN_UV).rgb;
	vec2 q = (SCREEN_UV - 0.5) * vec2(1.25, 1.0);
	c *= 1.0 - vignette * smoothstep(0.25, 0.85, length(q));
	float n = hash(SCREEN_UV * 1000.0 + fract(TIME * 7.3) * 91.0) - 0.5;
	c += n * grain * (0.6 + 0.4 * (1.0 - dot(c, vec3(0.333))));
	COLOR = vec4(c, 1.0);
}
