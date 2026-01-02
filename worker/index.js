export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- CORS ----
    const allowedOrigins = new Set([
      "https://dawgshaus.com",
      "https://www.dawgshaus.com",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ]);

    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://dawgshaus.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Agent-Token, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ---- Simple shared-token auth ----
    // Require X-Agent-Token header to match AGENT_SHARED_TOKEN secret.
    const providedToken = request.headers.get("X-Agent-Token") || "";
    const expectedToken = env.AGENT_SHARED_TOKEN || "";

    if (!expectedToken) {
      return new Response("Server misconfigured: missing AGENT_SHARED_TOKEN", {
      status: 500,
      headers: corsHeaders
    });
    }

    if (providedToken !== expectedToken) {
      return new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders
    });
    }

    // ---- Durable Object rate limiting (per IP + per token) ----
    // Only enforce on the API route; we’ll still check method/path below,
    // but we can gate early to protect OpenAI costs.
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      "unknown";

    try {
      // One global DO instance that holds counters for many keys
      const id = env.RATE_LIMITER.idFromName("global");
      const stub = env.RATE_LIMITER.get(id);

      const rlRes = await stub.fetch("https://rate-limiter/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          token: providedToken,
          limits: {
            ip: { max: 30, windowSec: 60 },     // 30 req/min per IP
            token: { max: 60, windowSec: 60 }   // 60 req/min per token
          }
        })
      });

      if (rlRes.ok) {
        const rl = await rlRes.json();
        if (!rl.allowed) {
          const retryAfter = String(rl.retryAfterSec ?? 10);
          return new Response(
            JSON.stringify({
              error: "rate_limited",
              message: "Too many requests. Please wait and try again.",
              retryAfterSec: Number(retryAfter)
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": retryAfter
              }
            }
          );
        }
      }
      // If DO errors or returns non-OK, fail-open to avoid accidental outages.
    } catch {
      // fail-open
    }


    if (url.pathname !== "/api/agent") {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response("Server misconfigured: missing OPENAI_API_KEY", {
        status: 500,
        headers: corsHeaders
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400, headers: corsHeaders });
    }

    const system = typeof body.system === "string" ? body.system : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const user = typeof body.user === "string" ? body.user : "";

    if (!user.trim()) {
      return new Response(JSON.stringify({ reply: "No input received." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const convo = [];
    if (system) convo.push({ role: "system", content: system });

    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (typeof m.content !== "string") continue;
      convo.push({ role: m.role, content: m.content });
    }

    convo.push({ role: "user", content: user });

    const MAX_TURNS = 24;
    const trimmed = trimConversation(convo, MAX_TURNS);

    const model = "gpt-4.1-mini";

    let replyText = "";
    try {
      const openaiRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: trimmed
        })
      });

      if (!openaiRes.ok) {
        const errTxt = await openaiRes.text().catch(() => "");
        return new Response(`OpenAI error (${openaiRes.status}): ${errTxt || openaiRes.statusText}`, {
          status: 502,
          headers: corsHeaders
        });
      }

      const data = await openaiRes.json();
      replyText = extractResponseText(data) || "(No text output)";
    } catch (e) {
      return new Response(`Worker exception: ${e?.message || String(e)}`, {
        status: 500,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ reply: replyText }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};

function trimConversation(convo, maxTurns) {
  if (convo.length <= 1) return convo;
  const system = convo[0]?.role === "system" ? [convo[0]] : [];
  const rest = system.length ? convo.slice(1) : convo.slice(0);
  const trimmed = rest.slice(Math.max(0, rest.length - maxTurns));
  return system.concat(trimmed);
}

function extractResponseText(data) {
  const out = data?.output;
  if (!Array.isArray(out)) return "";

  let text = "";
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") {
        text += c.text;
      }
    }
  }
  return text.trim();
}

// ---------- Durable Object: RateLimiter ----------
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/check" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { ip, token, limits } = await request.json();

    const now = Date.now();
    const ipKey = `ip:${ip || "unknown"}`;
    const tokenKey = `tok:${token || "none"}`;

    const ipResult = await this._checkWindow(
      ipKey,
      limits?.ip?.max ?? 30,
      (limits?.ip?.windowSec ?? 60) * 1000,
      now
    );

    const tokResult = await this._checkWindow(
      tokenKey,
      limits?.token?.max ?? 60,
      (limits?.token?.windowSec ?? 60) * 1000,
      now
    );

    const allowed = ipResult.allowed && tokResult.allowed;
    const retryAfterSec = Math.max(ipResult.retryAfterSec, tokResult.retryAfterSec);

    return new Response(JSON.stringify({ allowed, retryAfterSec }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  async _checkWindow(key, max, windowMs, now) {
    const stored = (await this.state.storage.get(key)) || [];
    const cutoff = now - windowMs;

    const recent = stored.filter((t) => t > cutoff);

    if (recent.length >= max) {
      // Oldest timestamp dictates when the window frees up
      const oldest = recent[0];
      const retryAfterMs = Math.max(0, oldest + windowMs - now);
      return {
        allowed: false,
        retryAfterSec: Math.ceil(retryAfterMs / 1000) || 1
      };
    }

    recent.push(now);
    await this.state.storage.put(key, recent);

    return { allowed: true, retryAfterSec: 0 };
  }
}
