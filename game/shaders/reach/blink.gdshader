shader_type canvas_item;
// The eyelids, drawn over the view: two soft lids closing from the top and
// the bottom of the frame, a faint warmth at the lid edge, and nothing at
// all when they are open. `lid` 0 is awake, 1 is shut.

uniform float lid : hint_range(0.0, 1.0) = 0.0;
uniform float softness : hint_range(0.005, 0.4) = 0.14;
uniform vec4 lid_color : source_color = vec4(0.02, 0.014, 0.012, 1.0);
uniform vec4 edge_color : source_color = vec4(0.42, 0.16, 0.06, 1.0);
uniform float edge_glow : hint_range(0.0, 1.0) = 0.35;

void fragment() {
	vec2 uv = UV;
	// The lids bow slightly at the corners, as real ones do when shut.
	float bow = 0.055 * pow(abs(uv.x - 0.5) * 2.0, 2.0);
	float opening = smoothstep(0.0, 0.02, lid);
	float top = mix(-softness, 0.5, lid) + bow * lid;
	float bottom = 1.0 - mix(-softness, 0.5, lid) - bow * lid;
	float a = smoothstep(top + softness, top - softness, uv.y);
	float b = smoothstep(bottom - softness, bottom + softness, uv.y);
	float cover = clamp(a + b, 0.0, 1.0) * opening;
	// A thin warm line where the lid meets the eye.
	float edge = 0.0;
	edge += exp(-pow((uv.y - top) / (softness * 0.5), 2.0));
	edge += exp(-pow((uv.y - bottom) / (softness * 0.5), 2.0));
	edge = clamp(edge, 0.0, 1.0) * edge_glow * opening * (1.0 - abs(lid - 0.5) * 2.0);
	vec3 col = mix(lid_color.rgb, edge_color.rgb, edge * 0.6);
	COLOR = vec4(col, clamp(cover + edge * 0.25, 0.0, 1.0));
}
