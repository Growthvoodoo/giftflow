import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, TextField, Checkbox, Button,
  InlineGrid, Banner, InlineStack, Box, Badge, Select,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { generateStaffKey, revokeStaffKey } from "../lib/staff.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { settings } = await getSettings(session.shop);
  return {
    settings: {
      giftCollectionHandle: settings.giftCollectionHandle ?? "",
      cardVariantId: settings.cardVariantId ?? "",
      cardPriceMinor: settings.cardPriceMinor,
      messageMaxChars: settings.messageMaxChars,
      allowUploads: settings.allowUploads,
      moderateUploads: settings.moderateUploads,
      maxUploadBytes: settings.maxUploadBytes,
      pdfWidthMm: settings.pdfWidthMm,
      pdfHeightMm: settings.pdfHeightMm,
      pdfBleedMm: settings.pdfBleedMm,
      pdfCropMarks: settings.pdfCropMarks,
      pdfLayout: settings.pdfLayout,
      visiblePropertyName: settings.visiblePropertyName,
      visiblePropertyValue: settings.visiblePropertyValue,
    },
    staffKey: settings.staffApiKeyHint
      ? { hint: settings.staffApiKeyHint, createdAt: settings.staffApiKeyCreatedAt?.toISOString() ?? null }
      : null,
    appUrl: process.env.SHOPIFY_APP_URL || new URL(request.url).origin,
  };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const f = await request.formData();
  const intent = String(f.get("intent") || "save");

  if (intent === "generate-key") {
    return { ok: true as const, newKey: await generateStaffKey(shop.id) };
  }
  if (intent === "revoke-key") {
    await revokeStaffKey(shop.id);
    return { ok: true as const, revoked: true };
  }

  const num = (k: string, fallback: number) => {
    const raw = f.get(k);
    const v = Number(raw);
    return raw !== null && raw !== "" && Number.isFinite(v) ? v : fallback;
  };

  // Accepts a bare number or a gid://shopify/ProductVariant/123 from the picker.
  const variant = String(f.get("cardVariantId") || "").trim().replace(/^gid:\/\/shopify\/ProductVariant\//, "");
  if (variant && !/^\d+$/.test(variant)) {
    return { ok: false as const, error: "The card variant ID must be a number." };
  }

  await prisma.settings.update({
    where: { shopId: shop.id },
    data: {
      giftCollectionHandle: String(f.get("giftCollectionHandle") || "").trim() || null,
      cardVariantId: variant || null,
      cardPriceMinor: Math.max(0, Math.round(num("cardPrice", 0) * 100)),
      messageMaxChars: clamp(Math.round(num("messageMaxChars", 300)), 10, 5000),
      allowUploads: f.get("allowUploads") === "true",
      moderateUploads: f.get("moderateUploads") === "true",
      maxUploadBytes: Math.round(clamp(num("maxUploadMb", 5), 1, 20) * 1024 * 1024),
      pdfWidthMm: clamp(num("pdfWidthMm", 105), 30, 600),
      pdfHeightMm: clamp(num("pdfHeightMm", 148), 30, 600),
      pdfBleedMm: clamp(num("pdfBleedMm", 3), 0, 10),
      pdfCropMarks: f.get("pdfCropMarks") === "true",
      pdfLayout: ["overlay", "two-sided", "message-only"].includes(String(f.get("pdfLayout")))
        ? String(f.get("pdfLayout"))
        : "overlay",
      visiblePropertyName: String(f.get("visiblePropertyName") || "Gift kort").slice(0, 60),
      visiblePropertyValue: String(f.get("visiblePropertyValue") || "Ja").slice(0, 60),
    },
  });

  return { ok: true as const, saved: true };
};

const SIZES = [
  { label: "A6 (105 × 148 mm)", value: "105x148" },
  { label: "A7 (74 × 105 mm)", value: "74x105" },
  { label: "Square (120 × 120 mm)", value: "120x120" },
  { label: "DL (99 × 210 mm)", value: "99x210" },
  { label: "US postcard (4 × 6 in)", value: "101.6x152.4" },
  { label: "Custom", value: "custom" },
];

