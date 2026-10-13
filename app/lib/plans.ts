/**
 * Plans. Shared by the server (enforcement) and the admin UI (the plan page),
 * so it holds no secrets and imports nothing server-only.
 *
 * Metered on gift orders per month — the work the app actually does, and the
 * number that rises in December when the app saves the most time.
 * Change prices and limits here and nowhere else.
 */

export type PlanId = "free" | "standard" | "growth" | "scale";

export interface Plan {
  id: PlanId;
  /** The name the Billing API knows the plan by. Never rename a live plan. */
  billingName: string;
  label: string;
  priceUsd: number;
  /** Gift orders per calendar month. null = unlimited. */
  monthlyOrders: number | null;
  /** Active card designs. null = unlimited. */
  maxCards: number | null;
  batchPrint: boolean;
  uploads: boolean;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    billingName: "GiftFlow Free",
    label: "Free",
    priceUsd: 0,
    monthlyOrders: 25,
    maxCards: 5,
    batchPrint: false,
    uploads: false,
    features: ["25 gift orders a month", "5 card designs", "Single-card printing"],
  },
  standard: {
    id: "standard",
    billingName: "GiftFlow Standard",
    label: "Standard",
    priceUsd: 29,
    monthlyOrders: 300,
    maxCards: null,
    batchPrint: true,
    uploads: true,
    features: ["300 gift orders a month", "Unlimited card designs", "Batch printing", "Customer image uploads"],
  },
  growth: {
    id: "growth",
    billingName: "GiftFlow Growth",
    label: "Growth",
    priceUsd: 79,
    monthlyOrders: 1500,
    maxCards: null,
    batchPrint: true,
    uploads: true,
    features: ["1,500 gift orders a month", "Everything in Standard", "Upload approval queue", "Custom card sizes"],
  },
  scale: {
    id: "scale",
    billingName: "GiftFlow Scale",
    label: "Scale",
    priceUsd: 199,
    monthlyOrders: null,
    maxCards: null,
    batchPrint: true,
    uploads: true,
    features: ["Unlimited gift orders", "Everything in Growth", "Priority support"],
  },
};

export const PAID_PLANS = [PLANS.standard, PLANS.growth, PLANS.scale];

export function planById(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
}

export function planByBillingName(name: string | null | undefined): Plan {
  return Object.values(PLANS).find((p) => p.billingName === name) ?? PLANS.free;
}
