-- CreateTable
CREATE TABLE "DepreciationRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDepreciationCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DepreciationRun_pkey" PRIMARY KEY ("id")
);
