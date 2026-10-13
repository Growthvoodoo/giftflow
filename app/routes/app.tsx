import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/shop.server";
import { releaseHeldOrders, syncPlan } from "../lib/billing.server";

const SYNC_EVERY_MS = 5 * 60_000;
const lastSync = new Map<string, number>();

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  // First load after install is where the shop and its settings come into
  // existence, rather than at OAuth — a failed install then leaves nothing
  // half-created.
  const { shop } = await getSettings(session.shop);
  // The plan is confirmed with Shopify on every admin load and stored, because
  // webhooks and the storefront cannot ask the Billing API themselves.
  // Cached for a few minutes per shop so every click doesn't wait on Billing;
  // the Plan page always checks fresh.
  const last = lastSync.get(shop.id) ?? 0;
  if (Date.now() - last > SYNC_EVERY_MS) {
    const plan = await syncPlan(shop.id, billing);
    await releaseHeldOrders(shop.id, plan);
    lastSync.set(shop.id, Date.now());
  }
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/orders">Gift orders</Link>
        <Link to="/app/cards">Cards</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/plans">Plan</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