export default function Settings() {
  const { settings, staffKey, appUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const saving = nav.state === "submitting" && nav.formData?.get("intent") === "save";

  const [v, setV] = useState({
    giftCollectionHandle: settings.giftCollectionHandle,
    cardVariantId: settings.cardVariantId,
    cardPrice: (settings.cardPriceMinor / 100).toFixed(2),
    messageMaxChars: String(settings.messageMaxChars),
    allowUploads: settings.allowUploads,
    moderateUploads: settings.moderateUploads,
    maxUploadMb: String(Math.round(settings.maxUploadBytes / 1024 / 1024)),
    pdfWidthMm: String(settings.pdfWidthMm),
    pdfHeightMm: String(settings.pdfHeightMm),
    pdfBleedMm: String(settings.pdfBleedMm),
    pdfCropMarks: settings.pdfCropMarks,
    pdfLayout: settings.pdfLayout,
    visiblePropertyName: settings.visiblePropertyName,
    visiblePropertyValue: settings.visiblePropertyValue,
  });
  const set = <K extends keyof typeof v>(k: K) => (value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));

  const sizeValue = SIZES.find((s) => s.value === `${Number(v.pdfWidthMm)}x${Number(v.pdfHeightMm)}`)?.value ?? "custom";

  useEffect(() => {
    if (result && "saved" in result) shopify.toast.show("Settings saved");
  }, [result, shopify]);

  const save = () => {
    const data: Record<string, string> = { intent: "save" };
    for (const [k, val] of Object.entries(v)) data[k] = String(val);
    submit(data, { method: "post" });
  };

  const pickCollection = async () => {
    const picked = await shopify.resourcePicker({ type: "collection", multiple: false });
    const c = picked?.[0] as { handle?: string } | undefined;
    if (c?.handle) set("giftCollectionHandle")(c.handle);
  };

  const pickVariant = async () => {
    const picked = await shopify.resourcePicker({ type: "variant", multiple: false });
    const p = picked?.[0] as { id?: string } | undefined;
    if (p?.id) set("cardVariantId")(p.id.replace(/^gid:\/\/shopify\/ProductVariant\//, ""));
  };

  return (
    <Page
      primaryAction={{ content: "Save", onAction: save, loading: saving }}
    >
      <TitleBar title="Settings" />
      <Layout>
        {result && !result.ok && (
          <Layout.Section><Banner tone="critical">{result.error}</Banner></Layout.Section>
        )}

        <Layout.AnnotatedSection
          title="The gift flow"
          description="What the storefront block offers. Change a value and the storefront picks it up on the next page load — no theme edit."
        >
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <Box width="100%">
                  <TextField
                    label="Gift collection handle" value={v.giftCollectionHandle}
                    onChange={set("giftCollectionHandle")} autoComplete="off"
                    helpText="Products the customer chooses from. The block's own collection setting overrides this."
                  />
                </Box>
                <Button onClick={pickCollection}>Browse</Button>
              </InlineStack>
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <Box width="100%">
                  <TextField
                    label="Card product variant ID" value={v.cardVariantId}
                    onChange={set("cardVariantId")} autoComplete="off"
                    helpText="Added to the cart to charge for the card. Leave empty for free cards."
                  />
                </Box>
                <Button onClick={pickVariant}>Browse</Button>
              </InlineStack>
              <TextField
                label="Card price shown in the flow" type="number" step={0.01}
                value={v.cardPrice} onChange={set("cardPrice")} autoComplete="off"
                helpText="Display only. The charge itself comes from the variant's price."
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Message and uploads"
          description="Limits are enforced on the server, so they cannot be bypassed from the browser."
        >
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Message character limit" type="number"
                value={v.messageMaxChars} onChange={set("messageMaxChars")} autoComplete="off"
              />
              <Checkbox
                label="Let customers upload their own card image"
                checked={v.allowUploads} onChange={set("allowUploads")}
                helpText="Included in paid plans."
              />
              {v.allowUploads && (
                <Box paddingInlineStart="600">
                  <BlockStack gap="300">
                    <Checkbox
                      label="Hold uploads for my approval before printing"
                      helpText="Strongly recommended. Someone will eventually upload something you do not want to print."
                      checked={v.moderateUploads} onChange={set("moderateUploads")}
                    />
                    <TextField
                      label="Maximum upload size" type="number" suffix="MB"
                      value={v.maxUploadMb} onChange={set("maxUploadMb")} autoComplete="off"
                    />
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Print"
          description="Match these to the card stock you actually print on. Changing them re-renders cards at the new size the next time they are printed."
        >
          <Card>
            <BlockStack gap="400">
              <Select
                label="Card size" options={SIZES} value={sizeValue}
                onChange={(val) => {
                  if (val === "custom") return;
                  const [w, h] = val.split("x");
                  setV((s) => ({ ...s, pdfWidthMm: w, pdfHeightMm: h }));
                }}
              />
              <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                <TextField label="Width" type="number" step={0.1} suffix="mm"
                  value={v.pdfWidthMm} onChange={set("pdfWidthMm")} autoComplete="off" />
                <TextField label="Height" type="number" step={0.1} suffix="mm"
                  value={v.pdfHeightMm} onChange={set("pdfHeightMm")} autoComplete="off" />
                <TextField label="Bleed" type="number" step={0.1} suffix="mm"
                  value={v.pdfBleedMm} onChange={set("pdfBleedMm")} autoComplete="off" />
              </InlineGrid>
              <Select
                label="Layout"
                value={v.pdfLayout}
                onChange={set("pdfLayout")}
                options={[
                  { label: "Message printed on the card artwork (1 page)", value: "overlay" },
                  { label: "Artwork, then message on a second page (duplex or folded)", value: "two-sided" },
                  { label: "Message only — I print on pre-printed cards", value: "message-only" },
                ]}
              />
              <Checkbox
                label="Add crop marks and the order number in the bleed"
                checked={v.pdfCropMarks} onChange={set("pdfCropMarks")}
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Order line"
          description="One readable property is kept on the order so gift lines are obvious on packing slips even without this app."
        >
          <Card>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField label="Property name" value={v.visiblePropertyName}
                onChange={set("visiblePropertyName")} autoComplete="off" />
              <TextField label="Property value" value={v.visiblePropertyValue}
                onChange={set("visiblePropertyValue")} autoComplete="off" />
            </InlineGrid>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Staff print dashboard"
          description="Lets warehouse staff print cards from the GiftFlow Dashboard without access to your Shopify admin."
        >
          <Card>
            <BlockStack gap="400">
              {result && "newKey" in result && result.newKey ? (
                <Banner tone="success" title="Copy this key now — it won't be shown again">
                  <BlockStack gap="200">
                    <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                      <Text as="p" fontWeight="semibold" breakWord>{result.newKey}</Text>
                    </Box>
                    <Text as="p" variant="bodySm">
                      {`In the dashboard's .env set GIFTFLOW_URL=${appUrl} and GIFTFLOW_API_KEY to this key.`}
                    </Text>
                  </BlockStack>
                </Banner>
              ) : staffKey ? (
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Active</Badge>
                  <Text as="span" variant="bodySm">
                    {`${staffKey.hint}${staffKey.createdAt ? ` · created ${new Date(staffKey.createdAt).toLocaleDateString()}` : ""}`}
                  </Text>
                </InlineStack>
              ) : (
                <Text as="p" tone="subdued">No key yet. The dashboard cannot connect until you create one.</Text>
              )}
              <InlineStack gap="200">
                <Button onClick={() => submit({ intent: "generate-key" }, { method: "post" })}>
                  {staffKey ? "Replace key" : "Create key"}
                </Button>
                {staffKey && (
                  <Button tone="critical" variant="plain"
                    onClick={() => submit({ intent: "revoke-key" }, { method: "post" })}>
                    Revoke
                  </Button>
                )}
              </InlineStack>
              {staffKey && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Replacing or revoking the key disconnects every dashboard using the old one immediately.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={save} loading={saving}>Save</Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
