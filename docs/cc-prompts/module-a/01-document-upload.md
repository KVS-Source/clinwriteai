# CD prompt — Document Upload / Auto-Classification screen

## What to design

A single screen that lets a user drop a PDF or DOCX into Clinical
Writing and the system auto-classifies it as a CSR / Protocol / IB /
ICF / DSUR before creating the real document row. Three progressive
states on one page:

1. **Dropzone** — initial state, no file yet.
2. **Classifying** — file uploaded, waiting for the stub classifier
   response (deterministic in dev, Anthropic in prod).
3. **Review + confirm** — classifier returned; user sees proposed
   fields with confidence badges and can override before confirming.

Route: `/projects/{projectId}/clinical-writing/classify`

Brand: Clinical Writing surfaces. Match sA-07 "Add new document" look
and the overall Module A chrome.

## Behaviour

- Dropzone accepts drag-and-drop OR click-to-browse. Max 50 MB. Types:
  PDF, DOCX (and the older DOC). File picker filter the file by MIME.
- Shows a progress bar during upload (POST
  `/projects/{projectId}/documents/upload`, multipart).
- On classifier response, flips to review state:
  - Document type (CSR Full / CSR Synopsis / Protocol / IB / ICF /
    DSUR / ...) as a radio group with the proposed one pre-selected;
    confidence badge next to the pre-selected ("85% confident").
  - Study title — text input, pre-filled from classifier (often "(unidentified — human review)" at low confidence; UI should prompt for input in that case).
  - Version — text input, pre-filled.
  - Therapeutic area — dropdown, defaults to "(inherit from project)".
  - Assignee — user picker.
  - Frameworks applied — tag chips, read-only ("ICH E6(R3)" etc.).
- Each field has an "AI override" indicator — small chip reading
  "AI pick" when the user hasn't touched it, "edited" if they changed it.
- CTA: **Confirm & create document** (primary), **Cancel upload**
  (secondary; deletes the upload row).
- A "classifier is in stub mode" banner at the top when
  `classifierResult.stub === true` — reads: "AI classifier not yet
  live — fields are filename-based guesses. Review carefully."

## Data wiring (for engineering)

- `POST /projects/{projectId}/documents/upload` returns:
  ```json
  {
    "uploadId": "upl-...",
    "classification": {
      "documentType": "csr_full",
      "typeConfidence": 85,
      "studyTitle": "...",
      "studyConfidence": 20,
      "version": "v1.0",
      "versionConfidence": 85,
      "therapeuticArea": "(inherit from project)",
      "taConfidence": 0,
      "frameworks": ["ICH E6(R3)"],
      "stub": true
    }
  }
  ```
- `POST /projects/{projectId}/documents/confirm-classification` body:
  ```json
  {
    "uploadId": "upl-...",
    "documentType": "csr_full",
    "title": "...",
    "version": "v1.0",
    "therapeuticArea": "Oncology",
    "assigneeId": "user-...",
    "overrides": ["documentType", "title"]   // field names the user changed
  }
  ```
  Returns the newly-created `Document`. Navigate to its editor on success.

## Keep as `{{ }}` template variables

- Classifier confidence percentages
- Studies / titles / version strings
- Assignee list (populate from `/admin/users`)
- Confidence badge colours (use the existing green ≥80 / amber 50-79 / red <50 rule)

## Deliverable

One standalone React component file + a demo HTML, matching the
convention in `docs/A/CC/sA-07-add-new-document.html`.
