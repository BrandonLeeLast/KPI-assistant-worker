/**
 * KPI Assistant AI Worker
 *
 * Processes screenshots using Cloudflare Workers AI.
 * Model: @cf/google/gemma-4-26b-a4b-it (multimodal - vision + text)
 *
 * Request:  POST / { image_base64: string, prompt: string }
 * Response: { response: string }
 */

const WORKER_VERSION = "1.0.8";

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
      const dataUrl = `data:image/png;base64,${image_base64}`;

      const result = await (env.AI.run as any)("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ],
        max_tokens: 1024,
      });

      let text: string = result?.response ?? result?.choices?.[0]?.message?.content ?? "";

      if (!text || text.trim().length === 0) {
        text = "AI Error: The model returned an empty response.";
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
