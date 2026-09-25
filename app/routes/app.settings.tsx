import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Form } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, TextField, Checkbox, Button,
  InlineGrid, Banner, InlineStack, Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { settings } = await getSettings(session.shop);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);
  const f = await request.formData();

  const num = (k: string, fallback: number) => {
    const v = Number(f.get(k));
    return Number.isFinite(v) ? v : fallback;
  };

  await prisma.settings.update({
    where: { shopId: shop.id },
    data: {
      giftCollectionHandle: String(f.get("giftCollectionHandle") || "").trim() || null,
      cardVariantId: String(f.get("cardVariantId") || "").trim() || null,
      cardPriceMinor: Math.max(0, Math.round(num("cardPrice", 0) * 100)),
      messageMaxChars: Math.max(1, num("messageMaxChars", 300)),
      allowUploads: f.get("allowUploads") === "on",
      moderateUploads: f.get("moderateUploads") === "on",
      maxUploadBytes: Math.max(1, num("maxUploadMb", 5)) * 1024 * 1024,
      pdfWidthMm: num("pdfWidthMm", 105),
      pdfHeightMm: num("pdfHeightMm", 148),
      pdfBleedMm: num("pdfBleedMm", 3),
      pdfCropMarks: f.get("pdfCropMarks") === "on",
      visiblePropertyName: String(f.get("visiblePropertyName") || "Gift kort"),
      visiblePropertyValue: String(f.get("visiblePropertyValue") || "Ja"),
    },
  });

  return { ok: true };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";
  const [uploads, setUploads] = useState(settings.allowUploads);

  return (
    <Page>
      <TitleBar title="Settings" />
      <Form method="post">
        <Layout>
          <Layout.Section>
            <Banner tone="info">
              <Text as="p">
                Everything the old theme hardcoded lives here. Change a value and the
                storefront picks it up on the next page load — no theme edit.
              </Text>
            </Banner>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">The gift flow</Text>
                <TextField
                  label="Gift collection handle"
                  name="giftCollectionHandle"
                  defaultValue={settings.giftCollectionHandle ?? ""}
                  autoComplete="off"
                  helpText="Products the customer chooses from in step 1. The handle from the collection URL, for example gaveaesker."
                />
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField
                    label="Card product variant ID"
                    name="cardVariantId"
                    defaultValue={settings.cardVariantId ?? ""}
                    autoComplete="off"
                    helpText="Added to the cart to charge for the card."
                  />
                  <TextField
                    label="Card price"
                    name="cardPrice"
                    type="number"
                    step={0.01}
                    prefix="kr"
                    defaultValue={(settings.cardPriceMinor / 100).toFixed(2)}
                    autoComplete="off"
                    helpText="Shown in the flow. The charge itself comes from the variant."
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Message and uploads</Text>
                <TextField
                  label="Message character limit"
                  name="messageMaxChars"
                  type="number"
                  defaultValue={String(settings.messageMaxChars)}
                  autoComplete="off"
                  helpText="Counted on the server, so it cannot be bypassed from the browser."
                />
                <Checkbox
                  label="Let customers upload their own card image"
                  name="allowUploads"
                  checked={uploads}
                  onChange={setUploads}
                />
                {uploads && (
                  <Box paddingInlineStart="600">
                    <BlockStack gap="300">
                      <Checkbox
                        label="Hold uploads for my approval before printing"
                        name="moderateUploads"
                        helpText="Strongly recommended. Someone will eventually upload something you do not want to print."
                        defaultChecked={settings.moderateUploads}
                      />
                      <TextField
                        label="Maximum upload size"
                        name="maxUploadMb"
                        type="number"
                        suffix="MB"
                        defaultValue={String(Math.round(settings.maxUploadBytes / 1024 / 1024))}
                        autoComplete="off"
                      />
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Print</Text>
                <Text as="p" tone="subdued">
                  Defaults are A6 with 3 mm bleed. Match these to the card stock you
                  actually print on.
                </Text>
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <TextField label="Width" name="pdfWidthMm" type="number" step={0.1} suffix="mm"
                    defaultValue={String(settings.pdfWidthMm)} autoComplete="off" />
                  <TextField label="Height" name="pdfHeightMm" type="number" step={0.1} suffix="mm"
                    defaultValue={String(settings.pdfHeightMm)} autoComplete="off" />
                  <TextField label="Bleed" name="pdfBleedMm" type="number" step={0.1} suffix="mm"
                    defaultValue={String(settings.pdfBleedMm)} autoComplete="off" />
                </InlineGrid>
                <Checkbox label="Add crop marks" name="pdfCropMarks" defaultChecked={settings.pdfCropMarks} />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Order line</Text>
                <Text as="p" tone="subdued">
                  One readable property is kept on the order so gift lines are obvious on
                  packing slips even without this app. The card and message travel as a
                  token instead of as text.
                </Text>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField label="Property name" name="visiblePropertyName"
                    defaultValue={settings.visiblePropertyName} autoComplete="off" />
                  <TextField label="Property value" name="visiblePropertyValue"
                    defaultValue={settings.visiblePropertyValue} autoComplete="off" />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <InlineStack align="end">
              <Button submit variant="primary" loading={saving}>Save</Button>
            </InlineStack>
          </Layout.Section>
        </Layout>
      </Form>
    </Page>
  );
}
