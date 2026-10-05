import { abandonJob } from '../core/game.js'
import { STATIONS } from '../core/world.js'
import { CHARACTERS, mission, storyNext, abandonStory } from '../core/story.js'
import { Hint } from './keys.jsx'
import { clock } from './Hud.jsx'

/** Tab: the story so far, your jobs, and what is waiting where. */
export function Log({ game: g, touch, onClose }) {
  const active = g.story.active ? mission(g.story.active) : null
  const next = storyNext(g)
  return <div className="gm-log" role="dialog" aria-label="Jobs and missions">
    <section>
      <header><h1>Missions and jobs</h1><button className="map-close" onClick={onClose}>Close{!touch && <kbd className="gk">Tab</kbd>}</button></header>
      <h3>Story</h3>
      {active ? <article className="st-card active"><div><span className="st-eyebrow">In progress</span><h2>{active.title}</h2><p><Hint text={g.objective?.text} touch={touch} /></p><button className="st-ghost" onClick={() => abandonStory(g)}>Abandon</button></div></article>
        : next.length ? next.map((m) => <p key={m.id} className="log-next"><strong>{m.title}</strong>: see {CHARACTERS[m.giver].name} at {STATIONS[m.at].name}.</p>)
          : <p className="st-empty">{g.story.done.includes('apoapsis') ? 'The story is complete.' : 'Nothing yet.'}</p>}
      <h3>Jobs ({g.jobs.length} of 3)</h3>
      {g.jobs.length === 0 && <p className="st-empty">No jobs. Dock anywhere and read the job board.</p>}
      {g.jobs.map((j) => <article key={j.id} className={`st-job mine ${j.legal ? '' : 'grey'}`}>
        <div><h2>{j.title}</h2><p>{j.brief}</p><small>Paid at {STATIONS[j.to].name} · ₡ {j.reward.toLocaleString()} · due {clock(j.deadline)}</small></div>
        <button className={g.track === j.id ? 'on' : ''} onClick={() => { g.track = j.id }}>{g.track === j.id ? 'Tracking' : 'Track'}</button>
        <button className="st-ghost" onClick={() => abandonJob(g, j.id)}>Drop</button>
      </article>)}
      <h3>Done</h3>
      <p className="st-empty">{g.story.done.map((id) => mission(id)?.title).join(' · ') || 'Nothing yet.'}</p>
    </section>
  </div>
}
