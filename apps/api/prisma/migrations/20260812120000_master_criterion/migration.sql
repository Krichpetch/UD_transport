-- CreateTable
CREATE TABLE "MasterCriterion" (
    "id" TEXT NOT NULL,
    "labelTh" TEXT NOT NULL,
    "answerType" TEXT,
    "measurements" JSONB,
    "guidance" JSONB,
    "imageKeys" TEXT[],
    "lawRefs" TEXT[],
    "cabinetResolution" BOOLEAN,
    "beyondLaw" BOOLEAN,
    "facilityCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "MasterCriterion_pkey" PRIMARY KEY ("id")
);
