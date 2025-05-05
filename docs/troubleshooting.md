# Slack Bot Troubleshooting Guide

## Common Issues and Solutions

### Messages not being processed by the RAG worker

**Symptoms:**
- Messages are received by the Slack events API endpoint
- Messages are successfully enqueued in Upstash
- No response is sent back to the user (no thinking message, no final answer)

**Possible Causes and Solutions:**

1. **Environment Variable Mismatch**

   The most common cause is a mismatch between the environment variables used to trigger and authenticate the worker:

   ```
   # In events/route.ts (triggering the worker)
   fetch(`${baseUrl}/api/slack/rag-worker?key=${process.env.WORKER_SECRET}`, ...)
   
   # In rag-worker/route.ts (authenticating the request)
   const expectedKey = process.env.WORKER_SECRET_KEY || '';
   ```

   **Solution:** Ensure both endpoints use the same environment variable. We've updated the code to consistently use `WORKER_SECRET_KEY` everywhere.

2. **Queue Not Being Processed**

   If messages are successfully enqueued but not processed, you can verify this by:

   - Checking Upstash Redis logs to confirm messages are in the queue
   - Manually triggering the worker with the script: `npx ts-node src/scripts/trigger-worker.ts`

3. **Worker Permissions**

   Make sure the worker has the necessary permissions:

   - `WORKER_SECRET_KEY` matches between the events API and worker
   - Upstash Redis credentials are correct
   - Slack Bot token has appropriate permissions

## Environment Variables

Ensure these environment variables are set in both development and production:

```
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret

# Upstash Redis Configuration
UPSTASH_REDIS_URL=https://your-instance.upstash.io
UPSTASH_REDIS_TOKEN=your-redis-token

# Worker Configuration
WORKER_SECRET_KEY=your-worker-secret-key

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key
```

## Manual Worker Trigger

If messages are stuck in the queue, you can manually trigger the worker:

```bash
# Set any required environment variables
export WORKER_SECRET_KEY="your-secret-key"

# Run the worker trigger script
npx ts-node src/scripts/trigger-worker.ts
```

This will attempt to process the next job in the queue. 