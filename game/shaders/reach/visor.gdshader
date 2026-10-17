shader_type canvas_item;
// The suit's helmet, seen from inside: the glass's edge darkening into the
// rim in a wide oval, a faint cool tint at the very edge, two soft curved
// reflections across the top, a few specks of dust. Very little, on
// purpose: you should feel the glass, not look at it.

uniform float strength : hint_range(0.0, 1.0) = 1.0;
uniform vec2 aspect = vec2(1.777, 1.0);

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	vec2 c = (uv - 0.5) * aspect;
	// The rim: an oval a little wider than the screen.
	float r = length(c / vec2(aspect.x * 0.62, 0.62));
	float rim = smoothstep(0.78, 1.08, r);
	vec3 col = mix(vec3(0.0), vec3(0.05, 0.07, 0.09), smoothstep(1.02, 0.9, r));
	float a = rim * 0.92;
	// Reflections: two thin arcs across the upper glass.
	float arc1 = exp(-pow((length(c - vec2(-0.25, 1.15)) - 1.02) / 0.012, 2.0)) * smoothstep(0.1, -0.4, c.x) * smoothstep(-0.2, 0.2, c.y);
	float arc2 = exp(-pow((length(c - vec2(0.55, 1.4)) - 1.22) / 0.02, 2.0)) * smoothstep(0.2, 0.9, c.x) * 0.5;
	col += vec3(0.75, 0.85, 1.0) * (arc1 * 0.09 + arc2 * 0.05);
	a = max(a, (arc1 * 0.09 + arc2 * 0.05));
	// Dust on the glass, catching light only near the edge.
	vec2 cell = floor(uv * vec2(160.0, 90.0));
	float speck = step(0.9985, hash(cell)) * smoothstep(0.5, 0.95, r);
	col += vec3(speck * 0.35);
	a = max(a, speck * 0.25);
	COLOR = vec4(col, a * strength);
}
