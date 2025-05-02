## Getting Started
Slack me that you want to use this, I need to add your email to the allowlist, and share the env.local values for you to use.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Slack Integration

The application includes a Slack bot that monitors public channels and direct messages for @mentions, queries the RAG system, and posts answers in threads.

### Setup

1. Create a Slack app in the [Slack API Console](https://api.slack.com/apps)
2. Enable the Events API and subscribe to the following events:
   - `app_mention` (for public channel mentions)
   - `message` (for direct messages)
3. Add the following scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `im:read`
4. Set the Request URL to your deployed API endpoint: `https://your-domain.com/api/slack/events`
5. Install the app to your workspace
6. Add the following environment variables to your `.env.local` file:
   - `SLACK_BOT_TOKEN` - Bot token from the Slack app (starts with `xoxb-`)
   - `SLACK_SIGNING_SECRET` - Signing secret from the Slack app

### Features

- Monitors all public channels and direct messages
- Responds only to @mentions
- Posts answers in the same thread as the mention
- Rate-limited to 5 questions per minute per user
- Ignores messages from bots to prevent loops
