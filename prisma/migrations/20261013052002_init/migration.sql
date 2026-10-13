-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "giftCollectionHandle" TEXT,
    "cardVariantId" TEXT,
    "cardPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "messageMaxChars" INTEGER NOT NULL DEFAULT 300,
    "allowUploads" BOOLEAN NOT NULL DEFAULT true,
    "moderateUploads" BOOLEAN NOT NULL DEFAULT false,
    "maxUploadBytes" INTEGER NOT NULL DEFAULT 5242880,
    "pdfWidthMm" REAL NOT NULL DEFAULT 105,
    "pdfHeightMm" REAL NOT NULL DEFAULT 148,
    "pdfBleedMm" REAL NOT NULL DEFAULT 3,
    "pdfCropMarks" BOOLEAN NOT NULL DEFAULT true,
    "pdfLayout" TEXT NOT NULL DEFAULT 'overlay',
    "visiblePropertyName" TEXT NOT NULL DEFAULT 'Gift kort',
    "visiblePropertyValue" TEXT NOT NULL DEFAULT 'Ja',
    "staffApiKeyHash" TEXT,
    "staffApiKeyHint" TEXT,
    "staffApiKeyCreatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'da',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CardCategory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardDesign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardDesign_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardDesign_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CardCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GiftDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "GiftDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GiftOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "lineItemId" TEXT NOT NULL,
    "orderedAt" DATETIME NOT NULL,
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
    "printedAt" DATETIME,
    "pdfKey" TEXT,
    "printJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GiftOrder_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "pdfKey" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
