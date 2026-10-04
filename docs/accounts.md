# Accounts: sign in to keep progress

Signing in is optional. Without it, progress stays in the browser exactly as
before. With it, surveys, the story, the logbook and the pilot name follow a
player to any device, merged so that nothing either device had is lost
(`mergeProgress` in `src/sim/account.js`).

The site is static, so accounts live in a [Supabase](https://supabase.com)
project (free tier is enough). The client talks to Supabase's HTTP API
directly; there is no client library.

## One-time setup (about ten minutes, done by the project owner)

1. **Create the project.** Sign in at supabase.com, create a project (any
   name and region), and wait for it to start.

2. **Create the table.** In the project, open *SQL Editor*, paste this and run it:

   ```sql
   create table public.progress (
     user_id uuid primary key references auth.users (id) on delete cascade,
     data jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );

   alter table public.progress enable row level security;

   create policy "read own progress" on public.progress
     for select using (auth.uid() = user_id);
   create policy "add own progress" on public.progress
     for insert with check (auth.uid() = user_id);
   create policy "update own progress" on public.progress
     for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

   Row-level security is what makes the public key safe: a player can read
   and write their own row and nothing else.

3. **Tell Auth where the site is.** *Authentication → URL Configuration*:
   - Site URL: `https://periapsiszero.dev`
   - Redirect URLs: add `https://periapsiszero.dev/` and, for local testing,
     `http://localhost:5173/` and `http://localhost:4173/`.

4. **Email sign-in** works out of the box. Supabase's built-in mailer is
   limited to a few emails an hour, which is fine to start; for a public
   launch, add your own SMTP under *Authentication → Emails → SMTP Settings*.

5. **Google or GitHub (optional).** *Authentication → Sign In / Providers*,
   enable the provider and paste the client ID and secret from Google Cloud or
   a GitHub OAuth app (both docs pages link to step-by-step guides). The site
   reads which providers are on and shows a "Continue with …" button for each;
   nothing in the code changes.

6. **Give the site the project's address and publishable key.** *Project
   Settings → API Keys*: the Project URL and the **publishable** key (starts
   `sb_publishable_`, or the legacy `anon` key). Never the secret or
   service-role key. Then either:
   - in GitHub, *Settings → Secrets and variables → Actions → Variables*, add
     `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, or
   - from a terminal:
     ```bash
     gh variable set SUPABASE_URL --body "https://YOUR-PROJECT.supabase.co"
     gh variable set SUPABASE_PUBLISHABLE_KEY --body "sb_publishable_..."
     ```

   The next deploy builds sign-in in. For local development, put the same two
   values in `.env.local` as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (that file is ignored by Git).

## What is synced

`pz-expeditions-v1` (surveys and the campaign), `pz-story` (the simulator's
story), `periapsis.logbook.v1` (the flight log) and `pz-pilot-v1` (the pilot's
name). Graphics settings and device choices stay per device.

## How it was tested

Against a local stand-in for the five endpoints the client calls (email link
request, provider list, logout, progress read and upsert): the sign-in
control appears only when configured, providers are listed from the
project's settings, a returning link is taken out of the address, two
devices' surveys merge with the better landing kept, the merged record unlocks
the right story chapter, and signing out keeps progress in the browser. A
real project has not been connected yet; the first sign-in on the live site
is the last check.
