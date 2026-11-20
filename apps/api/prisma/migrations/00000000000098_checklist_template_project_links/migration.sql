-- One checklist template, many projects. A project checklist keeps its owning project in
-- checklist_templates."projectId"; each project that uses it (the owner included) gets a row here.
-- Projects without a row keep using the platform baseline.
CREATE TABLE "checklist_template_project_links" (
    "deliverableType" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerProjectId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checklist_template_project_links_pkey" PRIMARY KEY ("deliverableType", "projectId")
);

CREATE INDEX "checklist_template_project_links_deliverableType_ownerProjectId_idx"
    ON "checklist_template_project_links"("deliverableType", "ownerProjectId");

-- Every existing project override is used by its own project.
INSERT INTO "checklist_template_project_links" ("deliverableType", "projectId", "ownerProjectId", "createdBy")
SELECT REPLACE("deliverableType", '-', '_'), "projectId", "projectId", (ARRAY_AGG("createdBy" ORDER BY "version"))[1]
FROM "checklist_templates"
WHERE "projectId" IS NOT NULL
GROUP BY REPLACE("deliverableType", '-', '_'), "projectId"
ON CONFLICT DO NOTHING;
