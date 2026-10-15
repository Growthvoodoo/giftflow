-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "giftCollectionHandle" TEXT,
    "cardVariantId" TEXT,
    "cardPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "messageMaxChars" INTEGER NOT NULL DEFAULT 300,
    "allowUploads" BOOLEAN NOT NULL DEFAULT true,
    "moderateUploads" BOOLEAN NOT NULL DEFAULT false,
    "maxUploadBytes" INTEGER NOT NULL DEFAULT 5242880,
    "pdfWidthMm" DOUBLE PRECISION NOT NULL DEFAULT 105,
    "pdfHeightMm" DOUBLE PRECISION NOT NULL DEFAULT 148,
    "pdfBleedMm" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "pdfCropMarks" BOOLEAN NOT NULL DEFAULT true,
    "pdfLayout" TEXT NOT NULL DEFAULT 'overlay',
    "visiblePropertyName" TEXT NOT NULL DEFAULT 'Gift kort',
    "visiblePropertyValue" TEXT NOT NULL DEFAULT 'Ja',
    "staffApiKeyHash" TEXT,
    "staffApiKeyHint" TEXT,
    "staffApiKeyCreatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardCategory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'da',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardDesign" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftDraft" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cardDesignId" TEXT,
    "uploadKey" TEXT,
    "uploadStatus" TEXT,
    "uploadHash" TEXT,
    "messageHtml" TEXT NOT NULL DEFAULT '',
    "messageText" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT,
    "sender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "lineItemId" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "cardTitle" TEXT,
    "cardImageKey" TEXT,
    "messageHtml" TEXT NOT NULL DEFAULT '',
    "messageText" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT,
    "sender" TEXT,
    "uploadStatus" TEXT,
    "uploadHash" TEXT,
    "overLimit" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'new',
    "printedAt" TIMESTAMP(3),
    "pdfKey" TEXT,
    "printJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "pdfKey" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shopId_key" ON "Settings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_staffApiKeyHash_key" ON "Settings"("staffApiKeyHash");

-- CreateIndex
CREATE INDEX "CardCategory_shopId_idx" ON "CardCategory"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCategory_shopId_handle_key" ON "CardCategory"("shopId", "handle");

-- CreateIndex
CREATE INDEX "CardDesign_shopId_active_idx" ON "CardDesign"("shopId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "GiftDraft_token_key" ON "GiftDraft"("token");

-- CreateIndex
CREATE INDEX "GiftDraft_shopId_expiresAt_idx" ON "GiftDraft"("shopId", "expiresAt");

-- CreateIndex
CREATE INDEX "GiftOrder_shopId_status_idx" ON "GiftOrder"("shopId", "status");

-- CreateIndex
CREATE INDEX "GiftOrder_shopId_orderedAt_idx" ON "GiftOrder"("shopId", "orderedAt");

-- CreateIndex
CREATE INDEX "GiftOrder_shopId_uploadHash_idx" ON "GiftOrder"("shopId", "uploadHash");

-- CreateIndex
CREATE UNIQUE INDEX "GiftOrder_shopId_lineItemId_key" ON "GiftOrder"("shopId", "lineItemId");

-- CreateIndex
CREATE INDEX "PrintJob_shopId_createdAt_idx" ON "PrintJob"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCategory" ADD CONSTRAINT "CardCategory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardDesign" ADD CONSTRAINT "CardDesign_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardDesign" ADD CONSTRAINT "CardDesign_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDraft" ADD CONSTRAINT "GiftDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftOrder" ADD CONSTRAINT "GiftOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftOrder" ADD CONSTRAINT "GiftOrder_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

