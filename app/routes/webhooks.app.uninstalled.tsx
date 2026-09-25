import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Sessions must go, or a reinstall reuses a dead access token. Gift orders are
 * kept: a merchant who reinstalls expects their print history back, and this is
 * not personal data the shop asked to have erased — shop/redact handles that.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);
  if (session) await prisma.session.deleteMany({ where: { shop } });
  await prisma.shop.updateMany({
    where: { domain: shop },
    data: { uninstalledAt: new Date() },
  });
  return new Response();
};
