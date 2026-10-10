shader_type spatial;
render_mode cull_disabled;
// Deck grating: the walkway maps laid flat in world space, see-through where
// the opacity map says so, onto the lit trench below.

uniform sampler2D color_map : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D rough_map : filter_linear_mipmap_anisotropic;
uniform sampler2D metal_map : filter_linear_mipmap_anisotropic;
uniform sampler2D opacity_map : filter_linear_mipmap_anisotropic;
uniform float scale = 1.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz * scale;
	vec3 c = texture(color_map, uv).rgb;
	// Rust kept as grime, not as orange.
	ALBEDO = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.25) * 0.9;
	NORMAL_MAP = texture(normal_map, uv).rgb;
	ROUGHNESS = texture(rough_map, uv).r;
	METALLIC = texture(metal_map, uv).r;
	ALPHA = texture(opacity_map, uv).r;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
