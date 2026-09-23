/**
 * A uniform holding a number that the render loop rewrites every frame.
 *
 * three.js takes a uniform as any object with a `value`, and does not care
 * what built it — but what built it decides whether writing it allocates.
 * Every `{ value }` *literal* in the program shares one hidden class, and
 * three's own uniform library fills that class's `value` with vectors, colours
 * and textures, so V8 keeps the field as a tagged pointer: each fraction
 * written into it needs a new heap number. Measured with three loaded, 16.81
 * bytes a write — which made every per-frame uniform in the app an allocation
 * in a render loop that allocates nothing, and no gate saw it, because the
 * gates measure the functions that work out a value and not the line that
 * hands it to the GPU.
 *
 * An object built by this class has a hidden class of its own that only ever
 * holds numbers, so V8 keeps the field as an unboxed double and overwrites it
 * in place: 0.06 bytes a write. `verify-ground-view` holds both figures.
 *
 * Only for numbers. A single vector stored into one of these would generalise
 * the field for every instance, and they would all allocate again.
 */
class ScalarUniform {
  constructor(value) {
    this.value = value
  }
}

/** A numeric uniform that can be written every frame without allocating. */
export const scalarUniform = (value) => new ScalarUniform(value)
