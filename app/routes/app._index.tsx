import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Button, Banner, Badge, Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop, settings } = await getSettings(session.shop);

  const [waiting, printed, cards, categories] = await Promise.all([
    prisma.giftOrder.count({ where: { shopId: shop.id, status: "new" } }),
    prisma.giftOrder.count({ where: { shopId: shop.id, status: { not: "new" } } }),
    prisma.cardDesign.count({ where: { shopId: shop.id, active: true } }),
    prisma.cardCategory.count({ where: { shopId: shop.id, active: true } }),
  ]);

  // What still has to be filled in before the storefront flow can work at all.
  const missing: string[] = [];
  if (!settings.giftCollectionHandle) missing.push("a gift collection");
  if (!settings.cardVariantId) missing.push("the card product variant");
  if (cards === 0) missing.push("at least one card design");

  return { waiting, printed, cards, categories, missing };
};

export default function Home() {
  const { waiting, printed, cards, categories, missing } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="GiftFlow" />
      <Layout>
        {missing.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title="Finish setting up">
              <BlockStack gap="200">
                <Text as="p">
                  {`The gift flow will not appear on your storefront until you add ${missing.join(", ")}.`}
                </Text>
                <InlineStack gap="200">
                  <Button url="/app/settings">Open settings</Button>
                  {cards === 0 && <Button url="/app/cards" variant="primary">Add a card</Button>}
                </InlineStack>
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Today</Text>
              <InlineStack gap="600" wrap>
                <Stat label="Waiting to print" value={waiting} tone={waiting > 0 ? "critical" : undefined} />
                <Stat label="Printed" value={printed} />
                <Stat label="Card designs" value={cards} />
                <Stat label="Categories" value={categories} />
              </InlineStack>
              {waiting > 0 && (
                <Box>
                  <Button url="/app/orders" variant="primary">
                    {`Print ${waiting} card${waiting === 1 ? "" : "s"}`}
                  </Button>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Add the flow to your theme</Text>
              <Text as="p" tone="subdued">
                In the theme editor, open the page you want the gift flow on, choose
                Add block, and pick GiftFlow. The block reads the collection and card
                settings from here, so nothing is hardcoded in the theme.
              </Text>
              <InlineStack gap="200">
                <Badge tone="info">Theme app extension</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "critical" }) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="heading2xl" tone={tone}>{String(value)}</Text>
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
    </BlockStack>
  );
}
