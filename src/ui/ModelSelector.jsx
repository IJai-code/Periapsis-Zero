import { getModel, getModelError, loadModel } from '../gfx/models.js'
import { MODEL_BY_ID, MODEL_CATALOG, MODEL_GROUPS } from '../gfx/modelsManifest.js'
import { CRAFT } from '../sim/constants.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * Per-craft mesh selector, generated entirely from the scanned manifest.
 *
 * Nothing here names a vehicle: add a file to public/models/, re-run
 * `npm run models:scan`, and it appears. Selecting an entry fetches just that
 * model — the catalogue is far too large to pull in one go.
 */
const TARGETS = ['ship', 'iss', 'hubble']

const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`

/** Anything past this is worth warning about before the user commits to it. */
const HEAVY_BYTES = 10 * 1048576

async function assign(craftId, modelId) {
  setUi((s) => ({ modelFor: { ...s.modelFor, [craftId]: modelId || null } }))
  if (!modelId || getModel(modelId)) return

  setUi((s) => ({ modelBusy: { ...s.modelBusy, [craftId]: true } }))
  try {
    await loadModel(modelId)
  } finally {
    setUi((s) => ({ modelBusy: { ...s.modelBusy, [craftId]: false } }))
  }
}

function Row({ craftId }) {
  const selected = useUi((s) => s.modelFor[craftId]) ?? ''
  const busy = useUi((s) => Boolean(s.modelBusy[craftId]))
  const entry = selected ? MODEL_BY_ID[selected] : null
  const error = selected ? getModelError(selected) : null

  const note = busy
    ? `fetching ${entry ? mb(entry.bytes) : ''}…`
    : error
      ? error
      : entry
        ? `${mb(entry.bytes)} · glTF`
        : 'procedural placeholder'

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-white/70">{CRAFT[craftId].name}</span>
        <span
          className={`truncate text-[9px] ${error ? 'text-amber-300/70' : busy ? 'text-hud' : 'text-white/25'}`}
        >
          {note}
        </span>
      </div>

      <select
        value={selected}
        disabled={busy}
        onChange={(e) => assign(craftId, e.target.value)}
        className="w-full rounded-[2px] border border-white/10 bg-black/60 px-1.5 py-1 font-mono text-[10px] text-white/85 outline-none transition-colors hover:border-hud/40 focus:border-hud/60 disabled:cursor-progress disabled:opacity-50"
      >
        <option value="">— placeholder —</option>
        {MODEL_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {MODEL_CATALOG.filter((m) => m.group === group).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.bytes > HEAVY_BYTES ? `  (${mb(m.bytes)})` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

export function ModelSelector() {
  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span>Meshes</span>
        <span className="text-white/25">{MODEL_CATALOG.length}</span>
      </div>

      <div className="space-y-2.5">
        {TARGETS.map((id) => (
          <Row key={id} craftId={id} />
        ))}
      </div>

      <p className="mt-3 border-t border-white/10 pt-2.5 text-[9px] leading-relaxed text-white/25">
        Loads on selection. Models are auto-centred and scaled to the craft;
        source units and origin offsets do not matter.
      </p>
    </div>
  )
}
