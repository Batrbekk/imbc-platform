# Role-cabinet prototype (`src/prototype`)

A front-end-only demo layer: each role gets its own cabinet under `/proto/<role>/<screen>`, built on fictional data kept in this browser. It exists only in a build with `VITE_PROTOTYPE_CABINETS=true` (dev stand: `compose.azure.yaml`; local stand: `PROTOTYPE_CABINETS=true`). Without the flag, `dist` contains none of it: `router.tsx` and `app-shell.tsx` reach it only through `import()` behind a literal `import.meta.env.VITE_PROTOTYPE_CABINETS === "true"` (see `flag.ts` for why it is a literal there; `test/prototype-off.test.tsx` enforces it).

## Layout and ownership

| Path | What | Who changes it |
|---|---|---|
| `flag.ts`, `registry.ts`, `gate.tsx`, `menu.tsx` | flag, module registry, role gate, menu group | task 1 only |
| `store.ts`, `rules.ts`, `i18n.ts`, `labels.ts` | store, shared rules of section 4, dictionary helper, shared labels | task 1 only |
| `data/*.ts` | data sets, one file each, type next to data | task 1 only |
| `components/*` | `ProtoPage`, badges, `RequestThread`, `FileRow`, `ConfirmAction` | task 1 only |
| `<role>/**` | one role module (`manufacturer`, `expert`, `administrator`, `director`, `operator`, `observer`) | that role's task |
| `test/prototype/<role>/**` | that module's tests | that role's task |

## A role module

`<role>/index.tsx` exports only `cabinet: CabinetModule` (react-refresh lint: screens live in their own files):

```ts
interface CabinetModule { role: Role; menu: CabinetMenuItem[]; routes: RouteObject[] }
interface CabinetMenuItem { href: string; label: (l: Locale) => string; icon: LucideIcon; badge?: "release2" }
```

- `href` is the full address: `protoPath("operator", "marks")` → `/proto/operator/marks`. The shell shows the items as a "Prototype" group under the real items; an empty `menu` shows no group (observer).
- `routes` are **relative** to `/proto/<role>/` (`{ path: "marks", element: <MarksPage /> }`, `{ path: "marks/:id", … }`, `{ index: true, … }`). They render as nested `<Routes>` inside the gate: no `loader`/`action`/`lazy`/`handle`. Unknown screens show "not found". A session of another role is sent to its home page (`authDestination`).

## Store (`store.ts`)

One state for the whole browser in `localStorage["imbc-prototype-v1"]`, shared by all roles (sign out, sign in as another role: the change is there). Corrupt, foreign or old content (`SCHEMA_VERSION` in `data/index.ts`) silently falls back to the initial data; `storage` events sync open tabs.

```ts
const profiles = useProto((s) => s.profiles.filter((p) => p.status === "submitted")); // read; new arrays are fine
const actor = useActor();       // { accountId, email, name, role, organizationId } of the session, in demo data
const update = useProtoUpdate(); // every change is audited (AUD-01)
update(
  { action: "works_with.validate", subject: { type: "works_with", id: mark.id, label: profile.nameRu }, summary: localized(texts, "auditValidate") },
  (draft) => { draft.worksWithMarks.find((m) => m.id === mark.id)!.state = "validated"; },
);
resetProto(); // "Reset demo data" (already on every ProtoPage); not audited
```

- The recipe mutates a deep copy (`structuredClone`); then the event `{ id, at, actor, action, subject, summary }` is appended to `state.audit`. `summary` is a ready phrase in three languages: the director's and administrator's journals show it without knowing your module. `action` is `<subject>.<verb>`; `isAccountEvent()` (`data/audit.ts`) picks the administrator's account events.
- New records: `newId("prefix")`, `nowIso()`.
- Something the shared data does not foresee goes in your namespace `state.ext[role]`:
  `const mine = useExt<MyExt>("expert", EMPTY)` to read; inside a recipe `extOf<MyExt>(draft, "expert", () => EMPTY).seen.push(id)`. Check stored values yourself (an older shape may be there).
- Never call `/api/v1`. The only server data is the session (`useMe`: role, email, locale), through `useActor` and `useProtoLocale`.

## Data (`data/`, all fictional)

Values (constants like `ORG`, `ACCOUNT`, `DD_CHECKS`) are imported from their file; types also from `@/prototype/data`.

