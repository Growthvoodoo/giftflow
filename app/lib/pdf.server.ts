import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import prisma from "../db.server";
import { dataUriFor, get, keyForPdf, put } from "./storage.server";

/**
 * Print-ready gift cards.
 *
 * Rendered on the server, not in the browser: window.print() gives no control
 * over trim, bleed or embedded fonts, and the output differs per machine.
 * HTML -> headless Chromium -> PDF handles the Quill markup the message editor
 * produces. Satori is faster but renders that markup badly.
 *
 * Print-ready means: exact trim size, bleed on all four sides, crop marks,
 * embedded fonts, no transparency. Trim and bleed are merchant settings —
 * a public app cannot assume one card stock.
 */

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;

export type CardLayout = "overlay" | "two-sided" | "message-only";
export const CARD_LAYOUTS: CardLayout[] = ["overlay", "two-sided", "message-only"];

export interface CardSpec {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  cropMarks: boolean;
  layout?: CardLayout;
}

interface CardContent {
  imageUrl: string | null;
  messageHtml: string;
  messageText?: string;
  recipient: string | null;
  sender: string | null;
}

/**
 * The card as HTML, at physical size.
 *
 * The emoji font matters: the message editor has an emoji picker, and without a
 * colour emoji face every emoji prints as an empty box. Bundle one in
 * `public/fonts` and name it here — the fallback stack is not enough.
 */
export function cardHtml(spec: CardSpec, content: CardContent): string {
  const w = spec.widthMm + spec.bleedMm * 2;
  const h = spec.heightMm + spec.bleedMm * 2;
  const layout = spec.layout ?? "overlay";

  const image = content.imageUrl
    ? `<div class="bleed"><img src="${content.imageUrl}" alt=""></div>`
    : "";
  const message = `
  <div class="trim${layout === "overlay" && content.imageUrl ? " on-image" : ""}">
    ${content.recipient ? `<div class="to">${escapeText(content.recipient)}</div>` : ""}
    <div class="msg">${content.messageHtml || textToHtml(content.messageText ?? "")}</div>
    ${content.sender ? `<div class="from">${escapeText(content.sender)}</div>` : ""}
  </div>`;

  // overlay:      one page, the message printed over the card artwork
  // two-sided:    page 1 the artwork, page 2 the message (duplex / folded card)
  // message-only: one page, the message alone, for pre-printed card stock
  const sheets =
    layout === "two-sided"
      ? [image, message]
      : layout === "message-only"
        ? [message]
        : [image + message];

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", "Noto Color Emoji", system-ui, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Exactly one page per sheet: absolutely positioned content inside a box a
     hair under the page size, so rounding never spills onto an extra page. */
  .sheet {
    position: relative; overflow: hidden;
    width: ${w}mm; height: calc(${h}mm - 0.5px);
    break-after: page;
  }
  .sheet:last-child { break-after: auto; }
  .bleed { position: absolute; inset: 0; overflow: hidden; }
  .bleed img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .trim {
    position: absolute;
    top: ${spec.bleedMm}mm; left: ${spec.bleedMm}mm;
    width: ${spec.widthMm}mm; height: ${spec.heightMm}mm;
    box-sizing: border-box; padding: 10mm;
    display: flex; flex-direction: column; gap: 4mm;
    color: #1a1a1a;
  }
  .trim.on-image { text-shadow: 0 0 2px rgba(255,255,255,.85); }
  .to, .from { font-size: 10pt; opacity: .75; }
  .msg { flex: 1; font-size: 12pt; line-height: 1.5; overflow: hidden; overflow-wrap: anywhere; }
  .msg p { margin: 0 0 3mm; }
  .msg ul, .msg ol { margin: 0 0 3mm 5mm; padding: 0; }
</style></head>
<body>
${sheets.map((inner) => `<div class="sheet">${inner}</div>`).join("\n")}
</body></html>`;
}

function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeText(line) || "&nbsp;"}</p>`)
    .join("");
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

type Browser = Awaited<ReturnType<typeof import("playwright-core")["chromium"]["launch"]>>;

/**
 * Chromium is loaded lazily: it is a large dependency, only the print path
 * needs it, and every other route should start without paying for it.
 * CHROMIUM_PATH points at a system Chromium when Playwright's own is not
 * installed (common on servers and in Docker).
 */
async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");

  // Vercel (and other serverless hosts) ship no browser. @sparticuz/chromium-min
  // downloads a Lambda-ready Chromium into /tmp on the first print of a cold
  // start and reuses it afterwards.
  if (process.env.VERCEL || process.env.CHROMIUM_PACK_URL) {
    const sparticuz = (await import("@sparticuz/chromium-min")).default;
    const packUrl =
      process.env.CHROMIUM_PACK_URL ||
      "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

    // @vercel/remix replaces global fetch with Remix's polyfill, whose response
    // bodies are not Node's own ReadableStream — and @sparticuz downloads the
    // pack with global fetch + Readable.fromWeb(), which then throws
    // "must be an instance of ReadableStream". Lend it Node's real fetch
    // (undici) for the download only.
    const { fetch: nodeFetch } = await import("undici");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = nodeFetch as unknown as typeof fetch;
    let executablePath: string;
    try {
      executablePath = await sparticuz.executablePath(packUrl);
    } finally {
      globalThis.fetch = previousFetch;
    }
    return chromium.launch({ executablePath, args: sparticuz.args, headless: true });
  }

  return chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
}

