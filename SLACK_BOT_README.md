# K-Answers Slack Bot

This document outlines the implementation and deployment of the K-Answers Slack bot, which uses RAG (Retrieval Augmented Generation) to answer questions in Slack.

## Implementation Overview

The Slack bot has been completely rebuilt to address reliability issues. Key improvements include:

1. **Immediate Response Pattern**: The bot now acknowledges Slack requests within 3 seconds to prevent timeouts
2. **Asynchronous Processing**: RAG queries and complex processing happen after acknowledgment
3. **Direct Processing**: Removed the job queue system in favor of direct processing for simplicity
4. **Environment Variables Management**: Centralized environment variable handling and validation
5. **Error Resilience**: Comprehensive error handling throughout the codebase
6. **Reuse of Web Chat RAG**: Leverages the existing RAG implementation that works well in the web chat

## File Structure

- `src/app/api/slack/events/route.ts` - Main Slack event handler
- `src/app/api/slack/verify/route.ts` - Endpoint for Slack request verification
- `src/app/api/slack/diagnostic/route.ts` - Diagnostic endpoint for testing Slack API connectivity
- `src/lib/env.ts` - Environment variables management and validation
- `vercel.json` - Vercel deployment configuration
- `next.config.js` - Next.js configuration for Node.js compatibility

## Deployment Steps

1. **Set Required Environment Variables**:
   - `SLACK_BOT_TOKEN` - Your Slack bot token
   - `SLACK_SIGNING_SECRET` - Your Slack app signing secret
   - `OPENAI_API_KEY` - OpenAI API key for RAG processing
   - `PINECONE_API_KEY` - Pinecone API key for vector search

2. **Deploy to Vercel**:
   ```bash
   git add .
   git commit -m "Implement rebuilt Slack bot with improved reliability"
   git push
   vercel --prod
   ```

3. **Configure Slack App**:
   - Visit [api.slack.com/apps](https://api.slack.com/apps) and select your app
   - Under "Event Subscriptions", enable events and set the Request URL to `https://your-domain.com/api/slack/events`
   - Subscribe to bot events: `message.im`, `app_mention`
   - Under "OAuth & Permissions", ensure your bot has the required scopes:
     - `app_mentions:read`
     - `chat:write`
     - `im:history`
     - `im:read`
     - `channels:history`

4. **Test the Integration**:
   - Visit `https://your-domain.com/api/slack/diagnostic` to verify Slack API connectivity
   - Send a direct message to your bot in Slack
   - Mention your bot in a channel

## Troubleshooting

- **Slack events not being received**: Verify the Events API URL and check that event subscriptions are enabled
- **Bot not responding**: Check the environment variables and verify Slack API connectivity via the diagnostic endpoint
- **Timeout errors**: Ensure the bot is responding to Slack within 3 seconds

## Architecture Details

### Events Handler

The events handler is designed to:
1. Immediately acknowledge receipt of Slack events
2. Process events asynchronously to prevent timeouts
3. Use direct message processing instead of a job queue
4. Implement proper rate limiting to prevent abuse

### Verification Endpoint

Handles Slack's request verification challenge:
1. Validates the request signature using the signing secret
2. Prevents replay attacks by checking timestamp freshness
3. Returns appropriate error messages for invalid requests

### Environment Variables

Centralized environment management with:
1. Type-safe variable definitions
2. Validation functions for different categories of variables
3. Status logging for easier debugging
4. Clear error messages for missing variables

## Security Considerations

1. **Request Verification**: All Slack requests are verified using HMAC signatures
2. **Rate Limiting**: User rate limiting to prevent abuse
3. **Error Handling**: Careful error handling to prevent information leakage
4. **Async Processing**: User data is processed after the HTTP response to prevent timeouts

## Future Improvements

1. **Streaming Responses**: Implement streaming responses for real-time updates
2. **Rich Message Formatting**: Enhance message formatting with better markdown and citations
3. **User Feedback Collection**: Add reaction buttons for feedback on answer quality
4. **Conversation History**: Store conversation history for more context-aware responses

## Credits

This implementation uses:
- Next.js for the API routes
- @slack/web-api for Slack integration
- OpenAI for RAG processing
- Pinecone for vector search 