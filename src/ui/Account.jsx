import { useState, useSyncExternalStore } from 'react'
import { accountsEnabled, accountState, emailLink, providerSignIn, signOut, subscribeAccount, syncNow } from '../sim/account.js'

const NAMES = { google: 'Google', github: 'GitHub', apple: 'Apple', discord: 'Discord' }

/**
 * The front page's account control: "Sign in to save progress", or the
 * signed-in player with a sync and a sign-out. Renders nothing at all until
 * the build has a Supabase project (sim/account.js), so the site never offers
 * a sign-in that cannot work.
 */
export function AccountButton() {
  const account = useSyncExternalStore(subscribeAccount, accountState)
  const [open, setOpen] = useState(false)
  if (!accountsEnabled) return null
  const email = account.session?.user?.email
  return <>
    <button className="quiet-button" onClick={() => setOpen(true)}>{account.session ? `Signed in${email ? ` · ${email}` : ''}` : 'Sign in to save progress'}</button>
    {open && <AccountDialog account={account} onClose={() => setOpen(false)} />}
  </>
}

function AccountDialog({ account, onClose }) {
  const [email, setEmail] = useState('')
  const signedIn = Boolean(account.session)
  const send = () => { if (/\S+@\S+\.\S+/.test(email)) emailLink(email.trim()) }
  return <div className="pilot-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
    <section>
      <span className="eyebrow">Account</span>
      {signedIn ? <>
        <h2 id="account-title">Your progress is saved to your account.</h2>
        <p>Signed in as {account.session.user.email || 'you'}. Surveys, the story and your logbook follow you to any device you sign in on. Progress is merged, never overwritten.</p>
        {account.message && <p className="account-note">{account.message}</p>}
        <div className="modal-actions">
          <button className="action-button primary" onClick={async () => { if (await syncNow()) location.reload() }} disabled={account.status === 'syncing'}>{account.status === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
          <button className="action-button" onClick={() => { signOut(); onClose() }}>Sign out</button>
          <button className="action-button" onClick={onClose}>Close</button>
        </div>
      </> : <>
        <h2 id="account-title">Keep your progress on any device.</h2>
        <p>Optional. Without an account, progress stays saved in this browser as it always has.</p>
        {account.providers.length > 0 && <div className="account-providers">
          {account.providers.map((p) => <button key={p} className="action-button" onClick={() => providerSignIn(p)}>Continue with {NAMES[p] ?? p}</button>)}
        </div>}
        <label htmlFor="account-email">{account.providers.length ? 'Or get a sign-in link by email' : 'Get a sign-in link by email'}</label>
        <input id="account-email" type="email" autoComplete="email" value={email} autoFocus placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
        {account.message && <p className="account-note" role="status">{account.message}</p>}
        <div className="modal-actions">
          <button className="action-button primary" onClick={send} disabled={account.status === 'sending'}>{account.status === 'sending' ? 'Sending…' : 'Email me a link'}</button>
          <button className="action-button" onClick={onClose}>Not now</button>
        </div>
      </>}
    </section>
  </div>
}
