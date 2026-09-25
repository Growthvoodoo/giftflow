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
import { hash, keyForUpload, put, urlFor } from "../lib/storage.server";

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

  return {
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

  if (intent === "add-category") {
    const name = String(form.get("name") || "").trim();
    if (!name) return { ok: false, error: "A category needs a name." };
    const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await prisma.cardCategory.upsert({
      where: { shopId_handle: { shopId: shop.id, handle } },
      update: { name, active: true },
      create: { shopId: shop.id, name, handle },
    });
    return { ok: true };
  }

  if (intent === "add-card") {
    const file = form.get("file");
    const title = String(form.get("title") || "").trim();
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose an image for the card." };
    }
    if (!title) return { ok: false, error: "Give the card a title." };

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const key = keyForUpload(session.shop, ext);
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
    return { ok: true, hash: hash(buf) };
  }

  if (intent === "toggle") {
    const id = String(form.get("id"));
    const card = await prisma.cardDesign.findFirst({ where: { id, shopId: shop.id } });
    if (card) {
      await prisma.cardDesign.update({ where: { id }, data: { active: !card.active } });
    }
    return { ok: true };
  }

  if (intent === "delete") {
    // Deleting a design never changes an order that already used it — GiftOrder
    // holds a snapshot, not a reference.
    await prisma.cardDesign.deleteMany({ where: { id: String(form.get("id")), shopId: shop.id } });
    return { ok: true };
  }

  return { ok: false, error: "Unknown action" };
};

export default function Cards() {
  const { cards, categories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const busy = fetcher.state !== "idle";

  const submitCard = (form: HTMLFormElement) => {
    const data = new FormData(form);
    data.set("intent", "add-card");
    if (file) data.set("file", file);
    fetcher.submit(data, { method: "post", encType: "multipart/form-data" });
    setOpen(false);
    setFile(null);
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
                    These are the designs a customer picks from in step 4. Upload the
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
            onSubmit={(e) => { e.preventDefault(); submitCard(e.currentTarget); }}
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
              <TextField label="Title" name="title" autoComplete="off" />
              <Select
                label="Category"
                name="categoryId"
                options={[
                  { label: "None", value: "" },
                  ...categories.map((c) => ({ label: c.name, value: c.id })),
                ]}
              />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <TextField label="Extra charge" name="price" type="number" step={0.01}
                  prefix="kr" autoComplete="off"
                  helpText="Leave at 0 to use the standard card price." />
                <TextField label="Sort order" name="sortOrder" type="number" autoComplete="off" />
              </InlineGrid>
              <TextField label="Tags" name="tags" autoComplete="off"
                helpText="Comma separated. Used for filtering in the flow." />
              <InlineStack align="end" gap="200">
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button submit variant="primary" loading={busy} disabled={!file}>Add card</Button>
              </InlineStack>
            </BlockStack>
          </form>
        </Modal.Section>
      </Modal>

      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="Add a category">
        <Modal.Section>
          <fetcher.Form method="post" onSubmit={() => setCatOpen(false)}>
            <BlockStack gap="400">
              <input type="hidden" name="intent" value="add-category" />
              <TextField label="Name" name="name" autoComplete="off"
                helpText="Shown as a filter tab in step 4." />
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
