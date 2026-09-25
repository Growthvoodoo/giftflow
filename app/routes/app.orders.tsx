import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge,
  IndexTable, useIndexResourceState, EmptyState, Banner, Thumbnail, Box, Tabs,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { urlFor } from "../lib/storage.server";

const TABS = [
  { id: "new", content: "Waiting to print" },
  { id: "printed", content: "Printed" },
  { id: "all", content: "All" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);

  const tab = new URL(request.url).searchParams.get("tab") ?? "new";
  const where =
    tab === "all" ? { shopId: shop.id }
    : tab === "printed" ? { shopId: shop.id, status: { not: "new" } }
    : { shopId: shop.id, status: "new" };

  const orders = await prisma.giftOrder.findMany({
    where,
    orderBy: { orderedAt: "desc" },
    take: 200,
  });

  return {
    tab,
    orders: orders.map((o) => ({
      id: o.id,
      orderName: o.orderName ?? `#${o.orderId}`,
      orderedAt: o.orderedAt.toISOString(),
      customerName: o.customerName,
      recipient: o.recipient,
      cardTitle: o.cardTitle,
      image: urlFor(o.cardImageKey),
      messageText: o.messageText,
      status: o.status,
      printedAt: o.printedAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = String(form.get("ids") || "").split(",").filter(Boolean);

  if (!ids.length) return { ok: false, error: "Nothing selected." };

  // Never act on another shop's rows, however the ids arrived.
  const mine = await prisma.giftOrder.findMany({
    where: { id: { in: ids }, shopId: shop.id },
    select: { id: true },
  });
  const safeIds = mine.map((m) => m.id);
  if (!safeIds.length) return { ok: false, error: "Nothing selected." };

  if (intent === "mark-printed" || intent === "mark-packed") {
    await prisma.giftOrder.updateMany({
      where: { id: { in: safeIds } },
      data: {
        status: intent === "mark-printed" ? "printed" : "packed",
        printedAt: new Date(),
      },
    });
    return { ok: true };
  }

  if (intent === "print") {
    // The PDF itself is streamed by the resource route, which keeps this action
    // fast and lets the browser open it in a new tab.
    return { ok: true, printUrl: `/app/print?ids=${safeIds.join(",")}` };
  }

  return { ok: false, error: "Unknown action" };
};

export default function Orders() {
  const { orders, tab } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const [opened, setOpened] = useState<string | null>(null);

  const resourceName = { singular: "gift order", plural: "gift orders" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(orders.map((o) => ({ id: o.id })));

  const act = (intent: string) => {
    fetcher.submit(
      { intent, ids: selectedResources.join(",") },
      { method: "post" },
    );
    if (intent === "print") {
      window.open(`/app/print?ids=${selectedResources.join(",")}`, "_blank");
    }
  };

  const selectedTab = Math.max(0, TABS.findIndex((t) => t.id === tab));

  return (
    <Page>
      <TitleBar title="Gift orders" />
      <Layout>
        {fetcher.data?.error && (
          <Layout.Section><Banner tone="critical">{fetcher.data.error}</Banner></Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Tabs
              tabs={TABS}
              selected={selectedTab}
              onSelect={(i) => { params.set("tab", TABS[i].id); setParams(params); }}
            >
              {orders.length === 0 ? (
                <Box padding="800">
                  <EmptyState
                    heading={tab === "new" ? "Nothing waiting to print" : "No gift orders yet"}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Gift orders appear here automatically when an order comes in
                      carrying a gift token.
                    </p>
                  </EmptyState>
                </Box>
              ) : (
                <>
                  {selectedResources.length > 0 && (
                    <Box padding="300" background="bg-surface-secondary">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm">
                          {`${selectedResources.length} selected`}
                        </Text>
                        <Button variant="primary" onClick={() => act("print")}>
                          {`Print ${selectedResources.length} card${selectedResources.length === 1 ? "" : "s"}`}
                        </Button>
                        <Button onClick={() => act("mark-printed")}>Mark printed</Button>
                        <Button onClick={() => act("mark-packed")}>Mark packed</Button>
                      </InlineStack>
                    </Box>
                  )}

                  <IndexTable
                    resourceName={resourceName}
                    itemCount={orders.length}
                    selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: "Order" }, { title: "Card" }, { title: "Message" },
                      { title: "Recipient" }, { title: "Status" },
                    ]}
                  >
                    {orders.map((o, i) => (
                      <IndexTable.Row
                        id={o.id} key={o.id} position={i}
                        selected={selectedResources.includes(o.id)}
                        onClick={() => setOpened(opened === o.id ? null : o.id)}
                      >
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{o.orderName}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {new Date(o.orderedAt).toLocaleDateString()}
                            </Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" blockAlign="center">
                            {o.image && <Thumbnail source={o.image} alt="" size="small" />}
                            <Text as="span" variant="bodySm">{o.cardTitle ?? "—"}</Text>
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Box maxWidth="320px">
                            <Text as="span" variant="bodySm" truncate>
                              {o.messageText || "—"}
                            </Text>
                          </Box>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{o.recipient ?? o.customerName ?? "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {o.status === "new"
                            ? <Badge tone="attention">Waiting</Badge>
                            : o.status === "printed"
                              ? <Badge tone="success">Printed</Badge>
                              : <Badge>Packed</Badge>}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
