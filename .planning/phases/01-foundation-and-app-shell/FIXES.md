# Phase 1: Foundation and App Shell — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-13
**Checks**: 17/17 passed
**Files changed**: `shared/src/qualities.test.ts`, `shared/src/qualities.ts`, `web/src/components/layout/AppLayout.tsx`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-002 | major | `web/src/components/layout/AppLayout.tsx` | engineering-frontend-developer | fix applied | F-002 fixed. AppLayout now focuses the `#main` region (it already has tabIndex=-1) on each pathname change and skips the first render. Focus no longer stays on the old sidebar link or falls to body. |
| F-004 | major | `shared/src/qualities.ts` | engineering-backend-architect | fix applied | F-004 fixed. QUALITIES is now ordered lowest to highest, so `buildItems`, `weight` and the `/qualityprofile/schema` response all use that order. Order: Unknown, SDTV, WEBRip-480p, WEBDL-480p, DVD, Bluray-480p, HDTV-720p, WEBRip-720p, WEBDL-720p, Bluray-720p, HDTV-1080p, Raw-HD, WEBRip-1080p, WEBDL-1080p, Bluray-1080p, Remux-1080p, then the 2160p qualities (HDTV, WEBRip, WEBDL, Bluray, Remux). Quality ids are unchanged. I added a test that weights increase and that resolution never decreases. |
