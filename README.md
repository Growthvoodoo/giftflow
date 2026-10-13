# GiftFlow

A Shopify app for gift cards that actually get printed. The customer picks a
gift, picks a card (or uploads their own image) and writes a message; the
merchant prints a print-ready PDF — one card or a whole day's batch — from the
Shopify admin or from the separate staff dashboard (`../GiftFlow-Dashboard`).

Built from the Slikekspressen theme flow, but nothing about that store is baked
in: every variant ID, collection handle and API endpoint the theme hardcoded is
a merchant setting or comes from this app.

## How it fits together

```
theme app extension ──app proxy──▶ GiftFlow ──▶ SQLite (Postgres later)
  (storefront flow)   /apps/giftflow   │  ▲
        │                              │  └── staff API ◀── GiftFlow-Dashboard
        └── _gift_token ─▶ cart ─▶ order ──orders/create webhook──┘
                                       │
                         admin / dashboard ──▶ PDF (headless Chromium) ──▶ printer
```

**Only a token reaches the cart.** The card and message stay in the app
against it. That keeps line items small, lets the message be sanitized
server-side, makes the data deletable on `customers/redact`, and stops a
customer editing cart properties into a free card. One readable property
(`Gift kort: Ja` by default) is kept so gift lines show on packing slips.

| Area | Where |
|---|---|
| Storefront block | `extensions/giftflow` — products, card picker, upload, message, add to cart |
| Storefront API (app proxy) | `GET /apps/giftflow/cards`, `POST …/uploads`, `POST …/drafts` |
| Order intake | `webhooks.orders.create` — one card per token, snapshot of card + message |
| Admin | Home, Gift orders (print, approve, status), Cards, Settings, Plan |
| Staff API (for the dashboard) | `/api/staff/me`, `/orders`, `/orders/:id`, `/status`, `/moderate`, `/print` — Bearer key |
| Printing | `app/lib/pdf.server.ts` — trim, bleed, crop marks, order number in the slug, 3 layouts |
| Plans & billing | `app/lib/plans.ts` (prices/limits), `app/lib/billing.server.ts` |

## Running it locally

```bash
npm install
cp .env.example .env            # fill in GIFT_TOKEN_SECRET (openssl rand -hex 32)
npx prisma migrate deploy       # creates prisma/dev.db
npm run seed -- your-store.myshopify.com   # optional: the card categories
npm run dev                     # shopify app dev — tunnels and links the app
```

Then in the theme editor add the **GiftFlow** block to a page. Choose the gift
collection in the block (or under Settings in the app), add card designs under
**Cards**, and set the card variant under **Settings** if cards cost extra.

Printing needs Chromium. Locally: `npx playwright install chromium`. On a server,
install the distro's `chromium` and set `CHROMIUM_PATH=/usr/bin/chromium`.
Install a colour emoji font too (`fonts-noto-color-emoji` on Debian/Ubuntu),
or emoji in messages print as empty boxes.

## Printing

Gift orders → select cards → **Print**. The PDF opens in a new tab; print it at
**100% / actual size**. Rendered cards are cached, so a re-print is instant and
identical; changing the card size re-renders at the new size.

Layouts (Settings → Print): message on the artwork (1 page), artwork then
message (2 pages, for duplex or folded cards), or message only (for
pre-printed card stock).

Tabs: **To print** (printable now), **Needs approval** (customer uploads when
moderation is on), **On hold** (over the plan's monthly limit — released
automatically on upgrade), **Printed**, **Packed**, **All**.

## Staff print dashboard

For a warehouse PC that should not have Shopify admin access:

1. In the app: **Settings → Staff print dashboard → Create key**. Copy it.
2. Set up `../GiftFlow-Dashboard` (see its README) with this app's URL and the key.

Replacing or revoking the key disconnects every dashboard immediately.

## Plans

Defined in `app/lib/plans.ts` and charged through the Shopify Billing API
(test charges outside production). Limits are enforced on the server: monthly
gift orders, active card designs, batch printing and customer uploads.

For a private single-store install, set `GIFTFLOW_BILLING=off` — every shop
gets the top plan and nothing is charged.

## Before this serves real traffic

- `GIFT_TOKEN_SECRET` must be set and must not change once tokens are in live
  carts — rotating it invalidates every draft.
- Swap the Prisma provider to `postgresql` and run `prisma migrate dev` once to
  create a Postgres migration. The schema has no enums, scalar lists or native
  types, so nothing else changes.
- Uploaded images and PDFs are on local disk (`STORAGE_DIR`), behind three
  functions in `app/lib/storage.server.ts`. Move them to object storage before
  running more than one instance. Rows store keys, not URLs, so no migration.
- The upload rate limit is in memory, per instance.
- Install Chromium and an emoji font on the server (see above).
- Turn on upload moderation, or accept that someone will eventually upload
  something you do not want to print.

## Deliberately not here

**The candy mixer.** The old flow's mix-your-own step reads the bag by scraping
DOM the theme renders; an app block cannot do that, so it is a rebuild, not a
port. Planned for later, only if merchants ask.
