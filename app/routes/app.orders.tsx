import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge,
  IndexTable, useIndexResourceState, EmptyState, Banner, Thumbnail, Box, Tabs,
  Modal, TextField, Checkbox, Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/shop.server";
import { urlFor } from "../lib/storage.server";
import {
  counts, isView, listOrders, moderate, serializeOrder, setStatus,
  type SerializedOrder, type View,
} from "../lib/orders.server";
import { storedPlan } from "../lib/billing.server";

const TABS: Array<{ id: View; content: string }> = [
  { id: "new", content: "To print" },
  { id: "review", content: "Needs approval" },
  { id: "held", content: "On hold" },
  { id: "printed", content: "Printed" },
  { id: "packed", content: "Packed" },
  { id: "all", content: "All" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const view: View = isView(tabParam) ? tabParam : "new";
  const q = url.searchParams.get("q") ?? "";

  const [{ rows, total }, c, plan] = await Promise.all([
    listOrders(shop.id, { view, q, take: 250 }),
    counts(shop.id),
    storedPlan(shop.id),
  ]);

  return {
    view,
    q,
    total,
    counts: c,
    batchPrint: plan.batchPrint,
    planLabel: plan.label,
    orders: rows.map((o) => serializeOrder(o, urlFor)),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = String(form.get("ids") || "").split(",").filter(Boolean);
  if (!ids.length) return { ok: false as const, error: "Nothing selected." };

  switch (intent) {
    case "mark-new":
      return { ok: true as const, updated: await setStatus(shop.id, ids, "new") };
    case "mark-printed":
      return { ok: true as const, updated: await setStatus(shop.id, ids, "printed") };
    case "mark-packed":
      return { ok: true as const, updated: await setStatus(shop.id, ids, "packed") };
    case "approve":
      return { ok: true as const, updated: await moderate(shop.id, ids, "approved") };
    case "reject":
      return { ok: true as const, updated: await moderate(shop.id, ids, "rejected") };
    default:
      return { ok: false as const, error: "Unknown action" };
  }
};

/**
 * Fetches the PDF with the session token (App Bridge adds it to fetch) and
 * opens it in a new tab, where the browser's own print dialog takes over.
 * The tab is opened before the request so popup blockers allow it.
 */
async function openPdf(ids: string[], markPrinted: boolean): Promise<string | null> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`/app/print?ids=${ids.join(",")}${markPrinted ? "&mark=1" : ""}`);
    if (!res.ok) {
      tab?.close();
      const body = await res.json().catch(() => ({}));
      return body.error ?? `Printing failed (${res.status}).`;
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    if (tab) {
      tab.location.href = blobUrl;
    } else {
      // Popup blocked: fall back to a download.
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `giftflow-${ids.length}-cards.pdf`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return null;
  } catch (e) {
    tab?.close();
    return e instanceof Error ? e.message : "Printing failed.";
  }
}

export default function Orders() {
  const { orders, view, q, counts: c, batchPrint, planLabel, total } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [preview, setPreview] = useState<SerializedOrder | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [markPrinted, setMarkPrinted] = useState(true);
  const [search, setSearch] = useState(q);

  const resourceName = { singular: "gift order", plural: "gift orders" };
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(orders.map((o) => ({ id: o.id })));

  useEffect(() => { clearSelection(); }, [view, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (intent: string, ids: string[] = selectedResources) => {
    fetcher.submit({ intent, ids: ids.join(",") }, { method: "post" });
  };

  const print = useCallback(async (ids: string[]) => {
    setPrintError(null);
    setPrinting(true);
    const err = await openPdf(ids, markPrinted);
    setPrinting(false);
    if (err) setPrintError(err);
    else if (markPrinted) revalidator.revalidate();
  }, [markPrinted, revalidator]);

  const selectedTab = Math.max(0, TABS.findIndex((t) => t.id === view));
  const selected = orders.filter((o) => selectedResources.includes(o.id));
  const printableSelected = selected.filter((o) => !o.printBlocker);
  const tooManyForPlan = !batchPrint && selectedResources.length > 1;

  return (
    <Page fullWidth>
      <TitleBar title="Gift orders" />
      <Layout>
        {(fetcher.data && !fetcher.data.ok) && (
          <Layout.Section><Banner tone="critical">{fetcher.data.error}</Banner></Layout.Section>
        )}
        {printError && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setPrintError(null)}>{printError}</Banner>
          </Layout.Section>
        )}
        {c.review > 0 && view !== "review" && (
          <Layout.Section>
            <Banner tone="warning" action={{ content: "Review", onAction: () => { params.set("tab", "review"); setParams(params); } }}>
              {`${c.review} customer image${c.review === 1 ? " needs" : "s need"} your approval before printing.`}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Tabs
              tabs={TABS.map((t) => ({ ...t, content: `${t.content} (${c[t.id]})` }))}
              selected={selectedTab}
              onSelect={(i) => { params.set("tab", TABS[i].id); setParams(params); }}
            >
              <Box padding="300">
                <form onSubmit={(e) => { e.preventDefault(); search ? params.set("q", search) : params.delete("q"); setParams(params); }}>
                  <InlineStack gap="200" blockAlign="end" wrap={false}>
                    <Box width="100%">
                      <TextField
                        label="Search" labelHidden autoComplete="off" value={search} onChange={setSearch}
                        placeholder="Order number, customer, recipient or message"
                        clearButton onClearButtonClick={() => { setSearch(""); params.delete("q"); setParams(params); }}
                      />
                    </Box>
                    <Button submit>Search</Button>
                  </InlineStack>
                </form>
              </Box>

              {orders.length === 0 ? (
                <Box padding="800">
                  <EmptyState
                    heading={view === "new" ? "Nothing waiting to print" : "No gift orders here"}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Gift orders appear here automatically when an order comes in carrying a gift card.</p>
                  </EmptyState>
                </Box>
              ) : (
                <>
                  {selectedResources.length > 0 && (
                    <Box padding="300" background="bg-surface-secondary">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="span" variant="bodySm">{`${selectedResources.length} selected`}</Text>
                          <Button
                            variant="primary"
                            loading={printing}
                            disabled={printableSelected.length !== selected.length || tooManyForPlan}
                            onClick={() => print(selectedResources)}
                          >
                            {`Print ${selectedResources.length} card${selectedResources.length === 1 ? "" : "s"}`}
                          </Button>
                          <Checkbox label="Mark as printed" checked={markPrinted} onChange={setMarkPrinted} />
                          <Button onClick={() => act("mark-printed")}>Mark printed</Button>
                          <Button onClick={() => act("mark-packed")}>Mark packed</Button>
                          <Button onClick={() => act("mark-new")}>Back to "To print"</Button>
                          {selected.some((o) => o.isUpload) && (
                            <>
                              <Button tone="success" onClick={() => act("approve")}>Approve images</Button>
                              <Button tone="critical" onClick={() => act("reject")}>Reject images</Button>
                            </>
                          )}
                        </InlineStack>
                        {tooManyForPlan && (
                          <Text as="p" tone="caution" variant="bodySm">
                            {`Batch printing isn't in the ${planLabel} plan — select one card, or upgrade under Plan.`}
                          </Text>
                        )}
                        {printableSelected.length !== selected.length && (
                          <Text as="p" tone="caution" variant="bodySm">
                            Some selected cards can't be printed yet (waiting for approval, rejected or on hold).
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  )}

                  <IndexTable
                    resourceName={resourceName}
                    itemCount={orders.length}
                    selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: "Order" }, { title: "Card" }, { title: "Message" },
                      { title: "Recipient" }, { title: "Status" }, { title: "" },
                    ]}
                  >
                    {orders.map((o, i) => (
                      <IndexTable.Row id={o.id} key={o.id} position={i} selected={selectedResources.includes(o.id)}>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{o.orderName}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {new Date(o.orderedAt).toLocaleString()}
                            </Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            {o.image && <Thumbnail source={o.image} alt="" size="small" />}
                            <Text as="span" variant="bodySm">{o.cardTitle ?? "—"}</Text>
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Box maxWidth="320px">
                            <Text as="span" variant="bodySm" truncate>{o.messageText || "—"}</Text>
                          </Box>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{o.recipient ?? o.customerName ?? "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell><StatusBadges o={o} /></IndexTable.Cell>
                        <IndexTable.Cell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button size="slim" onClick={() => setPreview(o)}>View</Button>
                          </div>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                  {total > orders.length && (
                    <Box padding="300">
                      <Text as="p" tone="subdued" variant="bodySm">
                        {`Showing the first ${orders.length} of ${total}. Search to narrow it down.`}
                      </Text>
                    </Box>
                  )}
                </>
              )}
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title={`${preview.orderName} — ${preview.cardTitle ?? "Gift card"}`}
          primaryAction={{
            content: "Print this card",
            disabled: Boolean(preview.printBlocker),
            loading: printing,
            onAction: async () => { await print([preview.id]); setPreview(null); },
          }}
          secondaryActions={[
            ...(preview.uploadStatus && preview.uploadStatus !== "approved"
              ? [{ content: "Approve image", onAction: () => { act("approve", [preview.id]); setPreview(null); } }]
              : []),
            ...(preview.uploadStatus && preview.uploadStatus !== "rejected"
              ? [{ content: "Reject image", destructive: true, onAction: () => { act("reject", [preview.id]); setPreview(null); } }]
              : []),
          ]}
        >
          <Modal.Section>
            <InlineStack gap="500" wrap={false} blockAlign="start">
              {preview.image && (
                <img src={preview.image} alt="" style={{ width: 200, borderRadius: 8, border: "1px solid #ddd" }} />
              )}
              <BlockStack gap="300">
                {preview.printBlocker && <Banner tone="warning">{preview.printBlocker}</Banner>}
                {preview.recipient && <Text as="p" tone="subdued">{`To: ${preview.recipient}`}</Text>}
                <div
                  style={{ whiteSpace: "normal", fontSize: 15, lineHeight: 1.5 }}
                  // Sanitized server-side against an allowlist before it was stored.
                  dangerouslySetInnerHTML={{ __html: preview.messageHtml || "<p>(no message)</p>" }}
                />
                {preview.sender && <Text as="p" tone="subdued">{`From: ${preview.sender}`}</Text>}
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  {`Ordered ${new Date(preview.orderedAt).toLocaleString()}${preview.customerName ? ` by ${preview.customerName}` : ""}`}
                </Text>
              </BlockStack>
            </InlineStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

function StatusBadges({ o }: { o: SerializedOrder }) {
  return (
    <InlineStack gap="100" wrap>
      {o.overLimit && <Badge tone="warning">On hold</Badge>}
      {o.uploadStatus === "pending" && <Badge tone="attention">Needs approval</Badge>}
      {o.uploadStatus === "rejected" && <Badge tone="critical">Image rejected</Badge>}
      {o.status === "new" ? <Badge tone="info">To print</Badge>
        : o.status === "printed" ? <Badge tone="success">Printed</Badge>
        : <Badge>Packed</Badge>}
    </InlineStack>
  );
}
