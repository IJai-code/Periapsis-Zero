shader_type canvas_item;
// Waking up: the view blurred and closed in at the edges, clearing as
// `amount` goes from 1 to 0.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float amount = 0.0;

void fragment() {
	vec2 uv = SCREEN_UV;
	// A slow double image while the eyes focus.
	vec2 off = vec2(0.012, 0.004) * amount * sin(TIME * 1.3);
	vec3 c = (textureLod(screen_tex, uv + off, amount * 5.5).rgb + textureLod(screen_tex, uv - off, amount * 5.5).rgb) * 0.5;
	float v = smoothstep(0.95, 0.25, length((uv - 0.5) * vec2(1.4, 1.0)));
	c *= mix(1.0, v * v, amount);
	COLOR = vec4(c, step(0.001, amount));
}
