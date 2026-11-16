# Due Diligence UI: reviewed implementation checkpoint

Date:16 November2026. Branch:feat/stage-3-profile. Requires backend/contracts f1d309e and its exact current/history report pins/sourceSnapshots. This checkpoint is implementation acceptance, not production/runtime/provider approval.

## Behavior

- SME and director open /imbc/profiles/:profileId/due-diligence via permitted Company/Reviews links and preserve the exact return path. Director only reads; no mutation hooks are mounted. Other four roles redirect before DD queries.
- Current/automatic/manual/enhanced result, nullable facts and exact decimal/JSON strings are retained. Critical findings and attention are distinct; all grouped checks remain accessible.
- Latest attempt is independent of the retained business result, including unavailable/no-answer/quota/pending states. Current result, latest attempt and each historical before/after state display their own immutable source/test provenance. History never infers from the latest current row.
- SME override/enhanced writes send exact UTC6 optimistic token and a complete intent. A409 requires explicit reload; changed token is loaded while unsaved comment/report intent remains. Save is deliberate; cancelling dirty intent requires confirmation and focus returns to the initiating control.
- Report upload enforces25MB before transmission, file types and pending/rejected/passed states. Saving cannot bind a pending/rejected candidate. Current/history downloads use captured numeric version numbers, including different historical versions of the same file; no latest/UUID fallback.
- Full source/check/record before/after history loads in pages of50. Names use safe account names; immutable audit IDs and timestamps remain backend facts.

## Validation

SourceData and independent GPT-6 Astra each passed40 files/488 web cases; types/lint/build passed. Astra independently passed12 DD contracts and58 DD PostgreSQL/HTTP checks after exact historical source provenance was added. P2 mock labels in latest attempts/history is closed; no remaining P1/P2 found within this reviewed scope. Whole Root API gate1939 passed/76 separately guarded cases skipped; contracts354 passed.

Actual compiled Chrome fixture: desktop1280/mobile390,EN/RU/KK; 32 requests/14DD in two initial waves, one intentional409 and three synthetic mutations. Final provenance wave:3requests/2DD/zeroerrors/zeromutations. Null-current mock attempt and before-mock/after-real source dates show independent labels. Body390 and dialog358==scroll358. CUA completion summaries sent, tabs closed, viewport reset and servers stopped. Real API/browser/OIDC/storage/provider/corpus and load/production acceptance remain open.

## Owned implementation manifest

- `apps/web/src/features/diligence/api.ts`
- `apps/web/src/features/diligence/feedback.tsx`
- `apps/web/src/features/diligence/checks.tsx`
- `apps/web/src/features/diligence/record.tsx`
- `apps/web/src/features/diligence/report-upload.tsx`
- `apps/web/src/features/diligence/editor.tsx`
- `apps/web/src/features/diligence/history.tsx`
- `apps/web/src/features/diligence/actions.tsx`
- `apps/web/src/routes/app/diligence.tsx`
- `apps/web/test/diligence.test.tsx`
- `apps/web/test/support/diligence.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `apps/web/messages/kk.json`
- `apps/web/src/router.tsx`
- `apps/web/src/routes/app/company.tsx`
- `apps/web/src/routes/app/reviews.tsx`
- `apps/web/test/reviews.test.tsx`

SHA256 of key reviewed artifacts:

- `apps/web/src/features/diligence/record.tsx`: `da6ef12d28cb3fce76d38f4a0f86cb98e144a68ba3d0645c233544c482e6b05c`
- `apps/web/src/features/diligence/history.tsx`: `4ac00886e3aeb73dd25246bbd9d66a032103d07eceab2e2435a35d995e2860cf`
- `apps/web/test/diligence.test.tsx`: `0ab13bc2d7548b2a9ec9f489b7b3db5872930b42dd38a0a2a29874d97a264a5d`
