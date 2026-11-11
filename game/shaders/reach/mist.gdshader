// Low mist (Weather): soft sheets lying in the hollows round the camera,
// facing it, thinning where they meet the ground and as you walk into them.
// One draw for all of them.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

uniform vec3 tint : source_color = vec3(0.6, 0.65, 0.72);
uniform float amount = 0.0;

varying float fade;
varying float seed;

void vertex() {
	// Face the camera, keeping the puff's own up (the world's up there).
	vec3 centre = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 up_v = normalize((MODELVIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	vec3 side = normalize(cross(up_v, -centre));
	float w = length(MODEL_MATRIX[0].xyz);
	float h = length(MODEL_MATRIX[1].xyz);
	VERTEX = centre + side * VERTEX.x * w + up_v * (VERTEX.y + 0.5) * h;
	POSITION = PROJECTION_MATRIX * vec4(VERTEX, 1.0);
	float d = length(centre);
	fade = smoothstep(4.0, 16.0, d) * (1.0 - smoothstep(110.0, 150.0, d));
	seed = INSTANCE_CUSTOM.r;
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	// A low, wide bank: feathered at the sides and top, and faded at its
	// sunk foot so no line shows where the ground cuts it (the web renderer
	// cannot read the depth behind a transparent sheet).
	float k = (1.0 - smoothstep(0.1, 1.0, abs(p.x)));
	k *= pow(smoothstep(0.0, 0.8, UV.y), 1.6) * (1.0 - smoothstep(0.8, 1.0, UV.y));
	k *= 0.7 + 0.3 * sin(p.x * 3.0 + seed * 40.0) * sin(UV.y * 5.0 + seed * 17.0);
	ALBEDO = tint;
	ALPHA = clamp(k * fade * amount * 0.6, 0.0, 1.0);
}
