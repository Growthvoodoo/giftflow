import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, InlineGrid,
  Banner, List, ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/shop.server";
import { PLANS, planById, type PlanId } from "../lib/plans";
import { billingEnabled, isTestCharge, releaseHeldOrders, syncPlan, usage } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const plan = await syncPlan(shop.id, billing);
  await releaseHeldOrders(shop.id, plan);
  const u = await usage(shop.id, plan);
  return {
    current: plan.id,
    used: u.used,
    limit: u.limit,
    held: u.heldOverLimit,
    billing: billingEnabled(),
    test: isTestCharge(),
    plans: Object.values(PLANS),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const form = await request.formData();
  const target = planById(String(form.get("plan")) as PlanId);

  if (!billingEnabled()) return redirect("/app/plans");

  if (target.id === "free") {
    // Downgrade: cancel whatever subscription is active.
    const res = await billing.check({ isTest: isTestCharge() });
    for (const sub of res.appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, isTest: isTestCharge(), prorate: true });
    }
    await syncPlan(shop.id, billing);
    return redirect("/app/plans");
  }

  // Sends the merchant to Shopify's approval screen; they come back to the app.
  // billing.request throws the redirect itself.
  await billing.request({
    plan: target.billingName,
    isTest: isTestCharge(),
    returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/plans`,
  });
  return null;
};

export default function Plans() {
  const { current, used, limit, held, billing, test, plans } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const pending = nav.state !== "idle" ? nav.formData?.get("plan") : null;

  return (
    <Page>
      <TitleBar title="Plan" />
      <Layout>
        {!billing && (
          <Layout.Section>
            <Banner tone="info">
              Billing is turned off for this install (GIFTFLOW_BILLING=off), so every feature is unlocked.
            </Banner>
          </Layout.Section>
        )}
        {billing && test && (
          <Layout.Section>
            <Banner tone="info">Development build: plan changes create test charges and nothing is billed.</Banner>
          </Layout.Section>
        )}
        {held > 0 && (
          <Layout.Section>
            <Banner tone="warning" title={`${held} gift order${held === 1 ? " is" : "s are"} on hold`}>
              These came in after this month's limit was reached. They are saved and will be released
              for printing as soon as you upgrade, or when the limit resets next month.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">This month</Text>
              <Text as="p">
                {limit === null ? `${used} gift orders (unlimited)` : `${used} of ${limit} gift orders`}
              </Text>
              {limit !== null && <ProgressBar progress={Math.min(100, (used / limit) * 100)} size="small" />}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
            {plans.map((p) => (
              <Card key={p.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">{p.label}</Text>
                    {p.id === current && <Badge tone="success">Current</Badge>}
                  </InlineStack>
                  <Text as="p" variant="headingLg">
                    {p.priceUsd === 0 ? "Free" : `$${p.priceUsd}/month`}
                  </Text>
                  <List>
                    {p.features.map((f) => <List.Item key={f}>{f}</List.Item>)}
                  </List>
                  <Form method="post">
                    <input type="hidden" name="plan" value={p.id} />
                    <Button
                      submit
                      fullWidth
                      variant={p.id === current ? "secondary" : "primary"}
                      disabled={p.id === current || !billing}
                      loading={pending === p.id}
                    >
                      {p.id === current ? "Current plan" : p.priceUsd === 0 ? "Switch to Free" : `Choose ${p.label}`}
                    </Button>
                  </Form>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
