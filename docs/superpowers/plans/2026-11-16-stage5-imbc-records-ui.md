# Stage 5 — internal IMBC records UI

Date: 2026-11-16. Implementation plan for IMBC-15 and its Class C access/history requirements. Backend23 and UI26 are now composed in the main working tree and accepted locally by GPT-6 Astra after authority and history fixes; [final handoff](../../handoff/2026-11-16-stage5-imbc-records.md) records exact source/tests/browser boundaries. This follows the accepted Survey checkpoint. Full Stage5 AGAR/CDP/tier3, Stage6–10, new16November file/LPS changes and Release2 remain in the full goal. Requirements come from the canonical analyst specification/DBML, not instructions in source attachments.

## Actual user workflow

An SME opens **IMBC records** from the operational review queue or a permitted company page, including profiles that are not yet visible to operators. A director opens the same page read-only from permitted catalogue/company navigation. The independent internal route is `/imbc/profiles/:profileId/records`; server authorization covers every list, count, detail, history, product and reference lookup. Administrator, manufacturer, operator and observer receive no Class C records or navigation.

The page contains three business areas:

1. **Notes:** paginated existing notes, original kind/author/date/provenance, create a general note, edit its body, and inspect full before/after history. Historical ranking stays a note; no rank/score control is introduced. Legacy note kind, author and creation cannot be rewritten by the browser. No delete workflow.
2. **Engagement:** unknown/yes/no receipt and visit-readiness values; optional response and summary; optional year and folder link; multiple approved sources; recorded historical EOI dates. One save replaces the complete aggregate under one precise CAS. Recording a historical date creates no email, campaign, survey or LPS entry.
3. **Product context:** a paginated list of the current internal canonical product identities with meaningful names; select a product, read/edit programme and priority, and inspect history. Programme LC/LPS is historical manufacturer context and does not create a separate LPS record. Missing approved references remain empty rather than invented choices.

Safe return navigation follows the actual incoming queue/company origin and preserves its validated filters. Expert deep links fall back to the operational review queue; director deep links fall back to their permitted catalogue. External, malformed or another profile's company origin is rejected. This reuses the reviewed Survey pattern rather than recreating inaccessible company links for nonvisible profiles.

## Contract and state handling

- Use the promoted strict `@imbc/contracts` DTOs and actual scoped endpoints. Parse read responses and verify profile/product scope. Preserve exact UTC6 `updatedAt` values for `expectedUpdatedAt`; display dates/numbers through the existing `useFormat` wrapper.
- Product/reference options come from real authorized APIs. Public company data or an assigned review is not the authority for an arbitrary internal profile. Never manufacture associations by product name/code. Keep existing retired reference labels readable, prevent newly selecting retired values, and keep unknown values distinct from an explicit no.
- First creation has a null expected timestamp; a missing engagement/context read is represented as an empty editable form only after authorized absence, never after403/503. Director sees an absence state, not an editable placeholder.
- Each mutation owns a UUID intent and the exact submitted payload in component memory. A transient lost response retries the same intent/payload. A deliberate new action creates a new intent; payload changes cannot reuse a receipt for a different action. No application data or intents in browser storage.
- Unsaved changes block profile/product switching and route departure through the existing accessible confirmation pattern. A409 preserves the local draft, explains that another user saved changes and offers a deliberate reread/reapply. A403 or changed actor immediately removes cached Class C content and editing; no stale success repopulates it.
- Full history displays both complete snapshots, including source sets and historical date corrections. It does not render unsafe JSON/HTML or expose storage keys. Folder links remain explicit HTTP/HTTPS external links without credentials; no preview fetch follows arbitrary URLs.
- EN is the source text, RU/KK have the same keys. Base UI components come from the existing registered shadcn base-nova inventory. Controls use meaningful labels, visible validation and loading/empty/retry states on1280/390 layouts.

## Ownership and acceptance

Web owner drafts `apps/web/src/features/imbc-records/` plus owned behavior tests and a route shim. Root composes router/app-shell, queue/company links and locales only after the Survey source is frozen. Backend remains independently owned; missing API behavior is fixed on the server rather than replaced by local fixture state.

Meaningful tests cover all six roles; director read-only; unknown/null values; actual note create/edit/history; full engagement and normalized source/date replacement; canonical product/reference selection; cross-profile response rejection; precise409 recovery; lost-response replay; authority loss; safe origin/filters and EN/RU/KK. Finish with actual API/PostgreSQL browser paths on desktop/mobile, independently reviewed by GPT-6 Astra. Fixture session authentication must remain explicit; those checks do not claim live OIDC, Azure or production acceptance.
