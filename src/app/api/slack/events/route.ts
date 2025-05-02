import { NextResponse } from 'next/server';
import { App, ExpressReceiver, AppMentionEvent, MessageEvent, SayFn } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { queryRag } from '@/lib/rag';

// Rate limiting data store
interface RateLimitData {
  count: number;
  lastResetTime: number;
}

// In-memory rate limit store (reset every minute)
const userRateLimits: Map<string, RateLimitData> = new Map();
const MAX_REQUESTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// Initialize Slack client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Create a receiver
const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  processBeforeResponse: true,
});

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: expressReceiver,
});

// Rate limiting middleware
const checkRateLimit = (userId: string): boolean => {
  const now = Date.now();
  const userData = userRateLimits.get(userId);

  if (!userData) {
    // First request from this user
    userRateLimits.set(userId, {
      count: 1,
      lastResetTime: now,
    });
    return true;
  }

  // Check if we need to reset the window
  if (now - userData.lastResetTime > RATE_LIMIT_WINDOW_MS) {
    userRateLimits.set(userId, {
      count: 1,
      lastResetTime: now,
    });
    return true;
  }

  // Check if user has exceeded the rate limit
  if (userData.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  // Increment the count
  userData.count += 1;
  userRateLimits.set(userId, userData);
  return true;
};

// Handle app_mention events (for public channels)
app.event('app_mention', async ({ event, say, client }: { 
  event: AppMentionEvent, 
  say: SayFn, 
  client: WebClient 
}) => {
  try {
    // Skip if the message is from a bot (loop prevention)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('[DEBUG] Ignoring message from a bot');
      return;
    }

    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    
    console.log(`[DEBUG] Received app_mention from user ${userId} in channel ${channelId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      await say({
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: threadTs,
      });
      return;
    }

    // Extract message text (remove the @mention part)
    const botUserId = (await client.auth.test()).user_id;
    const mentionTag = `<@${botUserId}>`;
    const questionText = event.text.replace(mentionTag, '').trim();
    
    if (!questionText) {
      await say({
        text: "I didn't receive a question. Please try again with a question after the mention.",
        thread_ts: threadTs,
      });
      return;
    }

    // Log the query
    console.log(`[DEBUG] Processing query from user ${userId}: "${questionText}"`);

    // Query the RAG system
    const answer = await queryRag(questionText);

    // Reply in the thread
    await say({
      text: answer,
      thread_ts: threadTs,
    });

    console.log(`[DEBUG] Sent response to user ${userId} in channel ${channelId}`);
  } catch (error) {
    console.error('[ERROR] Error handling app_mention event:', error);
    await say({
      text: "I encountered an error while processing your question. Please try again later.",
      thread_ts: event.thread_ts || event.ts,
    });
  }
});

// Handle direct messages
app.event('message.im', async ({ event, say }: { 
  event: MessageEvent, 
  say: SayFn 
}) => {
  try {
    // Skip if the message is from a bot (loop prevention)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('[DEBUG] Ignoring DM from a bot');
      return;
    }

    const userId = event.user;
    console.log(`[DEBUG] Received DM from user ${userId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      await say({
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: event.thread_ts,
      });
      return;
    }

    const questionText = event.text.trim();
    
    if (!questionText) {
      await say("I didn't receive a question. Please try again with a question.");
      return;
    }

    // Log the query
    console.log(`[DEBUG] Processing DM from user ${userId}: "${questionText}"`);

    // Query the RAG system
    const answer = await queryRag(questionText);

    // Reply in the DM
    await say({
      text: answer,
      thread_ts: event.thread_ts,
    });

    console.log(`[DEBUG] Sent response to user ${userId} in DM`);
  } catch (error) {
    console.error('[ERROR] Error handling message.im event:', error);
    await say("I encountered an error while processing your question. Please try again later.");
  }
});

// Handle the HTTP request from Slack
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      console.log('[DEBUG] Handling URL verification challenge');
      return NextResponse.json({ challenge: body.challenge });
    }

    // Process the event
    if (body.event) {
      // Forward the event to the Bolt app
      await expressReceiver.router.request({
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-slack-signature': request.headers.get('x-slack-signature') || '',
          'x-slack-request-timestamp': request.headers.get('x-slack-request-timestamp') || '',
        },
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 });
  } catch (error) {
    console.error('[ERROR] Error in Slack events handler:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 