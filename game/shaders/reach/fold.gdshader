shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;
// The Fold: a nebula made of a few dozen great soft clouds, each a
// camera-facing sheet of noise in teal, rose or gold. Glowing, so they
// add up where they crowd. Each thins away as you come close to it, so
// flying through, they part round you instead of becoming a wall.

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float intensity = 0.16;

varying vec4 custom;
varying float dist;

void vertex() {
	custom = INSTANCE_CUSTOM;
	mat4 bb = mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	float s = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * bb * mat4(vec4(s, 0, 0, 0), vec4(0, s, 0, 0), vec4(0, 0, s, 0), vec4(0, 0, 0, 1));
	dist = length((VIEW_MATRIX * MODEL_MATRIX[3]).xyz) / s;
}

void fragment() {
	vec2 uv = UV - 0.5;
	// Turned per cloud, so no two look alike.
	float a = custom.w * 6.283;
	uv = mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a))) * uv;
	float r = length(uv) * 2.0;
	float n1 = texture(noise_tex, uv * 0.9 + custom.xy * 7.0).r;
	float n2 = texture(noise_tex, uv * 2.3 - custom.yx * 5.0).r;
	float n3 = texture(noise_tex, uv * 5.1 + custom.xz * 3.0).r;
	// From far off, fine detail would only shimmer: soften it with distance.
	float far = smoothstep(2.5, 9.0, dist);
	float shape = smoothstep(1.0, 0.15, r + (n1 - 0.5) * 0.7);
	float fine = mix(n1 * 0.55 + n2 * 0.3 + n3 * 0.15, n1, far);
	float dens = shape * smoothstep(0.3, 0.85, fine);
	// Filaments: bright where the noise is ridged (close by).
	float ridge = 1.0 - abs(n2 * 2.0 - 1.0);
	dens += shape * pow(ridge, 6.0) * 0.6 * (1.0 - far);
	dens *= 1.0 + far * 0.8;
	vec3 teal = vec3(0.25, 0.75, 0.85);
	vec3 rose = vec3(0.85, 0.35, 0.6);
	vec3 gold = vec3(1.0, 0.75, 0.4);
	vec3 col = mix(mix(teal, rose, custom.x), gold, smoothstep(0.55, 0.9, n3) * custom.z);
	// Near the eye a cloud thins away (dist is in cloud radii).
	float near = smoothstep(0.25, 0.9, dist);
	ALBEDO = col * dens * intensity * near;
}
