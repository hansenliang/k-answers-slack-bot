# Slack Bot Verification Checklist

This checklist will help verify that the Slack bot is functioning correctly.

## Prerequisites

- [ ] Your Slack bot is installed in your workspace
- [ ] Bot has correct permissions: `chat:write`, `app_mentions:read`, etc.
- [ ] Environment variables are properly set in Vercel
- [ ] QStash is properly configured

## Test Cases

### 1. Single Mention in a Public Channel

#### Steps:
1. Go to a public channel where the bot is present
2. Mention the bot with a question: `@your-bot Tell me about feature X`

#### Expected Results:
- [ ] "I'm thinking..." message appears within 1 second
- [ ] Full answer appears as an update to the thinking message within 15 seconds
- [ ] Check logs to verify message was processed via QStash -> worker

### 2. Direct Message (DM) Test

#### Steps:
1. Open a DM with your bot
2. Send a question message directly (no @ mention needed)

#### Expected Results:
- [ ] Answer appears directly (may or may not show thinking message, depending on implementation)
- [ ] Response should arrive within 15 seconds
- [ ] Response should be in the main conversation, not in a thread

### 3. Rapid Multiple Messages Test

#### Steps:
1. Send 5 rapid @ mentions to the bot in a channel
2. Space them about 0.5-1 second apart

#### Expected Results:
- [ ] All 5 messages should get "thinking" messages
- [ ] All 5 should eventually get full answers
- [ ] Check logs - there should be at most one rate limit retry
- [ ] No Slack rate limit warnings should appear

### 4. Long Processing Test

#### Steps:
1. Ask a complex question that would require a lengthy answer
   Example: `@your-bot Can you explain how the entire RAG system works in detail?`

#### Expected Results:
- [ ] Initial "thinking" message appears quickly
- [ ] Message should update with partial answers periodically (around every 2 seconds)
- [ ] Final complete answer should appear

## Debugging

If any tests fail, check:

1. Vercel logs for:
   - `/api/slack/events` (for initial message receipt)
   - `/api/slack/worker` (for RAG processing)

2. QStash dashboard:
   - Are messages being enqueued properly?
   - Are they being delivered to the worker?
   - Any failed deliveries?

3. Environment variables:
   - Verify all required variables are set correctly

4. HTTP statuses:
   - Events endpoint should return 200 within 3 seconds
   - Worker endpoint should process within 10 seconds 