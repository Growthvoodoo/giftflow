import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Button, TextField,
  Select, Thumbnail, Badge, EmptyState, Modal, DropZone, Banner, Box, InlineGrid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { keyForCard, put, urlFor, usingBlob } from "../lib/storage.server";
import { sniffImage } from "../lib/images.server";
import { storedPlan } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);

  const [cards, categories] = await Promise.all([
    prisma.cardDesign.findMany({
      where: { shopId: shop.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: { category: { select: { name: true } } },
    }),
    prisma.cardCategory.findMany({
      where: { shopId: shop.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const plan = await storedPlan(shop.id);
  return {
    maxCards: plan.maxCards,
    planLabel: plan.label,
    categories,
    cards: cards.map((c) => ({
      id: c.id, title: c.title, active: c.active,
      categoryName: c.category?.name ?? null,
      priceMinor: c.priceMinor,
      image: urlFor(c.thumbnailKey ?? c.imageKey),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");
  const fail = (error: string) => ({ ok: false as const, error });
  const done = { ok: true as const, error: null };

  if (intent === "add-category") {
    const name = String(form.get("name") || "").trim();
    if (!name) return fail("A category needs a name.");
    const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await prisma.cardCategory.upsert({
      where: { shopId_handle: { shopId: shop.id, handle } },
      update: { name, active: true },
      create: { shopId: shop.id, name, handle },
    });
    return done;
  }

  if (intent === "delete-category") {
    await prisma.cardCategory.deleteMany({ where: { id: String(form.get("id")), shopId: shop.id } });
    return done;
  }

  if (intent === "add-card") {
    const file = form.get("file");
    const title = String(form.get("title") || "").trim();
    if (!(file instanceof File) || file.size === 0) return fail("Choose an image for the card.");
    if (!title) return fail("Give the card a title.");
    // On Vercel, images are served through a function capped at ~4.5 MB.
    const maxMb = usingBlob() ? 4 : 25;
    if (file.size > maxMb * 1024 * 1024) {
      return fail(`Card artwork must be under ${maxMb} MB. Export it as a JPEG at print size (about 1300 × 1800 px for A6).`);
    }

    const plan = await storedPlan(shop.id);
    if (plan.maxCards !== null) {
      const active = await prisma.cardDesign.count({ where: { shopId: shop.id, active: true } });
      if (active >= plan.maxCards) {
        return fail(`The ${plan.label} plan includes ${plan.maxCards} card designs. Hide one, or upgrade under Plan.`);
      }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind) return fail("That file is not a JPEG, PNG or WebP image.");
    const key = keyForCard(session.shop, kind.ext);
    await put(key, buf);

    await prisma.cardDesign.create({
      data: {
        shopId: shop.id,
        title,
        imageKey: key,
        categoryId: String(form.get("categoryId") || "") || null,
        priceMinor: Math.max(0, Math.round(Number(form.get("price") || 0) * 100)),
        tags: String(form.get("tags") || "").trim(),
        sortOrder: Number(form.get("sortOrder") || 0),
      },
    });
    return done;
  }

  if (intent === "toggle") {
    const id = String(form.get("id"));
    const card = await prisma.cardDesign.findFirst({ where: { id, shopId: shop.id } });
    if (card) {
      if (!card.active) {
        const plan = await storedPlan(shop.id);
        const active = await prisma.cardDesign.count({ where: { shopId: shop.id, active: true } });
        if (plan.maxCards !== null && active >= plan.maxCards) {
          return fail(`The ${plan.label} plan includes ${plan.maxCards} active card designs.`);
        }
      }
      await prisma.cardDesign.update({ where: { id }, data: { active: !card.active } });
    }
    return done;
  }

  if (intent === "delete") {
    // Deleting a design never changes an order that already used it — GiftOrder
    // holds a snapshot, not a reference.
    await prisma.cardDesign.deleteMany({ where: { id: String(form.get("id")), shopId: shop.id } });
    return done;
  }

  return fail("Unknown action");
};

export default function Cards() {
  const { cards, categories, maxCards, planLabel } = useLoaderData<typeof loader>();
  const activeCount = cards.filter((c) => c.active).length;
  const fetcher = useFetcher<typeof action>();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const busy = fetcher.state !== "idle";

  const emptyForm = { title: "", categoryId: "", price: "0", sortOrder: "0", tags: "" };
  const [form, setForm] = useState(emptyForm);
  const [catName, setCatName] = useState("");

  const submitCard = () => {
    const data = new FormData();
    data.set("intent", "add-card");
    Object.entries(form).forEach(([k, v]) => data.set(k, v));
    if (file) data.set("file", file);
    fetcher.submit(data, { method: "post", encType: "multipart/form-data" });
    setOpen(false);
    setFile(null);
    setForm(emptyForm);
  };

  return (
    <Page>
      <TitleBar title="Cards" />
      <Layout>
        {fetcher.data?.error && (
          <Layout.Section>
            <Banner tone="critical">{fetcher.data.error}</Banner>
          </Layout.Section>
        )}

        {maxCards !== null && (
          <Layout.Section>
            <Banner tone={activeCount >= maxCards ? "warning" : "info"}>
              {`${activeCount} of ${maxCards} active card designs used on the ${planLabel} plan.`}
            </Banner>
          </Layout.Section>
        )}

        {categories.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">Categories</Text>
                <InlineStack gap="200" wrap>
                  {categories.map((c) => (
                    <fetcher.Form method="post" key={c.id}>
                      <input type="hidden" name="intent" value="delete-category" />
                      <input type="hidden" name="id" value={c.id} />
                      <InlineStack gap="100" blockAlign="center">
                        <Badge>{c.name}</Badge>
                        <Button submit size="micro" variant="plain" tone="critical" accessibilityLabel={`Delete ${c.name}`}>×</Button>
                      </InlineStack>
                    </fetcher.Form>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="h2" variant="headingMd">{`Card designs (${cards.length})`}</Text>
                <InlineStack gap="200">
                  <Button onClick={() => setCatOpen(true)}>Add category</Button>
                  <Button variant="primary" onClick={() => setOpen(true)}>Add card</Button>
                </InlineStack>
              </InlineStack>

              {cards.length === 0 ? (
                <EmptyState
                  heading="No cards yet"
                  action={{ content: "Add your first card", onAction: () => setOpen(true) }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    These are the designs a customer picks from. Upload the
                    artwork at print resolution — it is what ends up on the PDF.
                  </p>
                </EmptyState>
              ) : (
                <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="400">
                  {cards.map((c) => (
                    <BlockStack key={c.id} gap="200">
                      <Thumbnail source={c.image ?? ""} alt={c.title} size="large" />
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{c.title}</Text>
                        <InlineStack gap="150" blockAlign="center" wrap>
                          {c.categoryName && <Badge>{c.categoryName}</Badge>}
                          {!c.active && <Badge tone="warning">Hidden</Badge>}
                        </InlineStack>
                        <InlineStack gap="100">
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="toggle" />
                            <input type="hidden" name="id" value={c.id} />
                            <Button submit size="slim" variant="plain">
                              {c.active ? "Hide" : "Show"}
                            </Button>
                          </fetcher.Form>
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={c.id} />
                            <Button submit size="slim" variant="plain" tone="critical">Delete</Button>
                          </fetcher.Form>
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  ))}
                </InlineGrid>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a card">
        <Modal.Section>
          <form
            id="add-card"
            onSubmit={(e) => { e.preventDefault(); submitCard(); }}
          >
            <BlockStack gap="400">
              <DropZone accept="image/*" type="image" allowMultiple={false}
                onDrop={(_d, accepted) => setFile(accepted[0] ?? null)}>
                {file ? (
                  <Box padding="400"><Text as="p">{file.name}</Text></Box>
                ) : (
                  <DropZone.FileUpload actionHint="Accepts JPG, PNG and WebP" />
                )}
              </DropZone>
              <TextField label="Title" autoComplete="off"
                value={form.title} onChange={(title) => setForm((f) => ({ ...f, title }))} />
              <Select
                label="Category"
                value={form.categoryId}
                onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
                options={[
                  { label: "None", value: "" },
                  ...categories.map((c) => ({ label: c.name, value: c.id })),
                ]}
              />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <TextField label="Extra charge" type="number" step={0.01}
                  value={form.price} onChange={(price) => setForm((f) => ({ ...f, price }))}
                  autoComplete="off" helpText="Leave at 0 to use the standard card price." />
                <TextField label="Sort order" type="number" autoComplete="off"
                  value={form.sortOrder} onChange={(sortOrder) => setForm((f) => ({ ...f, sortOrder }))} />
              </InlineGrid>
              <TextField label="Tags" autoComplete="off"
                value={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                helpText="Comma separated. Used for filtering in the flow." />
              <InlineStack align="end" gap="200">
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button submit variant="primary" loading={busy} disabled={!file || !form.title.trim()}>Add card</Button>
              </InlineStack>
            </BlockStack>
          </form>
        </Modal.Section>
      </Modal>

      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="Add a category">
        <Modal.Section>
          <fetcher.Form method="post" onSubmit={() => { setCatOpen(false); setTimeout(() => setCatName(""), 0); }}>
            <BlockStack gap="400">
              <input type="hidden" name="intent" value="add-category" />
              <input type="hidden" name="name" value={catName} />
              <TextField label="Name" value={catName} onChange={setCatName} autoComplete="off"
                helpText="Shown as a filter tab when the customer picks a card." />
              <InlineStack align="end" gap="200">
                <Button onClick={() => setCatOpen(false)}>Cancel</Button>
                <Button submit variant="primary">Add</Button>
              </InlineStack>
            </BlockStack>
          </fetcher.Form>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
