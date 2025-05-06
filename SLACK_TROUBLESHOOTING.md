# Slack Bot Troubleshooting Guide

## Current Issue: Initial Message Appears but Final Answer Doesn't

We're seeing that the "I'm searching the docs..." message appears in Slack, but the final answer never arrives. This indicates that:

1. The edge function (`/api/slack/events`) is functioning correctly
2. The issue occurs somewhere in the chain:
   - QStash message publishing
   - QStash message delivery
   - Worker function execution
   - Slack API updates

## Diagnostic Plan

### Step 1: Added Enhanced Logging

We've added detailed logging at key points in the process:

1. **Events Edge Function**:
   - After QStash publish to see response status and body
  
2. **Worker Function**:
   - When job is received (with channel and stub_ts details)
   - Right before sending the answer to Slack
   - After the Slack API response
   - During error cases

### Step 2: Test with a Unique Identifier

When running tests, include a unique string in the question, like:
```
What is Customer Hub? [debug-cb7f]
```

This makes it easy to find the relevant log entries in Vercel.

### Step 3: Direct Test Endpoint

We've created a diagnostic endpoint that bypasses QStash to help isolate the issue:
```
GET /api/slack/direct-test?channel=C12345&stub_ts=1.234567890
```

This endpoint directly calls the worker with the provided channel and stub_ts, which helps determine if the issue is with QStash or with the worker/Slack API interaction.

## Common Failure Points & Symptoms

| Failure Point | Symptoms | How to Verify |
|---------------|----------|---------------|
| QStash publish | Edge log shows non-200 response | Check event logs for "[SLACK] QStash publish" entries |
| Job never delivered | Edge shows 200, worker log absent | Look for worker logs at the appropriate timestamp |
| Worker errors early | Worker log with stack trace | Check worker logs for errors |
| Slack API rejection | Worker log shows chat.update error | Look for "[WORKER] Slack API update response" entries |
| RAG processing error | Worker log with error during processing | Look for RAG errors in worker logs |

## QStash Verification

In the Upstash dashboard (QStash tab), check:

1. **Recent Messages**: Verify messages are being published
2. **Status**: Should show "Success" or "Retrying (n/3)"  
3. **Failure Information**: Expand failed messages to see details

## Environment Variable Check

Crucial environment variables to verify:

1. `SLACK_BOT_TOKEN` - Must be valid and have appropriate permissions
2. `RAG_WORKER_URL` - Must point to the correct worker endpoint
3. `QSTASH_TOKEN` - Must be valid and have publish permissions

## Fixing the Issue

Based on the diagnostic results, here are common fixes:

1. **QStash Publishing Problems**:
   - Verify the QSTASH_TOKEN
   - Check that the RAG_WORKER_URL is properly formatted and accessible
  
2. **Worker Execution Problems**:
   - Look for errors in RAG processing
   - Verify OpenAI API key and Pinecone configuration
  
3. **Slack API Problems**:
   - Make sure the bot is in the channel
   - Check if the bot has the necessary permissions
   - Verify the bot token is correctly formatted
   - Check if the bot can access the message it's trying to update

## Direct Testing Steps

1. Find the stub message TS in Slack (right-click message → Copy Link)
   - The TS is in the URL: `https://team.slack.com/archives/C12345/p1234567890123456`
   - Format: `1234567890.123456` (remove the 'p' and add a '.')

2. Call the direct test endpoint:
   ```
   GET /api/slack/direct-test?channel=C12345&stub_ts=1234567890.123456
   ```

3. Check the response for errors and verify in Slack if the message is updated.

This will help isolate if the issue is with QStash delivery or with the Slack API/worker interaction. 