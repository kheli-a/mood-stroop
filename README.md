# Mood Stroop — web version

Single-page Stroop-emotion game. The page records 4-second mic clips in the
browser and sends them to a tiny Vercel Edge Function that holds your Hume
API key and proxies requests to Hume's Expression Measurement API.
Everyone you share the link with gets the full game — they don't need a
Hume account, and your key never leaves the server.

## Files

```
web/
  index.html          ← the game (mic capture + UI + color animation)
  api/analyze.js      ← Vercel Edge Function: POST /api/analyze proxy to Hume
  README.md           ← this file
```

Vercel auto-routes any `.js` file under `api/` to `/api/<filename>`, so
`api/analyze.js` is reachable at `/api/analyze` with no config file.

## Deploy on Vercel

You'll need a free Vercel account ([vercel.com](https://vercel.com)) and
your Hume API key.

### Option 1 — CLI (fastest)

```bash
npm install -g vercel
cd web
vercel             # follow the prompts to create + link the project
                   # accept defaults: "Other" framework, root directory ".",
                   # build command none, output directory none.
vercel env add HUME_API_KEY production
vercel env add HUME_API_KEY preview
vercel env add HUME_API_KEY development
vercel --prod      # deploy to production
```

The last command prints a `*.vercel.app` URL — that's your share link.

### Option 2 — GitHub-connected (easiest if you already use GitHub)

1. Push the `web/` folder to a GitHub repo. (If the `web/` folder is inside
   a larger repo, that's fine — you'll point Vercel at it in step 4.)
2. Sign in at [vercel.com/new](https://vercel.com/new) and **Import Project**
   from your GitHub repo.
3. Configure project:
   - **Framework Preset:** Other
   - **Root Directory:** `web` *(only needed if it's a subfolder)*
   - **Build Command:** *(leave blank)*
   - **Output Directory:** *(leave blank)*
4. Expand **Environment Variables** and add:
   - Name: `HUME_API_KEY`
   - Value: *your Hume key*
   - Apply to **Production**, **Preview**, and **Development**.
5. Click **Deploy**.
6. Open the assigned `*.vercel.app` URL on your phone or laptop and play.

Subsequent pushes to the main branch trigger automatic redeploys.

## How it works

1. Browser records 4 s of mic audio via `MediaRecorder` (webm/opus, ~50 KB).
2. The blob is POSTed to `/api/analyze` on the same origin (no CORS).
3. The Edge Function (`api/analyze.js`) attaches your `HUME_API_KEY`
   header, submits to Hume's batch endpoint, polls every 600 ms until the
   job completes (typically 1–3 s), fetches predictions, and returns a flat
   `{emotion: score}` object averaged across segments.
4. The browser blends the top 5 emotions into a target HSV color (the same
   anchor-vector blend the Python version uses), eases toward it at ~60 fps,
   and scores the round:
   `+1` if the top anchor matches the **target**, `−1` if it matches the
   sentence's **natural** emotion (the trap), `0` otherwise.
5. After 5 rounds the celebration screen cycles through all the hues.

## Limits to keep in mind

- **Vercel Hobby plan (free):**
  - Edge Function max duration: **25 s**. The polling loop tops out at 22 s
    to stay safely under this. Most Hume jobs finish in 1–3 s.
  - Request body limit: **4.5 MB**. A 4 s webm clip is ~30–60 KB.
  - Bandwidth: 100 GB/month included.
- **Hume API:** you pay per submitted clip. One game = 5 clips. Check Hume's
  per-request pricing in your account dashboard.

If usage spikes, add IP-based rate limiting in `api/analyze.js` before too
many friends discover it — Vercel exposes the client IP at
`request.headers.get("x-forwarded-for")`.

## Local development

```bash
npm install -g vercel
cd web
echo "HUME_API_KEY=your-hume-key" > .env.local   # NOT committed
vercel dev
```

`vercel dev` serves both the static page and the Edge Function at
`http://localhost:3000`. Mic permission still works on localhost in modern
browsers.

## Security notes

- `HUME_API_KEY` lives only in Vercel's encrypted env-var store; it never
  appears in the page source or in any response.
- The function is open (no auth). Anyone who finds the URL can spend your
  Hume credits. If you share publicly, add rate-limiting.
- Audio is sent to Hume per their privacy policy. Mention this in any UI
  copy you share.
