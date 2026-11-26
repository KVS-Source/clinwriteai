# Policy packages

How GenBioCa changes the way ClinWrite drafts a document type on a customer's install without shipping code: a
**signed policy package** that the customer's tenant admin imports. Today a package carries **AI build plans**;
the format also has room for AI prompts, best-practice rules and checklists, which a later app version will apply.

This page is also the brief for GenBioCa's **license generator**, which is not built yet. Until it is,
`apps/api/scripts/sign-policy-package.ts` signs packages with the development key for local and demo testing.

## The flow

1. **Write and test the plan** at GenBioCa: edit the package folder (below) and import it on a local or demo install
   signed with the development key.
2. **Sign it** with the license generator, using the same private key that signs license keys. The output is one
   file, `<packageId>-v<version>.cwplan`.
3. **Send the file** to the customer's tenant admin.
4. **The tenant admin imports it**: Admin → Licensing → *Import a policy package* → choose the file → **Preview** →
   **Import**. Preview changes nothing; it shows what each document type's policy becomes, and any warnings.
5. **Effect**: each document type in the package gets a new policy version carrying the plan. Documents created from
   then on follow it; documents already created keep the policy version they were created with.

## Rules

| Rule | Why |
| --- | --- |
| **Signed, not encrypted.** The file is an RS256 JWT. | The signature proves it came from GenBioCa unchanged. Encrypting would not hide it: the server has to read it, and the plan is shown read-only on the policy screen. |
| **One file.** Plan and signature travel together. | Nothing can be mixed up or half-imported. |
| **Same key as the license.** Checked with the install's `LICENSE_PUBLIC_KEY` (development key when unset). | One trust root per install. |
| **Audience.** `audience.installIds` is `["*"]` (every customer) or a list of install ids. | One file for everyone today; per-customer plans later without a format change. The install id comes from the install's verified license. |
| **No downgrade by import.** A package whose `packageId` is already imported at the same or a higher `packageVersion` is refused. | To go back, reactivate an earlier policy version, which is still stored. |
| **All or nothing.** If any document type in the package can't be applied, nothing is. | A package is one decision. |
| **Template mismatch is a warning.** | Customers may adjust their templates. Template sections the plan doesn't place are drafted after the plan's stages, before the summary. |
| **No policy yet is fine.** Importing creates the document type's first policy version. | A plan can arrive before anyone writes a policy for that document type, so policies don't have to be pre-created. |
| **PMs can't edit the plan.** | It is set only by import. A PM's new policy version carries the plan forward. |
| **Audited.** `policy_package.imported` / `policy_package.import_failed`, plus `document_type_policy.build_plan_imported` per document type, with the file's SHA-256. | Part 11 trail of who changed drafting rules and with which file. |

## Package folder (what GenBioCa edits)

```
policy-packages/
  protocol-build-plan/
    package.json       the manifest
    build-plan.json    the Protocol build plan
```

`package.json`:

```json
{
  "packageId": "protocol-build-plan",
  "packageVersion": 1,
  "description": "Protocol AI build plan …",
  "audience": { "installIds": ["*"] },
  "contents": [ { "docType": "protocol", "buildPlan": "./build-plan.json" } ]
}
```

Raise `packageVersion` for every change you send out.

## Signed payload (what the license generator produces)

The JWT header is `{"alg":"RS256","typ":"JWT"}`. The payload:

| Claim | Value |
| --- | --- |
| `iss` | `genbioca-licensing` (same issuer as licenses) |
| `typ` | `clinwrite.policy-package`, which keeps a package and a license key from being mistaken for each other |
| `formatVersion` | `1`. An app refuses a newer format with "needs a newer version of the app". |
| `packageId`, `packageVersion` | From the manifest |
| `description` | Optional, shown in the preview |
| `iat` | Issued at, in seconds |
| `audience.installIds` | `["*"]` or install ids |
| `contents[]` | `{ docType, buildPlan?, aiPrompt?, bestPractice?, checklist? }`. Only `buildPlan` is applied by format 1 apps; anything else makes the preview say "can't import … yet". |

No `exp` is set, so packages don't expire. If one is set, it is enforced.

The reference implementation is `packagePayload()` and `signPayload()` in
`apps/api/src/modules/platform/policy-packages/sign.ts`. The license generator should produce byte-for-byte the same
structure. It must also check each build plan with the same rules (`parseBuildPlan`) before signing, so a bad plan
never leaves GenBioCa.

## Build plan format (`schemaVersion` 1)

Defined in `apps/api/src/modules/platform/policy-packages/build-plan.ts`. The worker follows it in
`apps/worker/src/jobs/build-plan.ts`.

| Field | Meaning |
| --- | --- |
| `docType`, `label` | Which document type, and a name shown on the policy screen |
| `stages[]` | `{ key, label, sections: [{ number, title }], rules? }`, drafted in this order, sections in the listed order. `rules.exampleWording`: example sources may supply standard wording. `rules.noNewFacts`: a summary that may only use facts from the sections it depends on. |
| `builtByCode[]` | `{ number, title, kind }`, sections code builds after drafting (today `references`). The AI doesn't draft them. |
| `dependsOn` | Section number → the section numbers it is given (their drafted text goes into its prompt), or `"*"` for every section drafted before it |
| `expectedSections[]` | `{ label, matchAny[] }`, sections a document of this type should have. A template without one gets a warning. |
| `rules.temperature` | Sampling temperature for every section, e.g. `0` |

Checked on import and before signing:
- every section is placed once;
- a section depends only on sections drafted before it;
- nothing depends on a code-built section;
- unknown fields and newer schema versions are refused.

Sections are named by template **number and title**. Main headings (a number with sub-sections, such as `4`) keep
the template heading and are never drafted. Template sections the plan doesn't place are drafted after its stages,
before the summary stage.

## Template warnings

The same comparison runs in three places:

- **Package preview** (Admin → Licensing).
- **Template Library:** once a parsed template has sections, it shows them against the document type's current plan.
- **API:** `GET /document-templates/:id/plan-check`.

Warnings cover:
- sections the plan expects but the template lacks, such as title page, signature page, abbreviations and table of contents;
- template sections the plan doesn't place;
- sections the plan names that the template doesn't have, or has under another title.

## Signing for local and demo testing

```bash
npx tsx apps/api/scripts/sign-policy-package.ts \
  --manifest policy-packages/protocol-build-plan/package.json \
  --out protocol-build-plan-v1.cwplan
```

This signs with the **development key**. Such a file imports only on installs without `LICENSE_PUBLIC_KEY` set. Pass
`--key private.pem` to sign with another key.
