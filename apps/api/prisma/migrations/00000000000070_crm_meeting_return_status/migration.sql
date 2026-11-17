-- A CRM meeting can now be started while a document is still In Authoring. The meeting
-- remembers where the document was, so completing (or cancelling) it puts the document back
-- there instead of moving it on to signature. NULL = started from review (the original flow).
ALTER TABLE "crm_meetings" ADD COLUMN "returnToStatus" TEXT;
