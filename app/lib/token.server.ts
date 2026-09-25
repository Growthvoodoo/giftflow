import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Gift tokens.
 *
 * The token is the only gift data that reaches the cart. Everything else — the
 * card, the message, the recipient — stays in the database against it. That
 * keeps the line item small, lets the message be validated server-side, makes
 * the data deletable on customers/redact, and stops a customer editing cart
 * properties to award themselves a free card.
 *
 * It carries a signature so a forged token is rejected before it costs a
 * database lookup, and so a token minted for one shop cannot be replayed
 * against another.
 */

const PREFIX = "gft_";

function secret(): string {
  const s = process.env.GIFT_TOKEN_SECRET;
  if (!s) {
    throw new Error(
      "GIFT_TOKEN_SECRET is not set. Generate one with: openssl rand -hex 32",
    );
  }
  return s;
}

function sign(shopDomain: string, body: string): string {
  return createHmac("sha256", secret())
    .update(`${shopDomain}:${body}`)
    .digest("base64url")
    .slice(0, 16);
}

export function mintToken(shopDomain: string): string {
  const body = randomBytes(18).toString("base64url");
  return `${PREFIX}${body}.${sign(shopDomain, body)}`;
}

/** Cheap rejection of anything not minted here, before touching the database. */
export function verifyToken(shopDomain: string, token: string): boolean {
  if (!token?.startsWith(PREFIX)) return false;
  const [body, mac] = token.slice(PREFIX.length).split(".");
  if (!body || !mac) return false;

  const expected = Buffer.from(sign(shopDomain, body));
  const given = Buffer.from(mac);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  return expected.length === given.length && timingSafeEqual(expected, given);
}
