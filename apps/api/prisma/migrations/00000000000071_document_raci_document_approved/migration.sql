-- An Approver's whole-document approval ("Approve document"), kept apart from approvedAt: a row that
-- requires a signature can't carry approvedAt without a signatureId (document_raci_signature_consistency),
-- so the approval could not be recorded there. Every approver having approved is what starts the
-- signature chain by itself. Cleared on a return to authoring, like the other completion marks.
ALTER TABLE "document_raci" ADD COLUMN "documentApprovedAt" TIMESTAMP(3);
