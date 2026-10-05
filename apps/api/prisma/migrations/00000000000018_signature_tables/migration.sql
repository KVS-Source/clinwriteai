-- Module A E-Signature chain — Part 11 compliant signature chain + records (data model §9).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "signature_chains" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chainType" TEXT NOT NULL DEFAULT 'sequential',
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "initiatedBy" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "signature_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_records" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "meaning" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "scopeSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documentHash" TEXT,
    "versionAtSigning" TEXT,
    "credentialHash" TEXT,
    "timestampUtc" TIMESTAMP(3),
    "localTime" TEXT,
    "timeSource" TEXT,
    "authMethod" TEXT,
    "deviceInfo" TEXT,
    "networkInfo" TEXT,

    CONSTRAINT "signature_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signature_chains_documentId_idx" ON "signature_chains"("documentId");

-- CreateIndex
CREATE INDEX "signature_chains_status_idx" ON "signature_chains"("status");

-- CreateIndex
CREATE INDEX "signature_records_chainId_idx" ON "signature_records"("chainId");

-- CreateIndex
CREATE INDEX "signature_records_signerId_idx" ON "signature_records"("signerId");

-- CreateIndex
CREATE UNIQUE INDEX "signature_records_chainId_step_key" ON "signature_records"("chainId", "step");

-- AddForeignKey
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "signature_chains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
