# Simplified Slack Bot Implementation

This document describes the simplified Slack bot implementation that responds to questions using RAG (Retrieval-Augmented Generation).

## Architecture

The Slack bot has been simplified to use a direct processing approach instead of relying on Redis queues and worker processes. The main benefits are:

1. **Reduced complexity**: No Redis queues, workers, or complex coordination
2. **Easier maintenance**: Fewer moving parts means fewer things to break
3. **More reliable**: Direct processing avoids queue/worker reliability issues
4. **Better debugging**: Simpler process flow makes issues easier to trace

## Key Components

### 1. Slack Events API Endpoint (`/api/slack/events`)

This is the main endpoint that receives events from Slack. When a message or app mention is received:

1. The handler immediately acknowledges the event to Slack (required within 3 seconds)
2. It verifies the event hasn't already been processed (deduplication)
3. It then processes the message asynchronously:
   - Sends an immediate "thinking" message to the user
   - Directly queries the RAG system
   - Updates the "thinking" message with the final answer or sends a new message if update fails

### 2. Direct Test Endpoint (`/api/slack/direct-test`)

A simple endpoint that allows you to test the RAG functionality without going through Slack:

```
GET /api/slack/direct-test?question=Your+question+here
```

### 3. Debug Event Endpoint (`/api/slack/debug-event`)

An endpoint for checking Slack connectivity and testing event handling:

- `GET` - Returns information about the Slack connection
- `POST` - Processes and logs a Slack event JSON payload for debugging

### 4. Event Log Endpoint (`/api/slack/event-log`)

Records recent Slack events for debugging:

- `GET` - Returns the last 20 events
- `POST` - Logs an incoming Slack event

## Reliability Features

The bot includes several mechanisms to improve reliability:

1. **Event deduplication**: Prevents processing the same event multiple times
2. **Message update strategy**: Updates the "thinking" message rather than sending a separate response
3. **Exponential backoff retries**: Automatically retries Slack API calls that fail due to rate limits or network issues
4. **Request tracking**: Each request is assigned a unique ID for easier tracing in logs
5. **Error handling**: Comprehensive error handling at each processing step

## How to Use

### Setting Up Slack

1. Create a Slack app in your workspace
2. Configure Event Subscriptions to point to your `/api/slack/events` URL
3. Subscribe to the `message.channels` and `app_mention` events
4. Ensure you have the proper bot permissions:
   - `chat:write`
   - `channels:history`

### Environment Variables

The bot requires the following environment variables:

- `SLACK_BOT_TOKEN` - Your Slack Bot User OAuth Token
- `SLACK_SIGNING_SECRET` - Your Slack Signing Secret

### Troubleshooting

If the bot isn't responding:

1. Check Slack app Event Subscriptions to ensure URL verification passed
2. Use `/api/slack/debug-event` to test your Slack connection
3. Use `/api/slack/direct-test` to test the RAG system directly
4. Check `/api/slack/event-log` to see if events are being received
5. Verify console logs for any errors

## Rate Limiting

The bot includes a simple in-memory rate limiting system that limits users to 5 queries per minute. This helps prevent abuse and keeps the system stable. 