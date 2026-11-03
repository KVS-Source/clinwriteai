# i18n pattern — ClinWrite.AI web

**Phase 1** (shipped 2026-11-03): UI chrome only (menus, buttons, labels,
toasts, help text). Document bodies, user input, and emails are NOT in
scope. See [memory/project_i18n_phase1.md] for the architectural
rationale.

## Where things live

| | Path |
|---|---|
| i18n init + language constants | [`apps/web/src/i18n/index.ts`](../apps/web/src/i18n/index.ts) |
| Provider mounted at root | [`apps/web/src/i18n/I18nProvider.tsx`](../apps/web/src/i18n/I18nProvider.tsx) |
| Language toggle UI | user-menu dropdown ([`apps/web/src/components/layout/TopNav.tsx`](../apps/web/src/components/layout/TopNav.tsx)) |
| Current / change hook | [`apps/web/src/i18n/useAppLanguage.ts`](../apps/web/src/i18n/useAppLanguage.ts) |
| Translation bundles | [`apps/web/src/i18n/en.json`](../apps/web/src/i18n/en.json) · [`apps/web/src/i18n/ja.json`](../apps/web/src/i18n/ja.json) |
| Dev-time translator | [`apps/web/scripts/translate-missing-keys.ts`](../apps/web/scripts/translate-missing-keys.ts) |

## Writing a screen (the one rule)

Every user-visible string wraps in `t(…)`:

```tsx
import { useTranslation } from 'react-i18next'

export function MyScreen() {
  const { t } = useTranslation()
  return (
    <div>
      <h1>{t('page.my_screen.title')}</h1>
      <button type="button">{t('button.save')}</button>
    </div>
  )
}
```

Then add the English key to `en.json`:

```json
{
  "page": {
    "my_screen": {
      "title": "My Screen"
    }
  }
}
```

Save the file. Run the translator to populate `ja.json`:

```
npm --workspace=apps/web run translate -- --target ja
```

Review the Japanese output in the diff. Commit both files together.

## Namespace conventions

| Namespace | For | Example |
|---|---|---|
| `button.*` | Reusable verbs | `button.save`, `button.cancel` |
| `nav.*` | Top-level navigation labels | `nav.projects`, `nav.clinical_writing` |
| `header.*` | Shell chrome | `header.sign_out`, `header.user_menu_label` |
| `toast.*` | Reusable toast titles / standard messages | `toast.saved`, `toast.something_went_wrong` |
| `status.*` | Short status words | `status.loading`, `status.saved` |
| `page.<screen>.*` | Everything else, scoped per screen | `page.sign_in.title`, `page.editor.save_hint` |

Reuse the shared vocab (`button.save`, `toast.error_title`, etc.) rather
than restating the same word under `page.*`. Easier to translate once,
guaranteed consistent across screens.

## What NOT to translate

- `data-testid` attribute values (test infrastructure)
- URL paths (`/projects`, `/sign-in`) and env-var references
- Enum values + machine-readable codes (`'in_progress'`, `'csr-full'`)
- Document / project / user titles authored by users
- Error messages re-thrown verbatim from caught `Error` exceptions
  (backend-authored; a separate backend-side i18n pass covers them)
- Email body templates (`apps/api/src/mailer/templates.ts` — out of
  Phase 1 scope)

## When the translator is wrong

Human review is non-negotiable. Open the diff, replace anything that
reads awkwardly, and commit. The script will NOT re-translate a key you
have already set — if `ja.json` has a value for `page.sign_in.title`,
subsequent runs skip it. That makes human corrections stick.

To force a re-translate of a specific key, delete that key from the
target JSON file first and re-run the script.

## Translator engines

| Engine | Env var | Where it fits |
|---|---|---|
| **Claude** (default for `ja` and non-Indian langs) | `ANTHROPIC_API_KEY` | Already configured for the AI drafter. Best medical/technical register. Short run cost. |
| **Google Translate** (opt-in via `--engine google`) | `GOOGLE_TRANSLATE_API_KEY` | Cheap + deterministic. Needs a Google Cloud project (free tier covers us). |
| **Bhashini** (default for all 22 Indian languages) | TBD when wired | Free Government of India platform. Stubbed until the first Indian customer signs. |

The script picks the engine from the target language code. To override
once, pass `--engine <name>`.

**API keys live on developer machines ONLY.** The web app bundle never
imports from `scripts/*` — translations are baked into the JSON files at
commit time. There is no runtime translator dependency.

## Pluralization

i18next supports native `_one` / `_other` suffixes via `count`:

```json
{
  "page.editor.sections_flagged_one": "{{count}} section flagged",
  "page.editor.sections_flagged_other": "{{count}} sections flagged"
}
```

```tsx
t('page.editor.sections_flagged', { count: n })
```

## Rich text with embedded tags

For strings that need markup inline, use the `<Trans>` component:

```tsx
import { Trans } from 'react-i18next'
<Trans i18nKey="page.gate.body" components={{ b: <strong /> }} />
```

```json
{ "page.gate.body": "<b>Accept the terms</b> to continue." }
```

## Rollout priority

Phase 1 pilots: AppShell / TopNav + SignIn.

After Phase 1 lands, pick up screens writer-first:

| Priority | Screens |
|---|---|
| **P1 writer path** | AllProjects, ProjectDashboard, ClinicalWritingHome, NewDocument wizard, DocumentEditor, SectionNavigator |
| **P2 reviewer path** | ReviewerView, CommentsPanel, SectionHistoryPanel, ESignature |
| **P3 admin** | UserManagement, TenantDetail, SsoConnectionConfig |
| **Skip for now** | Services dashboard, Rate Card, Audit Trail viewer, Best Practices admin |

## Checklist before merging a translated screen

- [ ] Every user-visible string wraps in `t(…)`
- [ ] Shared vocab reused where possible (`button.*`, `toast.*`, …)
- [ ] `data-testid` / enum values / env refs are untouched
- [ ] Pluralization uses `_one` / `_other` where counts appear in copy
- [ ] `npm --workspace=apps/web run translate -- --target ja` has been run
- [ ] JA output eyeballed for obvious nonsense; corrections committed
- [ ] `apps/web` builds clean
