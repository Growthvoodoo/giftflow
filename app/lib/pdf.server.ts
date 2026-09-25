import { PDFDocument } from "pdf-lib";
import prisma from "../db.server";
import { get, keyForPdf, put } from "./storage.server";

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

export interface CardSpec {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  cropMarks: boolean;
}

interface CardContent {
  imageUrl: string | null;
  messageHtml: string;
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

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${w}mm; height: ${h}mm;
    font-family: "Inter", "Noto Color Emoji", system-ui, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .bleed { position: absolute; inset: 0; }
  .bleed img { width: 100%; height: 100%; object-fit: cover; }
  .trim {
    position: absolute;
    top: ${spec.bleedMm}mm; left: ${spec.bleedMm}mm;
    width: ${spec.widthMm}mm; height: ${spec.heightMm}mm;
    box-sizing: border-box; padding: 10mm;
    display: flex; flex-direction: column; gap: 4mm;
  }
  .to, .from { font-size: 10pt; opacity: .75; }
  .msg { flex: 1; font-size: 12pt; line-height: 1.5; overflow: hidden; }
  .msg p { margin: 0 0 3mm; }
  .msg ul, .msg ol { margin: 0 0 3mm 5mm; padding: 0; }
</style></head>
<body>
  ${content.imageUrl ? `<div class="bleed"><img src="${content.imageUrl}" alt=""></div>` : ""}
  <div class="trim">
    ${content.recipient ? `<div class="to">${escapeText(content.recipient)}</div>` : ""}
    <div class="msg">${content.messageHtml}</div>
    ${content.sender ? `<div class="from">${escapeText(content.sender)}</div>` : ""}
  </div>
</body></html>`;
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Renders one card to PDF.
 *
 * Chromium is loaded lazily: it is a large dependency, only the print path
 * needs it, and every other route should start without paying for it.
 */
export async function renderCard(
  html: string,
  spec: CardSpec,
  baseUrl: string,
): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      width: `${spec.widthMm + spec.bleedMm * 2}mm`,
      height: `${spec.heightMm + spec.bleedMm * 2}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return spec.cropMarks ? addCropMarks(pdf, spec) : Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** Crop marks, drawn outside the trim box so a guillotine has something to follow. */
async function addCropMarks(pdfBytes: Uint8Array, spec: CardSpec): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes);
  const bleed = mmToPt(spec.bleedMm);
  const len = Math.min(bleed, mmToPt(3));

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
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
  return Buffer.from(await doc.save());
}

/** Renders a gift order, caching against the row so a re-print is free and identical. */
export async function pdfForOrder(orderId: string, baseUrl: string): Promise<string> {
  const order = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { shop: { include: { settings: true } } },
  });
  if (order.pdfKey) return order.pdfKey;

  const s = order.shop.settings!;
  const spec: CardSpec = {
    widthMm: s.pdfWidthMm, heightMm: s.pdfHeightMm,
    bleedMm: s.pdfBleedMm, cropMarks: s.pdfCropMarks,
  };

  const html = cardHtml(spec, {
    imageUrl: order.cardImageKey ? `${baseUrl}/media/${order.cardImageKey}` : null,
    messageHtml: order.messageHtml,
    recipient: order.recipient,
    sender: order.sender,
  });

  const key = keyForPdf(order.shop.domain, order.id);
  await put(key, await renderCard(html, spec, baseUrl));
  await prisma.giftOrder.update({ where: { id: order.id }, data: { pdfKey: key } });
  return key;
}

/**
 * Merges many cards into one document, one page each.
 *
 * One click per order is fine for a demo and painful at fifty orders a day.
 * Each card is rendered through pdfForOrder, so anything already printed is
 * reused rather than re-rendered.
 */
export async function batchPdf(orderIds: string[], baseUrl: string): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const id of orderIds) {
    const key = await pdfForOrder(id, baseUrl);
    const one = await PDFDocument.load(await get(key));
    const pages = await merged.copyPages(one, one.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}
