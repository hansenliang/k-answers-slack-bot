Fix Slack bot reliability by correcting worker trigger mechanism

## Changes:

1. Fixed environment variable mismatch between events route and worker:
   - Events route was using `WORKER_SECRET` but worker expected `WORKER_SECRET_KEY`
   - Now both consistently use `WORKER_SECRET_KEY`

2. Enhanced worker trigger with better error handling:
   - Added response handling to detect auth/connection issues
   - Added more detailed logging for easier debugging
   - Using hardcoded production URL when in production environment

3. Added diagnostic tools:
   - Created a script to manually trigger the worker: `src/scripts/trigger-worker.ts`
   - Added troubleshooting documentation: `docs/troubleshooting.md`

4. Improved unit test setup:
   - Updated Jest environment variables to use the correct key names

## Root Cause:
Messages were correctly enqueueing but not being processed because the worker trigger
used `process.env.WORKER_SECRET` while the worker authentication expected
`process.env.WORKER_SECRET_KEY`, causing unauthorized 401 errors.

## Testing:
Tests have been updated and verified to pass. Manual testing with local server confirms
the worker can now be properly triggered. 