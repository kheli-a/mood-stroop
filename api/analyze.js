// Vercel Edge Function: POST /api/analyze
//
// Accepts a single audio blob (webm/ogg/wav) in the request body, submits it
// to Hume's batch prosody endpoint using the HUME_API_KEY env var, polls
// until the job completes, fetches predictions, and returns a flat
// {name: score} average across all detected segments.
//
// Edge runtime is used (not Node) because:
//   - Hobby plan max duration is 25 s on edge (10 s on Node) — we need
//     room to poll Hume for 4–15 s while the job runs.
//   - Same Web standard Request/Response API as Cloudflare Workers, so the
//     code is portable.
//
// Deploy:
//   1. Put this file at web/api/analyze.js (it's already there).
//   2. On Vercel, set HUME_API_KEY in the project's Environment Variables
//      (apply to Production, Preview, and Development).
//   3. Deploy. Route /api/analyze is wired automatically.

export const config = { runtime: "edge" };

const HUME_BASE        = "https://api.hume.ai/v0/batch/jobs";
const POLL_INTERVAL_MS = 600;
const JOB_TIMEOUT_MS   = 22_000;   // stay under Vercel's 25 s edge limit
const HTTP_TIMEOUT_MS  = 12_000;

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors() });
  }
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    return json({ error: "HUME_API_KEY not configured" }, 500);
  }

  let audioBlob;
  try {
    audioBlob = await request.blob();
  } catch (e) {
    return json({ error: "Could not read audio body" }, 400);
  }
  if (!audioBlob || audioBlob.size === 0) {
    return json({ error: "Empty audio body" }, 400);
  }

  try {
    // 1. Submit job (multipart)
    const form = new FormData();
    form.append("json", JSON.stringify({ models: { prosody: {} } }));
    form.append("file", audioBlob, "clip.webm");

    const submitRes = await timedFetch(HUME_BASE, {
      method: "POST",
      headers: { "X-Hume-Api-Key": apiKey },
      body: form,
    });
    if (submitRes.status === 401) {
      return json({ error: "Hume API key rejected (401)" }, 502);
    }
    if (!submitRes.ok) {
      return json({ error: `Hume submit ${submitRes.status}` }, 502);
    }
    const { job_id } = await submitRes.json();
    if (!job_id) return json({ error: "Hume did not return a job_id" }, 502);

    // 2. Poll until COMPLETED
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const stateRes = await timedFetch(`${HUME_BASE}/${job_id}`, {
        headers: { "X-Hume-Api-Key": apiKey },
      });
      if (!stateRes.ok) {
        return json({ error: `Hume status ${stateRes.status}` }, 502);
      }
      const body = await stateRes.json();
      const status = body?.state?.status;
      if (status === "COMPLETED") break;
      if (status === "FAILED") {
        return json({ error: "Hume job FAILED", details: body }, 502);
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // 3. Fetch predictions
    const predRes = await timedFetch(`${HUME_BASE}/${job_id}/predictions`, {
      headers: { "X-Hume-Api-Key": apiKey },
    });
    if (!predRes.ok) {
      return json({ error: `Hume predictions ${predRes.status}` }, 502);
    }
    const predictions = await predRes.json();

    // 4. Average emotions across all segments
    return json({ emotions: aggregate(predictions) });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
}

// ----- helpers -----

function aggregate(data) {
  const totals = {};
  for (const outer of data ?? []) {
    for (const pred of outer?.results?.predictions ?? []) {
      const groups = pred?.models?.prosody?.grouped_predictions ?? [];
      for (const grp of groups) {
        for (const seg of grp?.predictions ?? []) {
          for (const e of seg?.emotions ?? []) {
            const arr = (totals[e.name] = totals[e.name] || []);
            arr.push(Number(e.score));
          }
        }
      }
    }
  }
  const avg = {};
  for (const [name, vals] of Object.entries(totals)) {
    if (vals.length) avg[name] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return avg;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function timedFetch(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
