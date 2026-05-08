/**
 * KPEye AI Worker
 *
 * Endpoints:
 *   POST /                    — AI classify screenshot
 *   GET  /version             — worker version
 *   POST /evidence/upload     — upload file to R2 { key, data (base64), mime }
 *   GET  /evidence/list       — list all R2 objects
 *   GET  /evidence/download?key=... — download file from R2
 */

const WORKER_VERSION = "1.0.7";

interface Env {
  AI: Ai;
  KPI_BUCKET: R2Bucket;
}

interface RequestBody {
  image_base64: string;
  prompt: string;
  model?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── Version ─────────────────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/version") {
      return Response.json({ version: WORKER_VERSION }, { headers: corsHeaders });
    }

    // ── R2: Upload ───────────────────────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/evidence/upload") {
      try {
        const body: { key: string; data: string; mime: string } = await request.json();
        if (!body.key || !body.data) {
          return Response.json({ error: "Missing key or data" }, { status: 400, headers: corsHeaders });
        }
        const binary = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
        await env.KPI_BUCKET.put(body.key, binary, {
          httpMetadata: { contentType: body.mime || "application/octet-stream" },
        });
        return Response.json({ ok: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err?.message ?? "Upload failed" }, { status: 500, headers: corsHeaders });
      }
    }

    // ── R2: List ─────────────────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/evidence/list") {
      try {
        const listed = await env.KPI_BUCKET.list();
        const files = listed.objects.map(o => ({
          key: o.key,
          size: o.size,
          modified: o.uploaded.toISOString(),
        }));
        return Response.json({ files }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err?.message ?? "List failed" }, { status: 500, headers: corsHeaders });
      }
    }

    // ── R2: Download ─────────────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/evidence/download") {
      const key = url.searchParams.get("key");
      if (!key) {
        return Response.json({ error: "Missing key param" }, { status: 400, headers: corsHeaders });
      }
      try {
        const obj = await env.KPI_BUCKET.get(key);
        if (!obj) {
          return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        return new Response(obj.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
            "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
          },
        });
      } catch (err: any) {
        return Response.json({ error: err?.message ?? "Download failed" }, { status: 500, headers: corsHeaders });
      }
    }

    // ── AI classify (POST /) ─────────────────────────────────────────────────
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
    }

    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
    }

    const { image_base64, prompt } = body;
    if (!image_base64 || !prompt) {
      return Response.json({ error: "Missing image_base64 or prompt" }, { status: 400, headers: corsHeaders });
    }

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
        max_tokens: 2048,
      });

      const choice = result?.choices?.[0]?.message;
      let text: string = result?.response ?? choice?.content ?? choice?.reasoning ?? "";

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
