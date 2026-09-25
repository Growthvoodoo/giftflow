import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { mintToken } from "../lib/token.server";
import { sanitizeMessage, toPlainText } from "../lib/sanitize.server";

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
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return Response.json({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);

  let body: {
    cardDesignId?: string;
    uploadKey?: string;
    messageHtml?: string;
    recipient?: string;
    sender?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }

  // A card is either one from the catalogue or a customer upload — never both,
  // and never neither.
  const hasCard = Boolean(body.cardDesignId);
  const hasUpload = Boolean(body.uploadKey);
  if (hasCard === hasUpload) {
    return Response.json(
      { error: "Choose a card, or upload one — not both." },
      { status: 400 },
    );
  }

  if (hasCard) {
    const card = await prisma.cardDesign.findFirst({
      where: { id: body.cardDesignId!, shopId: shop.id, active: true },
      select: { id: true },
    });
    if (!card) return Response.json({ error: "That card is no longer available." }, { status: 404 });
  }

  const messageHtml = sanitizeMessage(body.messageHtml ?? "");
  const messageText = toPlainText(messageHtml);
  if (messageText.length > settings.messageMaxChars) {
    return Response.json(
      {
        error: `Your message is ${messageText.length} characters. The limit is ${settings.messageMaxChars}.`,
        limit: settings.messageMaxChars,
      },
      { status: 422 },
    );
  }

  const token = mintToken(session.shop);
  await prisma.giftDraft.create({
    data: {
      shopId: shop.id,
      token,
      cardDesignId: body.cardDesignId ?? null,
      uploadKey: body.uploadKey ?? null,
      uploadStatus: hasUpload ? (settings.moderateUploads ? "pending" : "approved") : null,
      messageHtml,
      messageText,
      recipient: body.recipient?.slice(0, 120) || null,
      sender: body.sender?.slice(0, 120) || null,
      expiresAt: new Date(Date.now() + DRAFT_TTL_HOURS * 3600_000),
    },
  });

  // The two properties the theme adds to the cart line. Everything else stays
  // here, against the token.
  return Response.json({
    token,
    properties: {
      _gift_token: token,
      [settings.visiblePropertyName]: settings.visiblePropertyValue,
    },
    cardVariantId: settings.cardVariantId,
  });
};
