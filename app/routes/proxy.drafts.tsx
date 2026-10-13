import { jsonResponse } from "../lib/http.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { mintToken } from "../lib/token.server";
import { sanitizeMessage, textToHtml, toPlainText } from "../lib/sanitize.server";
import { get, hash, isUploadKeyFor } from "../lib/storage.server";
import { storedPlan } from "../lib/billing.server";

/** Abandoned carts must not accumulate personal data indefinitely. */
const DRAFT_TTL_HOURS = 48;

/**
 * POST /apps/giftflow/drafts
 *
 * Takes the chosen card and the message, returns the token that goes into the
 * cart. This is where the message is validated and sanitized — doing it in the
 * browser would mean trusting whatever the cart was edited to contain.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return jsonResponse({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);

  let body: {
    cardDesignId?: string;
    uploadKey?: string;
    messageHtml?: string;
    message?: string;
    recipient?: string;
    sender?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Expected JSON" }, { status: 400 });
  }

  // A card is either one from the catalogue or a customer upload — never both,
  // and never neither.
  const hasCard = Boolean(body.cardDesignId);
  const hasUpload = Boolean(body.uploadKey);
  if (hasCard === hasUpload) {
    return jsonResponse(
      { error: "Choose a card, or upload one — not both." },
      { status: 400 },
    );
  }

  if (hasCard) {
    const card = await prisma.cardDesign.findFirst({
      where: { id: body.cardDesignId!, shopId: shop.id, active: true },
      select: { id: true },
    });
    if (!card) return jsonResponse({ error: "That card is no longer available." }, { status: 404 });
  }

  let uploadHash: string | null = null;
  if (hasUpload) {
    // The key must be one this app minted for this shop, and the file must
    // exist — otherwise a crafted request could point a card at any file.
    const plan = await storedPlan(shop.id);
    if (!plan.uploads || !settings.allowUploads) {
      return jsonResponse({ error: "Uploads are turned off for this store." }, { status: 403 });
    }
    if (!isUploadKeyFor(session.shop, body.uploadKey!)) {
      return jsonResponse({ error: "That upload is not valid." }, { status: 400 });
    }
    try {
      uploadHash = hash(await get(body.uploadKey!));
    } catch {
      return jsonResponse({ error: "That upload has expired. Please upload it again." }, { status: 410 });
    }
  }

  // The storefront sends plain text from a textarea (`message`); a richer
  // editor can send `messageHtml`. Either way, what is stored is sanitized.
  const messageHtml = sanitizeMessage(
    body.messageHtml ?? textToHtml(String(body.message ?? "")),
  );
  const messageText = toPlainText(messageHtml);
  if (messageText.length > settings.messageMaxChars) {
    return jsonResponse(
      {
        error: `Your message is ${messageText.length} characters. The limit is ${settings.messageMaxChars}.`,
        limit: settings.messageMaxChars,
      },
      { status: 422 },
    );
  }

  // Sweep this shop's abandoned drafts. Cheap, indexed, and it means expiry
  // needs no separate cron job.
  await prisma.giftDraft.deleteMany({
    where: { shopId: shop.id, expiresAt: { lt: new Date() } },
  });

  const token = mintToken(session.shop);
  await prisma.giftDraft.create({
    data: {
      shopId: shop.id,
      token,
      cardDesignId: body.cardDesignId ?? null,
      uploadKey: body.uploadKey ?? null,
      uploadStatus: hasUpload ? (settings.moderateUploads ? "pending" : "approved") : null,
      uploadHash,
      messageHtml,
      messageText,
      recipient: String(body.recipient ?? "").trim().slice(0, 120) || null,
      sender: String(body.sender ?? "").trim().slice(0, 120) || null,
      expiresAt: new Date(Date.now() + DRAFT_TTL_HOURS * 3600_000),
    },
  });

  // The two properties the theme adds to the cart line. Everything else stays
  // here, against the token.
  return jsonResponse({
    token,
    properties: {
      _gift_token: token,
      [settings.visiblePropertyName]: settings.visiblePropertyValue,
    },
    cardVariantId: settings.cardVariantId,
  });
};