/** Renders one card to PDF, reusing a browser when one is passed in. */
export async function renderCard(
  html: string,
  spec: CardSpec,
  label: string | null,
  browser?: Browser,
): Promise<Buffer> {
  const own = !browser;
  const b = browser ?? (await launch());
  try {
    const page = await b.newPage();
    try {
      // Everything is inlined (images as data: URIs), so nothing is fetched.
      await page.setContent(html, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        width: `${spec.widthMm + spec.bleedMm * 2}mm`,
        height: `${spec.heightMm + spec.bleedMm * 2}mm`,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      return finishPage(pdf, spec, label);
    } finally {
      await page.close();
    }
  } finally {
    if (own) await b.close();
  }
}

/**
 * Crop marks, drawn in the bleed so a guillotine has something to follow, and
 * the order number in the slug, so a stack of fifty printed cards can still be
 * matched to their orders. Both are cut away when the card is trimmed.
 */
async function finishPage(pdfBytes: Uint8Array, spec: CardSpec, label: string | null): Promise<Buffer> {
  if (!spec.cropMarks && !label) return Buffer.from(pdfBytes);
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bleed = mmToPt(spec.bleedMm);
  const len = Math.min(bleed, mmToPt(3));

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (spec.cropMarks && bleed > 0) {
      const line = (x1: number, y1: number, x2: number, y2: number) =>
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25 });
      for (const x of [bleed, width - bleed]) {
        line(x, 0, x, len);
        line(x, height - len, x, height);
      }
      for (const y of [bleed, height - bleed]) {
        line(0, y, len, y);
        line(width - len, y, width, y);
      }
    }
    if (label && bleed >= mmToPt(2)) {
      const size = Math.min(5, bleed * 0.6);
      page.drawText(label.replace(/[^\x20-\x7E]/g, "?"), {
        x: bleed + len + 2, y: (bleed - size) / 2 + 0.5, size, font, color: rgb(0.35, 0.35, 0.35),
      });
    }
  }
  return Buffer.from(await doc.save());
}

export async function specForShop(shopId: string): Promise<CardSpec> {
  const s = await prisma.settings.findUnique({ where: { shopId } });
  return {
    widthMm: s?.pdfWidthMm ?? 105,
    heightMm: s?.pdfHeightMm ?? 148,
    bleedMm: s?.pdfBleedMm ?? 3,
    cropMarks: s?.pdfCropMarks ?? true,
    layout: (CARD_LAYOUTS as string[]).includes(s?.pdfLayout ?? "")
      ? (s!.pdfLayout as CardLayout)
      : "overlay",
  };
}

/** Changes whenever a setting that affects the page changes. */
function specTag(spec: CardSpec): string {
  return createHash("sha1").update(JSON.stringify(spec)).digest("hex").slice(0, 8);
}

/**
 * Renders a gift order, caching against the row so a re-print is free and
 * byte-identical. The cache key includes the page spec: change the card size
 * and the next print re-renders at the new size.
 */
export async function pdfForOrder(
  orderId: string,
  spec: CardSpec,
  getBrowser?: () => Promise<Browser>,
): Promise<string> {
  const order = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { shop: { select: { domain: true } } },
  });

  // The cached file name starts with the order id and the page spec, then a
  // random part (so its URL cannot be guessed when storage is public).
  const prefix = `${order.shop.domain}/pdf/${order.id}-${specTag(spec)}-`;
  if (order.pdfKey?.startsWith(prefix)) {
    try {
      await get(order.pdfKey);
      return order.pdfKey;
    } catch {
      /* cache file missing — render again */
    }
  }
  const key = keyForPdf(order.shop.domain, `${order.id}-${specTag(spec)}`);

  const html = cardHtml(spec, {
    imageUrl: order.cardImageKey ? await dataUriFor(order.cardImageKey) : null,
    messageHtml: order.messageHtml,
    messageText: order.messageText,
    recipient: order.recipient,
    sender: order.sender,
  });

  const browser = getBrowser ? await getBrowser() : undefined;
  await put(key, await renderCard(html, spec, order.orderName ?? `#${order.orderId}`, browser));
  await prisma.giftOrder.update({ where: { id: order.id }, data: { pdfKey: key } });
  return key;
}

/**
 * Merges many cards into one document, one page each, in the order given.
 * One click per order is fine for a demo and painful at fifty orders a day.
 * One browser serves the whole batch, and anything already rendered at the
 * current size is reused rather than re-rendered.
 */
export async function batchPdf(orderIds: string[], spec: CardSpec): Promise<Buffer> {
  const merged = await PDFDocument.create();
  merged.setTitle(`GiftFlow — ${orderIds.length} card${orderIds.length === 1 ? "" : "s"}`);
  let browser: Browser | undefined;
  // Launched on the first card that actually needs rendering; a batch of
  // cached cards never starts Chromium at all.
  const getBrowser = async () => (browser ??= await launch());
  try {
    for (const id of orderIds) {
      const key = await pdfForOrder(id, spec, getBrowser);
      const one = await PDFDocument.load(await get(key));
      const pages = await merged.copyPages(one, one.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
  } finally {
    if (browser) await browser.close();
  }
  return Buffer.from(await merged.save());
}
