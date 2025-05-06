# Slack Bot Architecture - Reliable RAG Integration

This document outlines the architecture for the K-Answers Slack bot implementation that ensures reliable responses within the constraints of free-tier limits on Slack, Vercel (Hobby), and Upstash.

## Architecture Overview

```
Slack → /api/slack/events (Edge Function, <3s) → QStash → /api/slack/worker (Serverless, ≤10s)
```

### Key Components

1. **Slack Events API Endpoint** (`/api/slack/events`)
   - Edge function for faster response time
   - Immediately acknowledges Slack events (<3s)
   - Sends initial "thinking" message to user
   - Publishes event to QStash for asynchronous processing

2. **Worker Endpoint** (`/api/slack/worker`)
   - Serverless function with 10s duration limit
   - Processes RAG query (can take 8-9s)
   - Updates "thinking" message with final answer
   - Implements streaming for long queries with regular updates

3. **QStash Message Queue**
   - Reliable message delivery between events API and worker
   - Automatic retries (up to 3 times with exponential backoff)
   - First 5K deliveries per month free
   - Push-based delivery ensures immediate processing

## Implementation Details

### 1. Event Handling and Queue

The events endpoint is designed to:
- Verify Slack request signatures
- Process event data within 3 seconds
- Send "thinking" message to acknowledge receipt
- Publish message to QStash for asynchronous processing
- Support both channel mentions and direct messages

### 2. Worker Processing

The worker endpoint:
- Has a dedicated 10-second execution budget
- Processes the RAG query
- Implements message streaming for partial updates
- Handles Slack rate limits with a simple retry mechanism
- Updates the "thinking" message or sends a new response
- Implements idempotent processing for safe repeated deliveries

### 3. Streaming Support

For long-running queries:
- Updates the message with partial content every 2 seconds
- Provides visual feedback that processing is ongoing
- Uses the final update for complete answer
- Handles errors gracefully, showing partial results if available

### 4. Rate Limit Handling

Implementation includes:
- Retry on rate limit errors with 1.1s backoff
- Proper handling of Slack's rate limit headers
- Optimized to stay within 1 message/second per channel limit

## Key Advantages

1. **Reliability**
   - Immediate acknowledgment to Slack (<3s)
   - Message persistence via QStash
   - Retry mechanisms at multiple levels
   - QStash's built-in retry for transient failures

2. **Free Tier Compatible**
   - Vercel Hobby: Stays within 10s serverless function limit
   - Upstash QStash: Well under 5K deliveries/month free limit
   - Slack API: Respects rate limits

3. **User Experience**
   - Immediate feedback with "thinking" message
   - Streaming updates for longer queries
   - Proper threading in channels vs. direct replies in DMs

## Environment Variables

Required environment variables:
- `SLACK_BOT_TOKEN`: Your Slack bot token
- `SLACK_SIGNING_SECRET`: Your Slack signing secret
- `QSTASH_TOKEN`: Upstash QStash token
- `RAG_WORKER_URL`: URL to your worker endpoint
- `OPENAI_API_KEY`: OpenAI API key (for RAG)
- `PINECONE_API_KEY`: Pinecone API key (for RAG)

## Scaling Considerations

- Move to Vercel Pro by increasing `maxDuration` 
- Replace QStash with Vercel Background Functions when available
- For higher volume, implement batching of messages 