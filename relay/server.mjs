/**
 * Array egress relay.
 *
 * Array allowlists source IPs on its API. Vercel serverless has no static
 * outbound address, so the one server-to-Array call this app makes — token
 * regeneration — is refused with 403 {"message":"Forbidden"} when it comes
 * from Vercel, and succeeds from the office.
 *
 * This runs at the allowlisted location and forwards that single request, so
 * Array sees the office IP. Nothing else changes.
 *
 * Deliberately NOT a general forward proxy. It accepts one method, on one
 * path, and forwards to exactly one upstream URL. An open proxy on an office
 * network is an abuse magnet, and this is the smallest thing that does the job.
 *
 * It also does not hold the Array server token. Vercel sends that header and
 * this passes it through, so a machine sitting in an office does not become a
 * place where the credential lives at rest.
 *
 *   RELAY_SECRET    shared with Vercel; requests without it are refused
 *   ARRAY_API_BASE  https://sandbox.array.io
 *   PORT            defaults to 8787
 *
 * Run:   RELAY_SECRET=... ARRAY_API_BASE=https://sandbox.array.io node relay/server.mjs
 * Expose: cloudflared tunnel --url http://localhost:8787
 */

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.RELAY_SECRET ?? "";
const ARRAY_API_BASE = process.env.ARRAY_API_BASE ?? "https://sandbox.array.io";

if (!SECRET || SECRET.length < 32) {
  console.error("RELAY_SECRET must be set and at least 32 characters.");
  process.exit(1);
}

const UPSTREAM = `${ARRAY_API_BASE}/api/authenticate/v2/usertoken`;
const MAX_BODY_BYTES = 4096;

/** Constant-time compare, so the secret can't be probed byte by byte. */
function secretMatches(given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST" || req.url !== "/array/usertoken") {
    return send(res, 404, { error: "Not found." });
  }

  if (!secretMatches(req.headers["x-relay-secret"])) {
    console.warn("Rejected relay request with a bad or missing secret", {
      from: req.socket.remoteAddress,
    });
    return send(res, 401, { error: "Unauthorized." });
  }

  const serverToken = req.headers["x-array-server-token"];
  if (typeof serverToken !== "string" || !serverToken) {
    return send(res, 400, { error: "Missing x-array-server-token." });
  }

  let body = "";
  let tooLarge = false;
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
  }
  if (tooLarge) return send(res, 413, { error: "Body too large." });

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-array-server-token": serverToken,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("Upstream call to Array failed", { message: String(err) });
    return send(res, 502, { error: "Could not reach Array." });
  }

  const text = await upstream.text();

  // Status and body passed through unchanged, so the caller sees exactly what
  // Array said rather than something this relay invented.
  console.log("Relayed token request", { status: upstream.status });
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
  });
  res.end(text);
});

server.listen(PORT, () => {
  console.log(`Array relay listening on http://localhost:${PORT}`);
  console.log(`Forwarding POST /array/usertoken -> ${UPSTREAM}`);
});