| File | Sets | Notes |
|---|---|---|
| `organizations.ts` | `organizations`, `ORG`, `MANUFACTURERS` | IMBC, «Оператор (демо)» + «Оператор Б/В (демо)» (all three major), observer org, 12 manufacturers with seed names and BINs |
| `accounts.ts` | `accounts`, `ACCOUNT` | seed sessions (`expert@imbc.local`, …) + extra users; two migrated manufacturers have no account yet |
| `profiles.ts` | `profiles`, `DEMO_PROFILE_ID` (`p01`) | 8 sections each; statuses draft (p12), submitted (p09), under review (p11), returned (p10), verified (p01–p08), pending changes (p02); `review[section]`, `pending` |
| `due-diligence.ts` | `dueDiligence`, `DD_CHECKS`, `ddSeverity`, `ddResultOf` | green/amber/red; 25-line catalogue in report groups; SME override on p06; enhanced DD on p05 |
| `site-surveys.ts` | `siteSurveys`, `siteSurveyRequests` | p01 has a report; p03 a "no" result and an open request |
| `tier-records.ts` | `tierRecords`, `AGAR_STATUSES`, `isTier3` | AGAR report issued (p01), CDP (p02), requested (p06), shortlisted (p08) |
| `imbc-notes.ts`, `external-checks.ts` | `imbcNotes`, `externalChecks` | legacy fields on migrated profiles; mock results flagged `testData` |
| `marks.ts` | `worksWithMarks`, `visitMarks` | waiting / validated / rejected, set and removal |
| `operator-notes.ts` | `operatorNotes` | two operator organisations (GEN-12) |
| `requests.ts` | `imbcRequests` (threads), `operatorRequests` (one reply) | answered and open |
| `forecast.ts`, `tech-files.ts` | `forecastVersions`, `forecastLines`, `techFiles` | one unpublished import with a problem report; STR/KTRE by group and TN VED |
| `references.ts`, `nda.ts` | `referenceLists`, `orgChartSample`, `ndaVersions` | mandatory types (ADM-09); NDA 1.0 and current 2.0 |
| `api-credentials.ts`, `exports.ts`, `migration.ts` | `apiCredentials`, `exportRecords`, `exportSubscriptions`, `migrationInvites` | obviously fake keys |
| `notifications.ts`, `audit.ts` | `notifications` (emails to manufacturers), `audit` | |

Shared rules (`rules.ts`): `isVisible`, `visibleProfiles` (unresponsive last), `profileTier`, `isSiteSurveyed`, `tier3ProductIds`, `worksWithCount`, `ddResult`, `currentNda`, `forecastOpen`, `publishedForecast`, `accountName`, `organizationName`, `profileById`. Use them instead of re-deriving section 4.

## Texts (`i18n.ts`, `labels.ts`)

```ts
export const texts = defineDictionary({ en: { title: "Marks", count: "{count} waiting" }, ru: { … }, kk: { … } }); // missing/extra key: compile error
const t = useDictionary(texts); t("count", { count: format.number(n) });          // values are pre-formatted strings
label: (l) => translate(texts, l, "title")                                          // menu labels
const common = useCommonTexts(); common(`profileStatus.${p.status}`)                // shared enum labels
```

## Shared components (`@/prototype/components`)

- `ProtoPage` — every screen: one `PageTitle`, `h1`, "Prototype" badge with its explanation, `release2` badge, `actions`, reset button.
- Badges: `ProfileStatusBadge` (+ pending changes), `UpdateStatusBadge`, `DueDiligenceBadge` (IMBC staff only), `TierBadge` (`tier_3` for products), `DocumentStatusBadge`, `MarkStateBadge`, `AgarStatusBadge`, `Release2Badge`.
- `RequestThread` — messages you have already resolved to `{ author, meta?, at, text }` (hide the operator from the manufacturer yourself, GEN-11/OPR-28) + reply box when `onReply` is given.
- `FileRow` — a file line; with `onSelect` the user picks a file and you get a `FileRef` (name, size, time); nothing is uploaded.
- `ConfirmAction` — a button with an alert dialog; `children` for fields in the dialog, `confirmDisabled` until they are valid.

UI components: only `@/components/ui/*` (tabs, progress, switch, radio-group, accordion, alert-dialog, breadcrumb, scroll-area, pagination were added). If you need another one, report it to the controller instead of adding it.

## Rules for a module

Only your directory and your tests. No `/api/v1`. Every screen inside `ProtoPage`; a comment at the top of each screen file lists the requirement IDs it shows (they must exist: `pnpm check:requirements`). Dates and numbers through `useFormat`. Links styled as buttons: `<Link className={buttonVariants()} to={…}>`. Distinguish "empty" from other states. No horizontal page scroll at 1280 and 390 px. Show exactly what the role may see (section 4 table): observer — no focal point, no actions; operator — nothing of another operator; manufacturer — never which operator asked; administrator — no profile data; director — reads everything, changes nothing.

## Tests (`test/prototype/support.tsx`)

Files under `test/prototype/**` run in the vitest project `prototype` (flag on); others run without it.

```tsx
const { user, router, api, state } = renderCabinet("/proto/operator/notes", { role: "operator", prepare: (d) => { d.operatorNotes = []; } });
expect(apiV1Calls(api)).toEqual([]);
renderCabinet("/proto/expert/marks", { role: "expert", keepState: true }); // next role, same browser
```

Options: `role`, `email` (another user of the role), `locale` (default `en`), `prepare`, `keepState`, `api` (replies for real pages after a gate redirect). Add `vi.mock("@/lib/leave-app", …)` like the other web tests if you click sign-out.

## Worked example

`test/prototype/example-cabinet.tsx`, `example-notes.tsx`, `example-texts.ts` and `example.test.tsx`: an operator "Notes" screen (own organisation's notes, one "Add note" action with an audit event), its menu item, and tests for the menu group, the page frame, GEN-12, the audit event, persistence across sign-in and reset. Copy its shape.
