shader_type spatial;
// Door trim: worn ember and void stripes at 45 degrees, in world space.

uniform sampler2D rough_map : filter_linear_mipmap_anisotropic;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic;
uniform vec3 ember : source_color = vec3(1.0, 0.42, 0.17);
uniform vec3 dark : source_color = vec3(0.07, 0.045, 0.13);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float s = step(0.5, fract((wpos.x + wpos.y + wpos.z) * 3.0));
	vec2 uv = (wpos.xy + wpos.zy) * 0.7;
	float wear = texture(rough_map, uv * 0.5).r;
	ALBEDO = mix(dark, ember * mix(0.75, 1.0, wear), s);
	ROUGHNESS = mix(0.45, 0.85, wear);
	NORMAL_MAP = texture(normal_map, uv).rgb;
}
