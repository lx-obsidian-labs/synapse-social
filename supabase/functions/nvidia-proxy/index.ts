// Supabase Edge Function: nvidia-proxy
//
// Securely proxies chat-completion requests to NVIDIA NIM. The NVIDIA API key
// is stored as a Supabase secret (NVIDIA_API_KEY) and is NEVER shipped to the
// client, so the browser extension can be distributed publicly with no secrets.
//
// Deploy:
//   supabase functions deploy nvidia-proxy --no-verify-jwt
//   supabase secrets set NVIDIA_API_KEY=nvapi-...
//
// The extension POSTs the same body it would send to NVIDIA
// (model, messages, max_tokens, temperature, top_p, stream, ...). This function
// injects the Authorization header and streams the response straight back.

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("NVIDIA_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Proxy misconfigured: NVIDIA_API_KEY secret is not set" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  let body: string;
  try {
    body = JSON.stringify(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `Upstream fetch failed: ${msg}` }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Pass the upstream response (including SSE streams) straight through.
  const headers = new Headers(CORS_HEADERS);
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
});
