shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;
// Skin. MakeHuman's skins are colour only, so the rest is made here: light
// scattering under the surface (subsurface scattering, desktop), a little
// translucency where it is thin, fine pores and creases from noise, and an
// oilier sheen across the T of the face.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic;
uniform float sss = 0.35;
uniform float pores = 0.06;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec3 c = texture(albedo_tex, UV).rgb;
	ALBEDO = c;
	// Pores at two scales, as a normal perturbation.
	vec2 p = UV * 700.0;
	float e = 1.0;
	float h = noise(p) * 0.65 + noise(p * 2.7) * 0.35;
	float hx = noise(p + vec2(e, 0.0)) * 0.65 + noise((p + vec2(e, 0.0)) * 2.7) * 0.35;
	float hy = noise(p + vec2(0.0, e)) * 0.65 + noise((p + vec2(0.0, e)) * 2.7) * 0.35;
	NORMAL_MAP = normalize(vec3((h - hx) * pores * 4.0, (h - hy) * pores * 4.0, 1.0)) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 1.0;
	// Skin is soft-glossy; pores break the highlight up.
	ROUGHNESS = 0.7 + (h - 0.5) * 0.1;
	SPECULAR = 0.2;
	SSS_STRENGTH = sss;
	// Ears and nostrils glow a little against strong light.
	BACKLIGHT = vec3(0.32, 0.1, 0.06) * 0.25;
	RIM = 0.05;
	RIM_TINT = 0.5;
}
