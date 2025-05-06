# Implementation Checklist

Follow these steps to implement the Slack bot with reliable RAG integration:

## 1. Dependency Installation

- [x] Install QStash package:
  ```
  npm install @upstash/qstash
  ```

## 2. Code Implementation

- [x] Update `/api/slack/events/route.ts` to use Edge runtime and QStash
- [x] Create `/api/slack/worker/route.ts` for processing RAG queries
- [x] Add streaming support to the worker for long-running queries
- [x] Update `vercel.json` to include cron job for queue monitoring

## 3. Upstash QStash Setup

- [ ] Create an Upstash account if you don't have one: https://upstash.com/
- [ ] Create a new QStash project
- [ ] Get your QStash token from the dashboard
- [ ] Set up a QStash endpoint pointing to your worker URL

## 4. Environment Variables

Set the following environment variables in Vercel:

- [ ] `SLACK_BOT_TOKEN`: Your Slack bot token
- [ ] `SLACK_SIGNING_SECRET`: Your Slack signing secret
- [ ] `QSTASH_TOKEN`: Your QStash token from Upstash
- [ ] `RAG_WORKER_URL`: The URL to your worker endpoint (e.g., https://your-domain.vercel.app/api/slack/worker)
- [ ] `OPENAI_API_KEY`: Your OpenAI API key (for RAG)
- [ ] `PINECONE_API_KEY`: Your Pinecone API key (for vector storage)

## 5. Slack App Configuration

- [ ] Ensure your Slack app has the following scopes:
  - `app_mentions:read`
  - `chat:write`
  - `im:history` (for DMs)
  - `channels:history` (for channels)
- [ ] Verify your Slack Events API URL is configured correctly
- [ ] Subscribe to the `app_mention` and `message.im` events

## 6. Testing

Use the verification checklist (`test-verification.md`) to test your implementation:

- [ ] Single mention in a public channel
- [ ] Direct message test
- [ ] Rapid multiple messages test
- [ ] Long processing/streaming test

## 7. Monitoring

- [ ] Set up logging to monitor:
  - Successful event handling
  - QStash message delivery
  - Worker processing times
  - Any errors or rate limiting issues
- [ ] Check Vercel logs for any issues
- [ ] Monitor QStash dashboard for message delivery

## 8. Optimization & Scaling (Future)

- [ ] Consider enabling streaming by default for all requests
- [ ] Implement batching for high-volume scenarios
- [ ] Add more comprehensive error handling
- [ ] Consider upgrading to Vercel Pro for longer processing times 