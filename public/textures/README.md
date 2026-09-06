# Surface imagery

These ship with the repository and load automatically. There is no switch.

They are committed rather than fetched, which is unusual for 13 MB of binary
and worth the sentence: the two Moon maps arrive from NASA as TIFFs and are
converted by `sips`, which exists only on macOS. Fetching them is therefore not
reproducible off a Mac, and the failure is quiet — a skipped source leaves a
photographed Earth next to a procedural Moon. Committing the converted output
is what makes the imagery platform-independent.

Underneath them a complete procedural set is still generated at load, and the
two are layered rather than swapped, so replacing or deleting any file here is
safe: that slot falls back to its generated version. `npm run textures:fetch
--force` re-downloads everything from source.

| File                    | Replaces                    | Colour space |
| ----------------------- | --------------------------- | ------------ |
| `earth_day.jpg`         | Earth albedo                | sRGB         |
| `earth_normal.jpg`      | Earth terrain normals       | linear       |
| `earth_roughness.jpg`   | Earth roughness             | linear       |
| `earth_specular.jpg`    | *alternative* to the above  | linear       |
| `earth_night.jpg`       | City lights (emissive)      | sRGB         |
| `earth_clouds.png`      | Cloud sheet — **needs alpha** | sRGB       |
| `moon_color.jpg`        | Lunar albedo                | sRGB         |
| `moon_normal.jpg`       | Lunar normals               | linear       |
| `milkyway.jpg`          | Skybox                      | sRGB         |

**Partial sets are fine.** Only the files actually present are used; every other
slot keeps its generated version. `milkyway.jpg` is the one name in the table
that nothing ships — no public-domain equirectangular panorama had a stable
enough URL to hard-code — so the skybox is always the procedural one unless you
supply that file yourself.

## Notes

- 2:1 equirectangular, and the image's **top row must be the north pole** — the
  standard orientation for NASA's Blue Marble and CGI Moon Kit tiles.
- **Roughness vs specular.** three multiplies the material's roughness by the
  green channel, so oceans must be *dark*. Most published Earth maps are
  specular — bright where the surface is shiny — which is the exact inverse, and
  using one directly gives mirror-finish continents and matte water. Rather than
  making that your problem, a file named `earth_specular.jpg` is detected and
  inverted automatically on load. Name it `earth_roughness.jpg` only if it is
  already dark over water.
- The cloud map is the only one that must carry an alpha channel; coverage is
  read from alpha, not luminance. Hence PNG.
- Colour space is assigned by slot, not guessed from the file, so colour maps
  are decoded as sRGB and data maps are not — this is what keeps the planets
  from washing out.
- If you add files while `npm run dev` is already running and the toggle still
  reports "none found", restart the dev server so it picks up the new statics.
  For `npm run build`, the files must be present before you build.

NASA's Visible Earth (Blue Marble Next Generation, Black Marble) and the
Scientific Visualization Studio's CGI Moon Kit are all public domain.

The manifest lives in `src/gfx/hdTextures.js`.
