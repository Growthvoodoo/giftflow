import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { counts } from "../lib/orders.server";
import { usage } from "../lib/billing.server";

/**
 * GET /api/staff/me — who the key belongs to, and the numbers the dashboard
 * header shows. The dashboard calls this first to check its configuration.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, settings } = await authenticateStaff(request);
  const [c, u] = await Promise.all([counts(shop.id), usage(shop.id)]);
  return staffJson({
    shop: { domain: shop.domain, name: shop.name ?? shop.domain },
    plan: { id: u.plan.id, label: u.plan.label, batchPrint: u.plan.batchPrint },
    usage: { used: u.used, limit: u.limit, heldOverLimit: u.heldOverLimit },
    counts: c,
    card: {
      widthMm: settings.pdfWidthMm,
      heightMm: settings.pdfHeightMm,
      bleedMm: settings.pdfBleedMm,
      cropMarks: settings.pdfCropMarks,
    },
  });
};
