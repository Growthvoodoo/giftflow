/**
 * JSON responses.
 *
 * Deliberately not `Response.json()`: `remix-serve` installs Remix's fetch
 * globals in production, and that Response has no static `json` method — the
 * call works under `vite dev` and throws once deployed.
 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}
