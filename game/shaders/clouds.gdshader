shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;
// The cloud deck, a few kilometres above the surface, lit like everything else.

uniform sampler2D cloud_map : filter_linear_mipmap_anisotropic;
uniform float drift = 0.0;

void fragment() {
	float c = texture(cloud_map, UV + vec2(drift, 0.0)).a;
	ALBEDO = vec3(1.0);
	ALPHA = smoothstep(0.08, 0.9, c) * 0.95;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
