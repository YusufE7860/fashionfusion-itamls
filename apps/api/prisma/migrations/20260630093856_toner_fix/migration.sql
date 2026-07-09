-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "entity" TEXT NOT NULL DEFAULT 'FASHION_FUSION';

-- CreateTable
CREATE TABLE "TonerType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT 'HP',
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "vatPct" INTEGER NOT NULL DEFAULT 15,
    "hqStock" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TonerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TonerPlan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tonerTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "jan" INTEGER NOT NULL DEFAULT 0,
    "feb" INTEGER NOT NULL DEFAULT 0,
    "mar" INTEGER NOT NULL DEFAULT 0,
    "apr" INTEGER NOT NULL DEFAULT 0,
    "may" INTEGER NOT NULL DEFAULT 0,
    "jun" INTEGER NOT NULL DEFAULT 0,
    "jul" INTEGER NOT NULL DEFAULT 0,
    "aug" INTEGER NOT NULL DEFAULT 0,
    "sep" INTEGER NOT NULL DEFAULT 0,
    "oct" INTEGER NOT NULL DEFAULT 0,
    "nov" INTEGER NOT NULL DEFAULT 0,
    "dec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TonerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TonerOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TonerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TonerOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tonerTypeId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "dispatchedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "courier" TEXT,
    "trackingNo" TEXT,
    "boxNumbers" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "signedBy" TEXT,
    "signatureUrl" TEXT,

    CONSTRAINT "TonerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TonerType_code_key" ON "TonerType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TonerPlan_storeId_tonerTypeId_year_key" ON "TonerPlan"("storeId", "tonerTypeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "TonerOrder_code_key" ON "TonerOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TonerOrderLine_orderId_storeId_tonerTypeId_key" ON "TonerOrderLine"("orderId", "storeId", "tonerTypeId");

-- AddForeignKey
ALTER TABLE "TonerPlan" ADD CONSTRAINT "TonerPlan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TonerPlan" ADD CONSTRAINT "TonerPlan_tonerTypeId_fkey" FOREIGN KEY ("tonerTypeId") REFERENCES "TonerType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TonerOrderLine" ADD CONSTRAINT "TonerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TonerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TonerOrderLine" ADD CONSTRAINT "TonerOrderLine_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TonerOrderLine" ADD CONSTRAINT "TonerOrderLine_tonerTypeId_fkey" FOREIGN KEY ("tonerTypeId") REFERENCES "TonerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
