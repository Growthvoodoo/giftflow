import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { moderate } from "../lib/orders.server";

/** POST /api/staff/moderate  { ids: string[], decision: "approved" | "rejected" } */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return staffJson({ error: "Method not allowed" }, 405);
  const { shop } = await authenticateStaff(request);
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; decision?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  if (!decision) return staffJson({ error: "decision must be approved or rejected" }, 400);
  if (!ids.length) return staffJson({ error: "Nothing selected." }, 400);
  return staffJson({ updated: await moderate(shop.id, ids, decision) });
};
