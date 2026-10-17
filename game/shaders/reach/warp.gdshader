shader_type canvas_item;
// The end of a loop: the view pulled toward the Lantern, rippling, colours
// splitting at the edges, the light going blue-white.

uniform sampler2D screen : hint_screen_texture, filter_linear;
uniform float amount = 0.0;
uniform vec2 center = vec2(0.5);

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 d = uv - center;
	float r = length(d);
	vec2 dir = d / max(r, 0.0001);
	float wob = sin(r * 28.0 - TIME * 3.2) * 0.0045 * amount;
	float pull = amount * amount * 0.09 * smoothstep(0.0, 0.9, r);
	vec2 at = uv - dir * (pull + wob);
	float split = 0.007 * amount;
	vec3 col;
	col.r = texture(screen, at - dir * split).r;
	col.g = texture(screen, at).g;
	col.b = texture(screen, at + dir * split).b;
	float grey = dot(col, vec3(0.3, 0.5, 0.2));
	col = mix(col, vec3(0.75, 0.88, 1.0) * grey * 1.2, amount * 0.3);
	col *= 1.0 - smoothstep(0.3, 1.0, r) * amount * 0.65;
	COLOR = vec4(col, 1.0);
}
