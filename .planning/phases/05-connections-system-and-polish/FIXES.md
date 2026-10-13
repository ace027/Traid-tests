# Phase 5: Connections, System and Polish — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-13
**Checks**: 20/20 passed
**Files changed**: `e2e/smoke.spec.ts`, `web/src/components/layout/CommandActivity.tsx`, `web/src/components/layout/commandActivity.test.tsx`, `web/src/pages/settings/NotificationModal.tsx`, `web/src/pages/settings/connect.test.tsx`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `web/src/components/layout/CommandActivity.tsx` | engineering-frontend-developer | fix applied | F-001 fixed. The command activity button now always renders, with an Activity icon and the label "No running commands" when idle. The popover stays open when the last command finishes, shows "No active commands", and lists "Recently completed". F-002 fixed. The Webhook URL check now skips the masked value, as the Discord branch does. |
| F-002 | major | `web/src/pages/settings/NotificationModal.tsx` | engineering-frontend-developer | fix applied | F-001 fixed. The command activity button now always renders, with an Activity icon and the label "No running commands" when idle. The popover stays open when the last command finishes, shows "No active commands", and lists "Recently completed". F-002 fixed. The Webhook URL check now skips the masked value, as the Discord branch does. |
| F-005 | major | `e2e/smoke.spec.ts` | engineering-backend-architect | fix applied | F-005 fixed in e2e/smoke.spec.ts. Backup restore and a notification fired on an import event are still not covered. - Test 5 stays on /activity/queue and marks the document. It then asserts the WEB-DL-E2E row and the progress bar become hidden, and that the marker survived, so there was no reload. - Test 6 snapshots the existing Housekeeping command ids and clicks Run. It polls for a new completed command, then asserts the Tasks "Command queue" table gains one Completed Housekeeping row, with no reload. It does not check the transient running or queued badge, because that would be flaky. - Test 4 creates a Webhook with onGrab only via the API before the grab, then polls /e2e-hook for a Grab payload with the grabbed series title. - New test 8 clicks "Backup now" and asserts the toast and the new row. It then downloads a backup and checks the filename and that the file is non-empty. |
