class_name Walkways
## Where people can walk: a navigation mesh baked when a set loads, from
## the set's own collision, so paths go round everything solid in it.

## `inside` limits the walkway to a box (a set's floor can run past its walls).
static func bake(parent: Node3D, source: Node3D, radius := 0.5, inside := AABB()) -> NavigationRegion3D:
	var nm := NavigationMesh.new()
	nm.cell_size = 0.25
	nm.cell_height = 0.25
	nm.agent_radius = radius
	nm.agent_height = 2.0
	nm.agent_max_climb = 0.25
	nm.agent_max_slope = 30.0
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	if inside.has_volume():
		nm.filter_baking_aabb = inside
	var src := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(nm, src, source)
	NavigationServer3D.bake_from_source_geometry_data(nm, src)
	var region := NavigationRegion3D.new()
	region.navigation_mesh = nm
	parent.add_child(region)
	return region
