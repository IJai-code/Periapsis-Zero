# HD texture overrides

Every map in the scene is synthesised procedurally at load, so the app is
self-contained and needs no network access. Real imagery is **opt-in**: drop
files here under the exact names below, then switch on **HD textures** in the
Render panel. Nothing is fetched until you click it, so the initial load is
never affected.

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

**Partial installs are fine.** Only the files actually present are used; every
other slot keeps its generated version. Supplying just `earth_day.jpg` works.

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
