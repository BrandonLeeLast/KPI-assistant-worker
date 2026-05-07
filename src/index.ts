/**
 * KPI Assistant AI Worker
 *
 * Processes screenshots using Cloudflare Workers AI.
 * Model: @cf/google/gemma-4-26b-a4b-it (multimodal - vision + text)
 *
 * Request:  POST / { image_base64: string, prompt: string }
 * Response: { response: string }
 */

const WORKER_VERSION = "1.0.4";

interface Env {
  AI: Ai;
}

interface RequestBody {
  image_base64: string;
  prompt: string;
  model?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    };

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Version endpoint ────────────────────────────────────────────────────
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/version") {
      return Response.json({ version: WORKER_VERSION }, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { image_base64, prompt } = body;
    if (!image_base64 || !prompt) {
      return Response.json({ error: "Missing image_base64 or prompt" }, { status: 400 });
    }

    // ── Call Gemma 4 vision model ───────────────────────────────────────────
    try {
      // DUAL-MODE VISION CALL: Some models are picky about content structure.
      // We'll try the most standard multimodal format first.
      const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { 
                type: "image", 
                image: image_base64 
              }
            ]
          }
        ],
        max_tokens: 1024,
      });

      // Extract text from response
      let text: string = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
      
      // FALLBACK: If the model returned an empty string, it might have missed the image.
      // Try the legacy top-level image format as a last resort.
      if (!text || text.trim().length === 0) {
        const fallbackResult = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [{ role: "user", content: prompt }],
          image: image_base64,
          max_tokens: 1024,
        });
        text = fallbackResult?.response ?? fallbackResult?.choices?.[0]?.message?.content ?? "";
      }

      if (!text || text.trim().length === 0) {
        text = "AI Error: The model processed the image but did not generate a summary. This can happen if the image is too complex or Cloudflare's vision service is under high load.";
      }

      return Response.json({ response: text }, { headers: corsHeaders });

    } catch (err: any) {
      return Response.json(
        { error: `AI error: ${err?.message ?? "unknown"}` },
        { status: 500, headers: corsHeaders }
      );
    }
  },
} satisfies ExportedHandler<Env>;
