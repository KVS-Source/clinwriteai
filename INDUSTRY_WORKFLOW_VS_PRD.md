# Clinical Document Authoring (Protocol): Industry Workflow vs Our PRD

**Scope:** research and documentation only. No code was read or changed.
**PRD used (comparison table only):** `docs/PRD_A_Clinical_Writing_v0_4.md`
**Prepared:** 2026-11-09

## How to read the labels in this document

| Label | Meaning |
|---|---|
| **[Standard]** | Written in a regulation or guideline. The source is cited. |
| **[Common practice]** | Widely done, but it **varies by company**. Not a rule. |
| **[My suggestion]** | My own recommendation for a product like ours. Not an industry fact. |
| **[Unclear]** | I could not confirm it from sources. Check before relying on it. |

**Honest limits of the research.** Many search results were secondary sources (vendor blogs, training sites). I did **not** read the full text of ICH E6(R3), ICH M11 or the new EU Annex 11 draft. I could not find AMWA-specific guidance on CRM or sign-off, only EMWA. I did not find Veeva documentation confirming version numbers (0.1 → 1.0). Most workflow detail below (stage durations, who signs, section vs document sign-off) is **common practice**, not regulation. Regulations say very little about *how* a protocol is written. They mainly say *what the signature and audit trail must contain*.

---

## A. Roles and responsibilities

Titles differ between companies. This is a typical set **[Common practice]**.

| Role | What they do | Typical sign-off |
|---|---|---|
| **Lead Medical Writer / Author** (document owner) | Plans the timeline, runs kickoff, drafts, merges all comments, runs the CRM, owns the document until approval. | Signs as *Author* |
| **Contributing authors / SMEs** (clinical scientist, biostatistician, pharmacologist) | Write or supply specific sections (e.g. statistician writes the statistics section). | Often sign as *Author* of their section, or only review |
| **Reviewers** (clinical, biostatistics, regulatory, safety/PV, clinical operations, data management, CMC, legal) | Review the sections in their area and give comments. | Usually no signature, or *Reviewed* |
| **Approvers / Signatories** (Clinical lead, Biostatistician, Medical Monitor, Head of Development or Sponsor representative) | Confirm the document is scientifically and ethically fit and agree to it. | Sign as *Approved* |
| **QC reviewer** | Checks accuracy: consistency, references, template compliance, formatting. Not the science. | Sometimes records QC completion |
| **Document Control / Admin** | Manages the template, version numbers, storage, and the effective and superseded status. | None, or a release step |
| **CRM facilitator / chair** | Runs the Comment Resolution Meeting. Often the lead writer, sometimes the clinical lead. | None |

