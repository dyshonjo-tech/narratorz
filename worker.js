/*
 * Narratorz — Google Text-to-Speech proxy (Cloudflare Worker)
 * --------------------------------------------------------------
 * WHY THIS EXISTS:
 *   GitHub Pages can only serve static files — it can't keep a secret
 *   API key safe. If your Google key sat in the browser code, anyone
 *   could copy it and run up your bill. This little server sits in the
 *   middle: the browser asks IT for audio, IT talks to Google using the
 *   secret key, and the key never leaves the server.
 *
 * WHAT IT DOES:
 *   - Accepts a POST from narratorz.com with { text, voice, languageCode, speakingRate }
 *   - Rejects requests from any other website (so nobody can borrow your key)
 *   - Caps how much text one request can send (anti-abuse)
 *   - Calls Google, returns the MP3 audio back to the browser
 *
 * SECRET:
 *   The Google key is NOT in this file. You'll paste it into Cloudflare's
 *   dashboard as an encrypted secret named GOOGLE_TTS_KEY (instructions below).
 */

// ---- CONFIG ----
const ALLOWED_ORIGINS = [
  "https://narratorz.com",
  "https://www.narratorz.com",
  "https://dyshonjo-tech.github.io", // your GitHub Pages URL, so it works there too
];
const MAX_CHARS_PER_REQUEST = 5000; // one "chunk" — the app already splits long text into chunks

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    // Preflight (browser asks "am I allowed?")
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Only allow POST from your own site
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: "Not allowed from this origin" }, 403, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad request" }, 400, origin);
    }

    const text = (body.text || "").toString();
    const voice = (body.voice || "en-US-Neural2-C").toString();
    const languageCode = (body.languageCode || "en-US").toString();
    const speakingRate = Math.min(2, Math.max(0.5, parseFloat(body.speakingRate) || 1));

    if (!text.trim()) {
      return json({ error: "No text provided" }, 400, origin);
    }
    if (text.length > MAX_CHARS_PER_REQUEST) {
      return json({ error: "Text too long for one request" }, 413, origin);
    }

    // Call Google Text-to-Speech
    const googleUrl =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + env.GOOGLE_TTS_KEY;

    const gReq = {
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate },
    };

    let gRes;
    try {
      gRes = await fetch(googleUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gReq),
      });
    } catch (e) {
      return json({ error: "Voice service unreachable" }, 502, origin);
    }

    if (!gRes.ok) {
      const detail = await gRes.text();
      return json({ error: "Voice service error", detail }, 502, origin);
    }

    const data = await gRes.json();
    // Google returns base64 MP3 in audioContent
    return new Response(JSON.stringify({ audioContent: data.audioContent }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
