import type { GiftOrder, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { batchPdf, specForShop } from "./pdf.server";
import type { Plan } from "./plans";

/**
 * Gift orders — the one place that decides what a list shows, what may be
 * printed and how status changes. The embedded admin and the staff dashboard
 * API both go through here, so the two can never disagree.
 */

export const STATUSES = ["new", "printed", "packed"] as const;
export type Status = (typeof STATUSES)[number];

export const VIEWS = ["new", "review", "held", "printed", "packed", "all"] as const;
export type View = (typeof VIEWS)[number];

export function isView(v: string | null | undefined): v is View {
  return !!v && (VIEWS as readonly string[]).includes(v);
}

/** What each tab/filter means. "new" is only what can be printed right now. */
function whereFor(shopId: string, view: View, q?: string): Prisma.GiftOrderWhereInput {
  const base: Prisma.GiftOrderWhereInput = { shopId };
  const views: Record<View, Prisma.GiftOrderWhereInput> = {
    new: {
      status: "new",
      overLimit: false,
      OR: [{ uploadStatus: null }, { uploadStatus: "approved" }],
    },
    review: { uploadStatus: "pending" },
    held: { overLimit: true },
    printed: { status: "printed" },
    packed: { status: "packed" },
    all: {},
  };
  const and: Prisma.GiftOrderWhereInput[] = [views[view]];
  const term = q?.trim();
  if (term) {
    and.push({
      OR: [
        { orderName: { contains: term } },
        { orderId: { contains: term } },
        { customerName: { contains: term } },
        { recipient: { contains: term } },
        { sender: { contains: term } },
        { messageText: { contains: term } },
      ],
    });
  }
  return { ...base, AND: and };
}

export async function listOrders(
  shopId: string,
  opts: { view?: View; q?: string; take?: number; skip?: number } = {},
) {
  const where = whereFor(shopId, opts.view ?? "new", opts.q);
  const [rows, total] = await Promise.all([
    prisma.giftOrder.findMany({
      where,
      orderBy: { orderedAt: opts.view === "new" ? "asc" : "desc" },
      take: Math.min(Math.max(opts.take ?? 100, 1), 500),
      skip: Math.max(opts.skip ?? 0, 0),
    }),
    prisma.giftOrder.count({ where }),
  ]);
  return { rows, total };
}

export async function counts(shopId: string): Promise<Record<View, number>> {
  const entries = await Promise.all(
    VIEWS.map(async (v) => [v, await prisma.giftOrder.count({ where: whereFor(shopId, v) })] as const),
  );
  return Object.fromEntries(entries) as Record<View, number>;
}

/** Why an order cannot be printed, or null when it can. */
export function printBlocker(o: Pick<GiftOrder, "uploadStatus" | "overLimit">): string | null {
  if (o.overLimit) return "Over this month's plan limit";
  if (o.uploadStatus === "pending") return "Customer image waiting for approval";
  if (o.uploadStatus === "rejected") return "Customer image was rejected";
  return null;
}

export function serializeOrder(o: GiftOrder, imageUrl: (key: string | null) => string | null) {
  return {
    id: o.id,
    orderId: o.orderId,
    orderName: o.orderName ?? `#${o.orderId}`,
    orderedAt: o.orderedAt.toISOString(),
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    recipient: o.recipient,
    sender: o.sender,
    cardTitle: o.cardTitle,
    image: imageUrl(o.cardImageKey),
    isUpload: o.uploadStatus !== null,
    uploadStatus: o.uploadStatus,
    overLimit: o.overLimit,
    messageHtml: o.messageHtml,
    messageText: o.messageText,
    status: o.status,
    printedAt: o.printedAt?.toISOString() ?? null,
    printBlocker: printBlocker(o),
  };
}
export type SerializedOrder = ReturnType<typeof serializeOrder>;

/** Never act on another shop's rows, however the ids arrived. */
export async function ownIds(shopId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const mine = await prisma.giftOrder.findMany({
    where: { id: { in: ids.slice(0, 500) }, shopId },
    select: { id: true },
  });
  return mine.map((m) => m.id);
}

export async function setStatus(shopId: string, ids: string[], status: Status): Promise<number> {
  const safe = await ownIds(shopId, ids);
  if (!safe.length) return 0;
  const res = await prisma.giftOrder.updateMany({
    where: { id: { in: safe } },
    data: {
      status,
      // "new" again means it has to be printed again.
      printedAt: status === "new" ? null : new Date(),
    },
  });
  return res.count;
}

/** Approve or reject customer uploads. Only touches orders that have one. */
export async function moderate(
  shopId: string,
  ids: string[],
  decision: "approved" | "rejected",
): Promise<number> {
  const safe = await ownIds(shopId, ids);
  if (!safe.length) return 0;
  const res = await prisma.giftOrder.updateMany({
    where: { id: { in: safe }, uploadStatus: { not: null } },
    data: { uploadStatus: decision },
  });
  return res.count;
}

export class PrintError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Renders the given orders into one PDF, in order date order.
 * Refuses anything blocked, and refuses batch printing on a plan without it,
 * with a message a person can act on.
 */
export async function printOrders(
  shopId: string,
  ids: string[],
  plan: Plan,
  opts: { markPrinted?: boolean } = {},
): Promise<{ pdf: Buffer; count: number }> {
  const rows = await prisma.giftOrder.findMany({
    where: { id: { in: ids.slice(0, 500) }, shopId },
    orderBy: { orderedAt: "asc" },
  });
  if (!rows.length) throw new PrintError("Nothing to print.", 404);

  const blocked = rows.filter((r) => printBlocker(r));
  if (blocked.length) {
    const names = blocked.slice(0, 5).map((b) => b.orderName ?? `#${b.orderId}`).join(", ");
    throw new PrintError(
      `${blocked.length} of the selected cards can't be printed yet (${names}): ${printBlocker(blocked[0])}.`,
      409,
    );
  }
  if (rows.length > 1 && !plan.batchPrint) {
    throw new PrintError(
      `Batch printing is not included in the ${plan.label} plan. Print one card at a time, or upgrade.`,
      402,
    );
  }

  const pdf = await batchPdf(rows.map((r) => r.id), await specForShop(shopId));

  if (opts.markPrinted) {
    await prisma.giftOrder.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: "new" },
      data: { status: "printed", printedAt: new Date() },
    });
  }
  return { pdf, count: rows.length };
}
