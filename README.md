# GiftFlow

A Shopify app for gift flows: the customer picks a gift, picks a card, writes a
message, and the merchant prints the card from the admin.

Built from the Slikekspressen theme flow, but nothing about that store is baked
in — every variant ID, collection handle and API endpoint the theme hardcoded is
a merchant setting or comes from this app.

## How it fits together

```
theme app extension  ──app proxy──▶  this app  ──▶  SQLite (Postgres later)
  (storefront flow)   /apps/giftflow                      │
        │                                                 │
        └── _gift_token ──▶ cart ──▶ order ──webhook──────┘
                                                          │
                                        admin ──▶ PDF ──▶ printer
```

The storefront never touches the database. It calls three proxy endpoints:

| Endpoint | Does |
|---|---|
| `GET /apps/giftflow/cards` | Card catalogue, categories and public settings |
| `POST /apps/giftflow/uploads` | Customer image, checked by magic bytes, not Content-Type |
| `POST /apps/giftflow/drafts` | Stores card + message, returns the token |

**Only a token reaches the cart.** The card and message stay here against it.
That keeps line items small, lets the message be sanitized server-side, makes
the data deletable on `customers/redact`, and stops a customer editing cart
properties into a free card. One readable property (`Gift kort: Ja` by default)
is kept so gift lines are obvious on packing slips without the app.

## Running it

```bash
npm install
cp .env.example .env          # then fill in GIFT_TOKEN_SECRET
openssl rand -hex 32          # ← use this for GIFT_TOKEN_SECRET

npm run config:link           # creates/links the app in the Partner Dashboard
npm run db:push               # creates prisma/dev.db
npm run seed -- your-store.myshopify.com   # optional: the card categories
npm run dev
```

Then in the theme editor, add the **GiftFlow** block to a page and pick the gift
collection in the block settings.

Printing needs a Chromium binary for `playwright-core`:

```bash
npx playwright install chromium
```

## What is deliberately not here

**The candy mixer.** The old flow's step 3 drives `blandSelvSlik.js`,
`visualCandyBag.js` and `createItemsArray.js`, and reads the bag by scraping DOM
the theme renders. An app block cannot scrape theme DOM it does not own, so it
is a rebuild rather than a port — and it roughly doubles the first release for
the part of the flow that is not what people would pay for. The plan puts it in
phase 5, only if merchants ask.

**Billing.** No charge is made yet. Add the Billing API before submission.

**Object storage.** `app/lib/storage.server.ts` writes to local disk, behind
three functions so the swap is a change there and nowhere else. Rows store keys,
never URLs, precisely so that swap costs no migration.

## Before this serves real traffic

- `GIFT_TOKEN_SECRET` must be set, and must not change once tokens are in live
  carts — rotating it invalidates every draft.
- Swap the Prisma provider to `postgresql`. The schema is written to survive
  that with no other change: no enums, no scalar lists, no native types. Both
  variants are validated.
- Bundle a colour emoji font and name it in `app/lib/pdf.server.ts`. The message
  editor has an emoji picker; without one, emoji print as empty boxes.
- Turn on upload moderation, or accept that someone will eventually upload
  something you do not want to print.
