import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { createHmac, timingSafeEqual } from 'crypto';
import { queryRag } from '@/lib/rag';

// Initialize Slack client
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Rate limiting data store
interface RateLimitData {
  count: number;
  lastResetTime: number;
}

// In-memory rate limit store (reset every minute)
// Note: In a true serverless environment, this will reset between invocations
// For production, use a database or Redis for rate limiting
const userRateLimits: Map<string, RateLimitData> = new Map();
const MAX_REQUESTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// Rate limiting function
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

// Verify Slack request signature
const verifySlackRequest = (
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean => {
  if (!signature || !timestamp) {
    return false;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[ERROR] SLACK_SIGNING_SECRET not set');
    return false;
  }

  // Check if the timestamp is too old (more than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex')}`;

  try {
    return timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
  } catch (e) {
    return false;
  }
};

// Handle a mention in a public channel
const handleAppMention = async (event: any) => {
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
      await webClient.chat.postMessage({
        channel: channelId,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: threadTs,
      });
      return;
    }

    // Extract message text (remove the @mention part)
    const botInfo = await webClient.auth.test();
    const botUserId = botInfo.user_id;
    const mentionTag = `<@${botUserId}>`;
    const questionText = event.text.replace(mentionTag, '').trim();
    
    if (!questionText) {
      await webClient.chat.postMessage({
        channel: channelId,
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
    await webClient.chat.postMessage({
      channel: channelId,
      text: answer,
      thread_ts: threadTs,
    });

    console.log(`[DEBUG] Sent response to user ${userId} in channel ${channelId}`);
  } catch (error) {
    console.error('[ERROR] Error handling app_mention event:', error);
    try {
      await webClient.chat.postMessage({
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later.",
        thread_ts: event.thread_ts || event.ts,
      });
    } catch (postError) {
      console.error('[ERROR] Failed to send error message:', postError);
    }
  }
};

// Handle a direct message
const handleDirectMessage = async (event: any) => {
  try {
    // Only process direct messages (channel_type === 'im')
    if (event.channel_type !== 'im') {
      return;
    }
    
    // Skip if the message is from a bot (loop prevention)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('[DEBUG] Ignoring DM from a bot');
      return;
    }

    const userId = event.user;
    const channelId = event.channel;
    console.log(`[DEBUG] Received DM from user ${userId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      await webClient.chat.postMessage({
        channel: channelId,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: event.thread_ts,
      });
      return;
    }

    const questionText = event.text.trim();
    
    if (!questionText) {
      await webClient.chat.postMessage({
        channel: channelId,
        text: "I didn't receive a question. Please try again with a question.",
      });
      return;
    }

    // Log the query
    console.log(`[DEBUG] Processing DM from user ${userId}: "${questionText}"`);

    // Query the RAG system
    const answer = await queryRag(questionText);

    // Reply in the DM
    await webClient.chat.postMessage({
      channel: channelId,
      text: answer,
      thread_ts: event.thread_ts,
    });

    console.log(`[DEBUG] Sent response to user ${userId} in DM`);
  } catch (error) {
    console.error('[ERROR] Error handling direct message event:', error);
    try {
      await webClient.chat.postMessage({
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later.",
      });
    } catch (postError) {
      console.error('[ERROR] Failed to send error message:', postError);
    }
  }
};

// Main request handler
export async function POST(request: Request) {
  try {
    // Get the raw request body
    const rawBody = await request.text();
    let body;
    
    try {
      body = JSON.parse(rawBody);
    } catch (err) {
      console.error('[ERROR] Failed to parse request body');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      console.log('[DEBUG] Handling URL verification challenge');
      return NextResponse.json({ challenge: body.challenge });
    }

    // Verify the request signature (except for URL verification)
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');
    
    if (!verifySlackRequest(rawBody, signature, timestamp)) {
      console.error('[ERROR] Request signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Process the event
    if (body.event) {
      const event = body.event;
      
      // Handle different event types
      if (event.type === 'app_mention') {
        // Process app mention event asynchronously
        handleAppMention(event).catch(err => {
          console.error('[ERROR] Failed to handle app_mention:', err);
        });
      } else if (event.type === 'message') {
        // Process message event asynchronously
        handleDirectMessage(event).catch(err => {
          console.error('[ERROR] Failed to handle message:', err);
        });
      }

      // Always respond with a 200 OK to Slack immediately
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 });
  } catch (error) {
    console.error('[ERROR] Error in Slack events handler:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 