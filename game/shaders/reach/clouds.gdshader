shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded;
// A world's cloud deck (WorldLook): a shell of noise drawn from three sides
// in the world's own space, turning slowly, lit from the Lantern (white on
// the day side, gone to grey and then nearly nothing on the night side),
// the undersides darker when seen from beneath.

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float coverage = 0.48;
uniform float scale = 1.6;
uniform float speed = 0.004;
uniform float bands = 0.0;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform vec4 color : source_color = vec4(1.0, 1.0, 1.0, 0.9);

uniform float radius = 400.0;

varying vec3 opos;
varying vec3 wn;
varying float outside;

void vertex() {
	opos = normalize(VERTEX);
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	outside = step(radius, length(CAMERA_POSITION_WORLD - MODEL_MATRIX[3].xyz));
}

float tri(vec3 p, vec3 w) {
	return texture(noise_tex, p.zy).r * w.x + texture(noise_tex, p.xz).r * w.y + texture(noise_tex, p.xy).r * w.z;
}

void fragment() {
	// From outside, only the near half: the far side would show through.
	if (outside > 0.5 && !FRONT_FACING) {
		discard;
	}
	float a = TIME * speed;
	vec3 p = opos;
	p.xz = mat2(vec2(cos(a), -sin(a)), vec2(sin(a), cos(a))) * p.xz;
	vec3 w = pow(abs(p), vec3(3.0));
	w /= (w.x + w.y + w.z);
	float n = tri(p * scale, w) * 0.7 + tri(p * scale * 3.1 + vec3(0.31), w) * 0.3;
	n += bands * sin(p.y * 13.0 + n * 5.0) * 0.14;
	float d = smoothstep(coverage, coverage + 0.24, n);
	float lit = dot(normalize(wn), normalize(sun_dir));
	float day = smoothstep(-0.25, 0.35, lit);
	vec3 col = color.rgb * mix(0.06, 1.0, day) * (0.75 + 0.25 * smoothstep(coverage + 0.1, coverage + 0.4, n));
	if (!FRONT_FACING) {
		col *= 0.7;
	}
	ALBEDO = col;
	ALPHA = d * color.a * mix(0.35, 1.0, day);
}
