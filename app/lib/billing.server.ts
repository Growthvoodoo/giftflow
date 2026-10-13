import prisma from "../db.server";
import { PAID_PLANS, PLANS, planByBillingName, planById, type Plan } from "./plans";

/**
 * Billing.
 *
 * The Billing API is the source of truth, but it can only be asked from an
 * authenticated admin request. Webhooks and the storefront proxy have no admin
 * session, so the answer is copied onto Shop.plan whenever the admin loads and
 * read from there everywhere else.
 *
 * GIFTFLOW_BILLING=off gives every shop the top plan. That is for a private,
 * single-store install; a public App Store listing must charge.
 */

export function billingEnabled(): boolean {
  return (process.env.GIFTFLOW_BILLING ?? "on").toLowerCase() !== "off";
}

/** Test charges everywhere except a production build. */
export function isTestCharge(): boolean {
  return process.env.NODE_ENV !== "production";
}

type BillingApi = {
  check: (opts: { plans?: string[]; isTest?: boolean }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: Array<{ id: string; name: string; status?: string }>;
  }>;
};

/** Asks Shopify which plan is active and stores it on the shop. */
export async function syncPlan(shopId: string, billing: BillingApi): Promise<Plan> {
  if (!billingEnabled()) {
    await prisma.shop.update({ where: { id: shopId }, data: { plan: PLANS.scale.id } });
    return PLANS.scale;
  }

  let plan: Plan = PLANS.free;
  try {
    const res = await billing.check({
      plans: PAID_PLANS.map((p) => p.billingName),
      isTest: isTestCharge(),
    });
    const active = res.appSubscriptions.find((s) => !s.status || s.status === "ACTIVE");
    if (res.hasActivePayment && active) plan = planByBillingName(active.name);
  } catch (e) {
    // A billing outage must not lock a merchant out of printing. Keep whatever
    // plan was last confirmed.
    console.error("[giftflow] billing check failed:", e);
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { plan: true } });
    return planById(shop?.plan);
  }

  await prisma.shop.update({ where: { id: shopId }, data: { plan: plan.id } });
  return plan;
}

/** The plan as last stored — for webhooks, the proxy and the staff API. */
export async function storedPlan(shopId: string): Promise<Plan> {
  if (!billingEnabled()) return PLANS.scale;
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { plan: true } });
  return planById(shop?.plan);
}

export function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Gift orders counted against this month's limit. */
export async function ordersThisMonth(shopId: string): Promise<number> {
  return prisma.giftOrder.count({
    where: { shopId, orderedAt: { gte: monthStart() } },
  });
}

export interface Usage {
  plan: Plan;
  used: number;
  limit: number | null;
  heldOverLimit: number;
}

export async function usage(shopId: string, plan?: Plan): Promise<Usage> {
  const p = plan ?? (await storedPlan(shopId));
  const [used, heldOverLimit] = await Promise.all([
    ordersThisMonth(shopId),
    prisma.giftOrder.count({ where: { shopId, overLimit: true } }),
  ]);
  return { plan: p, used, limit: p.monthlyOrders, heldOverLimit };
}

/**
 * After an upgrade, orders that were held for being over the old limit are
 * released, oldest first, up to what the new plan allows this month.
 */
export async function releaseHeldOrders(shopId: string, plan: Plan): Promise<number> {
  const held = await prisma.giftOrder.findMany({
    where: { shopId, overLimit: true },
    orderBy: { orderedAt: "asc" },
    select: { id: true },
  });
  if (!held.length) return 0;

  let room = held.length;
  if (plan.monthlyOrders !== null) {
    const counted = await prisma.giftOrder.count({
      where: { shopId, overLimit: false, orderedAt: { gte: monthStart() } },
    });
    room = Math.max(0, plan.monthlyOrders - counted);
  }
  const ids = held.slice(0, room).map((h) => h.id);
  if (!ids.length) return 0;
  await prisma.giftOrder.updateMany({ where: { id: { in: ids } }, data: { overLimit: false } });
  return ids.length;
}
