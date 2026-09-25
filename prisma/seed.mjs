/**
 * Seeds the card categories the Slikekspressen flow uses today, so a fresh
 * install has the step-3 tabs rather than an empty screen. Card artwork is not
 * seeded: those files belong to the merchant and are uploaded in the admin.
 *
 *   npm run seed -- <shop-domain>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const domain = process.argv[2];

if (!domain) {
  console.error("Usage: npm run seed -- your-store.myshopify.com");
  process.exit(1);
}

const CATEGORIES = [
  { name: "Fødselsdag", handle: "fodselsdag", sortOrder: 1 },
  { name: "Tak", handle: "tak", sortOrder: 2 },
  { name: "Kærlighed", handle: "kaerlighed", sortOrder: 3 },
  { name: "Jul", handle: "jul", sortOrder: 4 },
  { name: "Andet", handle: "andet", sortOrder: 5 },
];

const shop = await prisma.shop.upsert({
  where: { domain },
  update: {},
  create: { domain, settings: { create: {} } },
});

for (const c of CATEGORIES) {
  await prisma.cardCategory.upsert({
    where: { shopId_handle: { shopId: shop.id, handle: c.handle } },
    update: { name: c.name, sortOrder: c.sortOrder },
    create: { ...c, shopId: shop.id },
  });
}

console.log(`Seeded ${CATEGORIES.length} categories for ${domain}`);
await prisma.$disconnect();