Source support: EMWA describes the flow draft → peer review → comment-resolution meeting → approval by the review team → sponsor-representative signature, and a medical-writer-led, multifunctional team ([EMWA Medical Writing, peer review of a clinical trial protocol](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf); [EMWA PTF22](https://emwa.org/product/ptf22-managing-the-clinical-study-protcol-writing-process/)). The exact list of roles per company is **common practice, varies**.

---

## B. End-to-end stage flow for a Protocol

The stage list is **[Common practice]**, built around the EMWA flow above. Durations are typical ranges seen in practice and are **[Unclear]**. I found no authoritative source for them, so treat them as rough.

```
 KICKOFF -> INPUTS -> DRAFT (0.x) -> WRITER/QC CHECK -> REVIEW ROUND(S)
   (Lead)   (Lead+     (Authors)      (Lead + QC)       (Reviewers)
            SMEs)
                                                              |
                                                              v
 DISTRIBUTE <- FINALISE <- E-SIGN <- FINAL REVIEW/QC <- REVISE <- CRM
 (Doc Ctrl)   (Doc Ctrl)  (Author,   (QC + Lead)       (Authors)  (Chair,
                           Reviewer?,                              Authors,
                           Approvers)                              Reviewers)
                                |
                                v
                  later change -> AMENDMENT (new version, same loop)
```

### B1. Kickoff and planning
- **Purpose:** agree scope, template, timeline, who writes and reviews what.
- **Who:** Lead writer, clinical lead, biostatistics, regulatory, other functions.
- **Responsibilities:** set the review timeline, assign sections, name approvers, agree the study design basics.
- **Inputs:** study concept/synopsis, template (increasingly the ICH M11 structured template).
- **Outputs:** timeline, author/reviewer/approver list, section-ownership plan.
- **Entry:** study concept or synopsis approved.
- **Exit:** team and timeline agreed.
- **Duration:** days to 1 week **[Unclear]**.
- Source: kickoff is described by [EMWA](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf).

### B2. Source and input gathering
- **Purpose:** make sure the writer has everything needed.
- **Who:** Lead writer and SMEs.
- **Inputs:** synopsis, SAP draft or statistical input, investigator brochure, prior protocols, template.
- **Outputs:** confirmed input pack.
- **Entry:** kickoff done. **Exit:** required inputs received.
- **Duration:** days to weeks **[Unclear]**.
- **Note on template:** ICH M11 (CeSHarP) is the harmonised protocol template plus a technical specification. The sources found say it is finalised and implementation is under way, with EMA and FDA dates cited ([GMP-Compliance](https://www.gmp-compliance.org/gmp-news/final-ich-m11-cesharp-guideline); [EMA template](https://www.ema.europa.eu/en/documents/template-form/ich-m11-clinical-electronic-structured-harmonised-protocol-cesharp-template-step-5_en.pdf)). The sources disagree on the adoption and effective dates (19 Nov 2025 vs 11 Dec 2025 / 11 June 2026), so verify against ICH/EMA directly.

### B3. Drafting
- **Purpose:** produce the first full draft.
- **Who:** Lead writer plus contributing authors for their sections.
- **Responsibilities:** write to the template, keep sections consistent with each other and with the synopsis.
- **Outputs:** Draft v0.x. **Entry:** inputs ready. **Exit:** draft complete and consistent.
- **Duration:** about 1 to 3 weeks **[Unclear]**.

### B4. Writer/QC check
- **Purpose:** catch errors before many people spend time reviewing.
- **Who:** Lead writer, optionally QC.
- **Outputs:** cleaned draft ready for distribution. **Exit:** draft is "review-ready".
- **Note:** whether QC happens here, after CRM, or both **varies by company**.

### B5. Cross-functional review round(s)
- **Purpose:** get expert input from every function.
- **Who:** Reviewers (clinical, biostats, regulatory, safety, ops, data management and others).
- **Responsibilities:** comment within the review window on their areas. Comments should say what to change and why.
- **Inputs:** frozen review draft. **Outputs:** consolidated comments.
- **Entry:** draft frozen and distributed. **Exit:** review deadline reached.
- **Duration:** typically about 1 week per round **[Unclear]**.
- Source: EMWA stresses that weak peer review leads to amendments, delays and cost ([EMWA](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf)).

### B6. Comment Resolution Meeting (CRM)
- **Purpose:** settle conflicting or unclear comments in one session instead of by email.
- **Who:** Chair/facilitator, Lead writer, key reviewers, clinical lead, other decision makers.
- **Responsibilities:** for each comment, record a **disposition**: accept, reject (with reason), or modify. Escalate conflicts to the decision owner.
- **Inputs:** consolidated comments with proposed responses. **Outputs:** resolution log with a decision for every comment.
- **Entry:** review round closed and comments consolidated. **Exit:** every comment has a recorded disposition.
- **Duration:** 1 to 2 hours, sometimes several sessions **[Unclear]**.
- Source: CRM is the step between review and approval in the [EMWA flow](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf). A [DIA 2015 session](https://www.diaglobal.org/en/conference-listing/meetings/2015/06/dia-2015-51st-annual-meeting-develop-innovate-advance/agendas/leadership-and-process-in-medical-writing) lists CRMs as a topic. Disposition options and the "who decides" rules are **[Common practice]**. I found no regulation that defines them.

### B7. Revision
- **Purpose:** apply the agreed decisions.
- **Who:** Lead writer and the section authors.
- **Outputs:** revised draft with a record of what changed. **Exit:** all accepted changes applied.
- **Duration:** days.

### B8. Final review and QC
- **Purpose:** confirm the changes were applied correctly and the document is internally consistent.
- **Who:** QC reviewer, Lead writer, sometimes the clinical lead.
- **Exit:** QC complete and no open comments.

### B9. Approval and e-signature
- **Purpose:** formal, attributable agreement.
- **Who:** Author (Lead), Approvers (and sometimes Reviewers).
- **Responsibilities:** each signer signs with a stated meaning. See section D.
- **Entry:** QC done, comments resolved, document frozen. **Exit:** all required signatures captured.
- **Duration:** days (depends on signers' availability).
- Source: sponsor-representative signature at the end, per [EMWA](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf).

### B10. Finalisation and version lock
- **Purpose:** make the signed content the official, unchangeable version.
- **Who:** Document Control or the Lead writer.
- **Outputs:** Final/Effective version, interim watermark removed, content locked.
- **Exit:** version released.

### B11. Distribution and submission
- **Who:** Regulatory, clinical operations. The protocol goes to sites, ethics committees/IRBs and regulators.
- **Note:** distribution rules depend on region and sponsor SOPs.

### B12. Later amendments
- **Purpose:** change an approved protocol.
- **Rule of thumb [Common practice]:** treat the amendment as a new version that goes through review, approval and signature again, with the changes summarised. Substantial amendments also need ethics/regulatory approval before use. The approval path depends on the jurisdiction, so I did not verify it here.

---

## C. Multi-person handling

All of this is **[Common practice]** unless stated.

- **Splitting sections:** the Lead writer assigns each section to an owner at kickoff. Subject experts own their sections (for example statistics). The Lead owns cross-section consistency.
- **Avoiding conflicts:** in Word-based work this is done by check-out and check-in or by the Lead merging contributions. In document-management systems (for example Veeva Vault) and collaborative editors it is done by locking. One editor per section at a time.
- **Parallel vs sequential review:**
  - *Parallel* is the usual default for the cross-functional review round. Everyone reviews the same frozen draft in the same window.
  - *Sequential* is used when a later reviewer must see an earlier reviewer's decision (for example a legal review after the science is settled), and for signing order when the company requires it.
- **Consolidating comments:** the Lead writer collects all comments into one log, groups duplicates and conflicts, and drafts proposed responses before the CRM.
- **CRM disposition:** accept, reject with reason, or modify. All dispositions are recorded.
- **Final decision on conflicts:** usually the **document owner's functional lead** (typically the clinical lead or Medical Monitor) decides. Where the dispute is about a safety or regulatory issue, the relevant functional head decides. This **varies by company** and normally comes from an SOP, not from regulation.

---

## D. Approval mechanics

### D1. Section-level vs document-level sign-off
- **Document-level signature** is the norm for the **final approval** of a protocol. The signer approves the whole document. **[Common practice, varies by company]**
- **Section-level** approval appears mainly in **review**: a specialist confirms their own section (for example the statistician confirms the statistics section). It is usually recorded as a review step or comment closure, not a formal signature. **[Common practice, varies by company]**
- Some companies do require a signature from the owner of a specific section (for example the biostatistician). This usually still happens as a document-level signature with a defined meaning. **[Unclear, I found no source.]**

### D2. Approve button vs formal e-signature
- **Intermediate steps** (reviewer "I have finished review", comment resolved) are normally workflow actions, often a button. **[Common practice]**
- **Final approval** of a controlled document is normally a **formal electronic signature** that meets Part 11 or Annex 11. **[Common practice]**, because those are the records an inspector may ask for.
- A button is only equivalent to a signature if the system meets the signature controls in D3. Whether an intermediate approval needs a full signature is a company risk decision.

### D3. What an e-signature must contain
- **[Standard]** 21 CFR 11.50: a signed electronic record shows the **printed name** of the signer, the **date and time**, and the **meaning** (such as review, approval, responsibility or authorship). These must be part of any human-readable form of the record ([21 CFR 11.50, Cornell LII](https://www.law.cornell.edu/cfr/text/21/11.50); [eCFR](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11/subpart-B/section-11.50)).
- **[Standard, from my own knowledge, not confirmed by my search]** 11.200 requires at least two distinct identification components (for example ID and password) for non-biometric signatures, and the signer must use both at the first signing in a session and at least one at later signings in the same session. 11.300 covers controls for IDs and passwords. **Check the eCFR text before quoting this.**
- **[Standard, secondary source]** EU Annex 11: electronic records may be signed electronically. Checklists expect name, date/time and meaning ([Annex 11 text](https://health.ec.europa.eu/system/files/2016-11/annex11_01-2011_en_0.pdf); [Scilife summary](https://www.scilife.io/blog/electronic-records-signatures-annex-11)). A revision is in draft. Check its current status with EMA/PIC/S.
- **[Common practice]** re-entering credentials at the moment of signing, a signature that is linked to a specific version (for example by document hash), and no signing on behalf of another person.

### D4. Signing order
- **Sequential** (Author → Reviewer → Approver) and **parallel** are both used. **[Common practice, varies by company.]** Sequential is common when each signer's *meaning* depends on the previous one.
- A typical rule: the **Author signs first** and the **final approver signs last**. **[Common practice]**

### D5. Reject, and changes after signing
- **Rejection [Common practice]:** the signer records a reason, the chain stops, the document goes back to the Author, and signatures already captured are cancelled or treated as void for that version.
- **Change after signing [Common practice, strongly consistent with Part 11 intent]:** the signed version is locked. Any change creates a **new version** that needs review and signatures again. Whether a *minor* change (typo) needs full re-approval depends on the company's SOP and risk assessment. **[Unclear]**
- A signature is tied to its record. The Part 11 principle is that signatures must be linked to their records so they cannot be copied to another record (11.70). **[From my own knowledge, not confirmed by the search.]**

---

## E. Dependency rules (who can proceed when)

**[Common practice]** with justification-based exceptions.

| Actor | Rule | Valid exception |
|---|---|---|
| Lead writer | Needs the kickoff done and inputs ready to start drafting. | Start drafting while some inputs are pending, with the gaps clearly marked. |
| Contributing author | Works on assigned sections of the draft. | None needed. |
| Reviewer | Needs a **frozen, review-ready draft**. Reviews should not happen on a moving draft. | Early review of a partial draft (for example the study design section) by agreement. |
| Reviewers among themselves | Parallel by default, no dependency. | Sequential where a later review depends on an earlier decision. |
| CRM | Needs the review round closed and comments consolidated. | Short urgent CRM before the round fully closes, documented. |
| Approver | Needs all comments dispositioned, revisions applied and QC done. | Expedited approval for urgent safety changes, with documented justification and follow-up QC. |
| Signer | Needs approvals complete and the document frozen. Signing order may require previous signers first. | Parallel signing where the SOP allows. |
| Document Control | Releases only after all required signatures. | None. |

---

## F. Statuses and versioning

All of this is **[Common practice]**. Company wording differs. I did not find an authoritative standard for version numbers.

- **Typical statuses:** Draft → In Review → (CRM) → Approved (or In Approval/Signature) → Final/Effective → Superseded or Withdrawn. Veeva Vault documents the idea of lifecycle states such as Draft, Review, Approved, Effective, with automatic movement of old versions to Superseded in some configurations ([Veeva Vault help](https://quality.veevavault.help/en/lr/5442/)). CRM is usually a *step inside* review, not a separate document status. **[Unclear, varies.]**
- **Version numbering:** many companies use **0.x for drafts** and **1.0 for the first approved version**, then 1.1/2.0 for later changes. **[Common practice. I could not confirm this from Veeva documentation.]**
- **When a version locks:** once it is sent for signature or signed, and at the latest when it becomes Final/Effective. Review drafts are often "frozen" when sent out so reviewers see stable text. **[Common practice]**

---

## G. Common pitfalls and compliance risks

**[Common practice and general GxP experience. Not from one source.]**

1. **Editing after approval** without creating a new version and re-approving.
2. **Signing with unresolved comments**, so the CRM decisions are not traceable.
3. **Missing audit trail** (no record of who changed what, when and why). Annex 11 expects a system audit trail with the reason for GMP-relevant changes and regular review ([Annex 11](https://health.ec.europa.eu/system/files/2016-11/annex11_01-2011_en_0.pdf)). ICH E6(R3) adds data-governance expectations including audit trails ([CT Toolkit summary](https://ct-toolkit.ac.uk/news/summary-key-changes-ich-e6-r3-guidelines)). This was read from secondary sources.
4. **Reviewing a moving draft**, so comments go out of date.
5. **Signature without meaning** (just a name and date).
6. **Shared logins or signing on behalf of someone.**
7. **Poor peer review** leading to avoidable protocol amendments ([EMWA](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf)).
8. **Unclear conflict ownership** at the CRM, so comments stay unresolved.

---

## Comparison table: industry practice vs our PRD (v0.4)

PRD references are to `docs/PRD_A_Clinical_Writing_v0_4.md`. "Industry standard" here mixes **[Standard]** and **[Common practice]**, which are marked.

| Area | Industry standard | Our PRD says | Gap / Match / Not defined | Severity | Recommendation |
|---|---|---|---|---|---|
| Roles and permission model | **[CP]** Author, Reviewer, Approver, QC, Document Control, CRM chair, Informed. | FR-A-040: role library (Clinical Writer, Clinical PM, Biostatistician, Data Manager, PV Lead, Regulatory Reviewer). FR-A-041: RACI auto-populated, only Admin edits it. No Approver/Signatory, QC or Document Control role. | **Gap** | Med | Define Approver, QC and Document Control roles and what each may do. Decide who may change RACI during a live review. |
| Section ownership | **[CP]** Each section has an owner. | FR-A-053: users lock the section they edit, presence shown, edit attributed per section. No assigned section *owner* is defined. | **Partial match** | Low | Decide whether sections have a named owner distinct from whoever is editing. |
| Review stages and gating | **[CP]** Reviewers get a frozen draft. Approvers need comments resolved and QC done. | FR-A-010: six-stage linear, stage-gated workflow, "cannot advance without approval by the designated role". Gate criteria per stage are not listed. | **Partial match** | High | List entry and exit criteria for each stage (frozen draft, comments resolved, QC done). |
| Parallel vs sequential review | **[CP]** Parallel by default, sequential by exception. | FR-A-042: owner selects parallel or sequential review mode. | **Match** | Low | Document the default and when to use each. |
| CRM process | **[CP]** Chair, consolidated comments, a disposition for each, escalation to a decision owner. | §7 calls CRM "a structured three-panel workflow". Data model has CRMMeeting and CRMResolution (resolution_type, note). No FR defines CRM steps, who chairs, or exit criteria. | **Gap, no FR** | High | Write FRs for CRM: who can start and chair it, attendee rules, completion criteria, what it changes in the document. |
| Comment resolution rules | **[CP]** Accept / reject with reason / modify. Every comment needs a disposition before approval. | FR-A-052: comments with section, severity (Major/Minor/Query), ID, author, time. Dispositions only appear as `resolution_type` in the data model. No rule that all comments must be closed before approval. | **Gap** | High | Define the disposition values and whether open Major comments block approval or signing. |
| Section-level vs document-level approval | **[CP, varies]** Document-level for final approval. Section-level mainly in review. | Not stated. FR-A-066 records "scope (sections attested)" per signature, which suggests partial scope is possible. | **Not defined in PRD** | Med | Decide: document-level signature only, or per-section attestation too. |
| E-signature requirements | **[Standard]** Name, date/time, meaning (21 CFR 11.50). Credentials at signing. | FR-A-062: explicit meaning chosen at signing. FR-A-063: fresh credentials at signing, no delegation. FR-A-066: detailed signature record. | **Match** | Low | Confirm the signature is visible in human-readable output (11.50(b)) such as the PDF export. |
| Signing order | **[CP]** Sequential or parallel. Author first, final approver last. | FR-A-066: sequential or parallel chain. Order rules (Author first etc.) not stated. | **Partial match** | Med | State the default order and any required order between roles. |
| Re-approval after changes | **[CP]** Change after sign-off means a new version and fresh review/approval. | Not defined. FR-A-029b says restoring creates a new version. FR-A-066 says a cancelled chain does not advance the document. Nothing on a change after signatures exist. | **Not defined in PRD** | High | Define what happens to existing signatures when a new version is created, and which changes need full re-approval. |
| Rejection handling | **[CP]** Reason recorded, chain stops, back to Author. | FR-A-066 covers cancelling a chain. Rejection by a signer, its reason and what state results are not described. | **Gap** | Med | Define rejection behaviour and where the document goes next. |
| Versioning and locking | **[CP]** 0.x drafts, 1.0 first approved, lock at signature. | FR-A-064: full version history. FR-A-011: interim versions watermarked, removed at final sign-off. FR-A-029b: new immutable versions. No numbering scheme and no rule for when a version locks. | **Partial match** | Med | Define numbering and the exact lock point (sent for signature vs fully signed). |
| Statuses | **[CP]** Draft, In Review, Approved, Final/Effective, Superseded/Withdrawn. | Document has a status and stage field (data model) but its values are not listed. Project statuses are listed (Initiated / Ongoing / On Hold / Closed). | **Not defined in PRD** | Med | List document statuses and the allowed transitions. |
| Audit trail | **[Standard]** Who, what, when, and reason for changes. Reviewed regularly (Annex 11). | FR-A-060 append-only, FR-A-061 full entry fields, FR-A-065a overdue-review alert. | **Match** | Low | None needed. Check that "reason for change" is captured on edits. |
| Dependency / gating between stages | **[CP]** Earlier stage complete before the next, with documented exceptions. | FR-A-010 gives linear gating. Exceptions (parallel start, expedited path) are not defined. | **Partial match** | Med | Decide whether exceptions are allowed and who authorises them. |
| Amendments | **[CP]** New version through review and approval again. Substantial amendments need external approval. | Protocol amendments are a deliverable type (§2.1, FR-A-001). FR-A-010 stage flow assumes new documents. No amendment workflow, change summary, or relationship between versions. | **Not defined in PRD** | Med | Define an amendment flow with a change summary and which stages repeat. |
| Template (ICH M11) | **[Standard, newly adopted]** Structured protocol template and technical specification. | ICH M11 is **not** in the §10 framework registry. ICH E6(R3) is listed as "Draft 2023", but the sources I found say the final text was published in January 2025. | **Gap** | Med | Add ICH M11 to the registry and update E6(R3) to final. Verify dates against ICH and the regulators first. |

**Abbreviation:** CP = common practice (varies by company).

### Top 5 gaps sir should decide on

1. **CRM is not specified as a process.** The PRD calls it a differentiator but defines no steps, chair, dispositions or exit rule. (High)
2. **Comment closure vs approval/signing.** Must all comments (or all Major comments) be resolved before approval or signing starts? Not defined. (High)
3. **What happens to signatures when the document changes** after signing or during a signature chain: new version, which signatures survive, who re-approves. (High)
4. **Gate criteria for each of the six stages** (frozen draft, QC done, comments closed). FR-A-010 names the gating but not the conditions. (High)
5. **Roles and sign-off model:** Approver, QC and Document Control roles are missing, and the PRD does not say whether approval is document-level only or also section-level. (Med to High)

Also worth a decision, lower priority: document statuses and version numbering, rejection behaviour, an amendment flow, and adding ICH M11 and the final E6(R3) to the framework registry.

---

## Sources

- [21 CFR 11.50, Cornell LII](https://www.law.cornell.edu/cfr/text/21/11.50) and [eCFR 11.50](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11/subpart-B/section-11.50): signature manifestations (name, date/time, meaning).
- [EU GMP Annex 11 (2011) text](https://health.ec.europa.eu/system/files/2016-11/annex11_01-2011_en_0.pdf): audit trail, electronic signatures. See also the [Scilife Annex 11 summary](https://www.scilife.io/blog/electronic-records-signatures-annex-11) (secondary source).
- [EMWA, Peer review of a clinical trial protocol (Medical Writing, 2023)](https://journal.emwa.org/clinical-trials/peer-review-of-a-clinical-trial-protocol-practical-tips-for-regulatory-medical-writers-clinicians-and-clinical-scientists/article/13765/peer-review-of-a-clinical-trial-protocol.pdf): review → CRM → approval → sponsor signature flow.
- [EMWA PTF22, Managing the clinical study protocol writing process](https://emwa.org/product/ptf22-managing-the-clinical-study-protcol-writing-process/).
- [DIA 2015, Leadership and process in medical writing](https://www.diaglobal.org/en/conference-listing/meetings/2015/06/dia-2015-51st-annual-meeting-develop-innovate-advance/agendas/leadership-and-process-in-medical-writing): CRM as a topic (agenda only, older).
- [GMP-Compliance, Final ICH M11 CeSHarP guideline](https://www.gmp-compliance.org/gmp-news/final-ich-m11-cesharp-guideline) (secondary) and the [EMA ICH M11 template (Step 5)](https://www.ema.europa.eu/en/documents/template-form/ich-m11-clinical-electronic-structured-harmonised-protocol-cesharp-template-step-5_en.pdf).
- [CT Toolkit, Key changes in ICH E6 (R3)](https://ct-toolkit.ac.uk/news/summary-key-changes-ich-e6-r3-guidelines) (secondary): data governance and audit trails.
- [Veeva Vault help, document lifecycle states](https://quality.veevavault.help/en/lr/5442/): Draft / Review / Approved / Effective / Superseded.
- Project file: `docs/PRD_A_Clinical_Writing_v0_4.md` (comparison table only).

**Not covered by any source I could confirm:** TransCelerate guidance details, AMWA guidance, 21 CFR 11.70 and 11.200 / 11.300 wording (marked as my own knowledge above), Documentum practice, stage durations, version-number conventions, and the exact ICH E3 role of protocols (E3 is about study reports, not protocols).
