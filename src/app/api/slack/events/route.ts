import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { timingSafeEqual, createHmac } from 'crypto';
import { queryRag } from '@/lib/rag';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, validateSlackEnvironment, logEnvironmentStatus } from '@/lib/env';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Log environment status at initialization
logEnvironmentStatus();

// Validate Slack environment variables
const slackEnv = validateSlackEnvironment();
if (!slackEnv.valid) {
  console.error(`[SLACK_INIT] Missing required Slack environment variables: ${slackEnv.missing.join(', ')}`);
}

// Initialize Slack client with extensive logging
console.log('[SLACK_INIT] Initializing Slack WebClient');
const webClient = new WebClient(SLACK_BOT_TOKEN);
console.log('[SLACK_INIT] WebClient initialized');

// Cache for bot ID to avoid repeated API calls
let botUserIdCache: string | null = null;

// Get bot user ID (with caching)
async function getBotUserId(): Promise<string> {
  console.log('[SLACK_AUTH] Getting bot user ID');
  if (botUserIdCache) {
    console.log(`[SLACK_AUTH] Using cached bot ID: ${botUserIdCache}`);
    return botUserIdCache;
  }

  try {
    const botInfo = await webClient.auth.test();
    botUserIdCache = botInfo.user_id as string;
    console.log(`[SLACK_AUTH] Got and cached bot ID: ${botUserIdCache}`);
    return botUserIdCache;
  } catch (error) {
    console.error('[SLACK_AUTH] Failed to get bot ID:', error);
    throw error;
  }
}

// Rate limiting implementation
interface RateLimitData {
  count: number;
  lastResetTime: number;
}

// In-memory rate limit store
const userRateLimits: Map<string, RateLimitData> = new Map();
const MAX_REQUESTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
console.log(`[SLACK_CONFIG] Rate limit config: ${MAX_REQUESTS_PER_MINUTE} requests per ${RATE_LIMIT_WINDOW_MS/1000} seconds`);

// Rate limiting function
function checkRateLimit(userId: string): boolean {
  console.log(`[RATE_LIMIT] Checking rate limit for user ${userId}`);
  const now = Date.now();
  const userData = userRateLimits.get(userId);

  if (!userData) {
    // First request from this user
    console.log(`[RATE_LIMIT] First request from user ${userId}`);
    userRateLimits.set(userId, {
      count: 1,
      lastResetTime: now,
    });
    return true;
  }

  // Check if we need to reset the window
  if (now - userData.lastResetTime > RATE_LIMIT_WINDOW_MS) {
    console.log(`[RATE_LIMIT] Resetting window for user ${userId}`);
    userRateLimits.set(userId, {
      count: 1,
      lastResetTime: now,
    });
    return true;
  }

  // Check if user has exceeded the rate limit
  if (userData.count >= MAX_REQUESTS_PER_MINUTE) {
    console.log(`[RATE_LIMIT] User ${userId} has exceeded rate limit: ${userData.count}/${MAX_REQUESTS_PER_MINUTE}`);
    return false;
  }

  // Increment the count
  userData.count += 1;
  userRateLimits.set(userId, userData);
  console.log(`[RATE_LIMIT] User ${userId} request count: ${userData.count}/${MAX_REQUESTS_PER_MINUTE}`);
  return true;
}

// Verify Slack request signature
function verifySlackRequest(
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  console.log('[SLACK_VERIFY] Verifying Slack request signature');
  if (!signature || !timestamp) {
    console.error('[SLACK_VERIFY] Missing signature or timestamp');
    return false;
  }

  if (!SLACK_SIGNING_SECRET) {
    console.error('[SLACK_VERIFY] SLACK_SIGNING_SECRET not set');
    return false;
  }

  // Check if the timestamp is too old (more than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    console.error(`[SLACK_VERIFY] Timestamp too old: ${timestamp}, current: ${currentTime}`);
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex')}`;

  try {
    const isValid = timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
    console.log(`[SLACK_VERIFY] Signature verification: ${isValid ? 'success' : 'failed'}`);
    return isValid;
  } catch (e) {
    console.error('[SLACK_VERIFY] Error during signature verification:', e);
    return false;
  }
}

// Process Slack message and handle RAG response
async function processSlackMessage(event: any, isAppMention = false) {
  const eventId = event.event_ts;
  const processingId = `direct-${eventId.substring(0, 8)}`;

  try {
    // Skip if message is from a bot (prevent loops)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log(`[PROCESS:${processingId}] Ignoring message from a bot`);
      return;
    }
    
    const userId = event.user;
    const channelId = event.channel || '';
    const threadTs = event.thread_ts || event.ts;
    
    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`[PROCESS:${processingId}] User ${userId} hit rate limit, sending notification`);
      
      await webClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again."
      });
      return;
    }
    
    // Extract question text
    let questionText = '';
    if (!event.text) {
      console.log(`[PROCESS:${processingId}] Warning: event.text is undefined or null`);
      questionText = "[No text provided]";
    } else {
      // For app_mention, extract text by removing the bot mention
      if (isAppMention) {
        const botUserId = await getBotUserId();
        const mentionTag = `<@${botUserId}>`;
        questionText = event.text.replace(mentionTag, '').trim();
      } else {
        questionText = event.text.trim();
      }
    }

    console.log(`[PROCESS:${processingId}] Processing message for user ${userId} with text: "${questionText.substring(0, 30)}..."`);

    // If we don't have valid text or channel, we can't proceed
    if (questionText === "[No text provided]" || !channelId) {
      console.error(`[PROCESS:${processingId}] Cannot process message: ${!channelId ? 'Missing channelId' : 'No text provided'}`);
      return;
    }

    // Send "Thinking..." message
    console.log(`[PROCESS:${processingId}] Sending initial thinking message`);
    const initialResponse = await webClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "Thinking...",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Thinking..."
          }
        }
      ]
    });

    const messageTs = initialResponse.ts as string;
    console.log(`[PROCESS:${processingId}] Initial message sent with ts: ${messageTs}`);

    // Process with RAG
    try {
      console.log(`[PROCESS:${processingId}] Querying RAG system`);
      const answer = await queryRag(questionText);
      
      // Update the message with the answer
      console.log(`[PROCESS:${processingId}] Updating message with RAG answer`);
      await webClient.chat.update({
        channel: channelId,
        ts: messageTs,
        text: answer, // Fallback text for notifications
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: answer
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "This response was generated by AI and may not be completely accurate. Please verify any important information."
              }
            ]
          }
        ]
      });
      
      console.log(`[PROCESS:${processingId}] Message successfully updated with answer`);
    } catch (ragError) {
      console.error(`[PROCESS:${processingId}] Error during RAG processing:`, ragError);
      
      // Update with error message
      try {
        await webClient.chat.update({
          channel: channelId,
          ts: messageTs,
          text: "I'm sorry, I encountered an error while processing your question. Please try again later."
        });
      } catch (updateError) {
        console.error(`[PROCESS:${processingId}] Error updating message with error:`, updateError);
      }
    }
  } catch (error) {
    console.error(`[PROCESS:${processingId}] Error in message processing:`, error);
    
    // Attempt to send an error message
    try {
      if (event.channel) {
        await webClient.chat.postMessage({
          channel: event.channel,
          text: "I encountered an error while processing your message. Please try again later."
        });
      }
    } catch (msgError) {
      console.error(`[PROCESS:${processingId}] Error sending error message:`, msgError);
    }
  }
}

// Main request handler
export async function POST(request: Request) {
  console.log('[SLACK_POST] Received Slack API request');
  
  try {
    // Get the raw request body
    const rawBody = await request.text();
    console.log('[SLACK_POST] Got raw request body');
    let body;
    
    try {
      body = JSON.parse(rawBody);
      console.log('[SLACK_POST] Parsed request body successfully', { type: body.type });
    } catch (err) {
      console.error('[SLACK_POST] Failed to parse request body:', err);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Handle URL verification challenge immediately
    if (body.type === 'url_verification') {
      console.log('[SLACK_POST] Handling URL verification challenge');
      return NextResponse.json({ challenge: body.challenge });
    }

    // Verify the request signature (except for URL verification)
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');
    console.log('[SLACK_POST] Verifying request signature', { timestamp });
    
    if (!verifySlackRequest(rawBody, signature, timestamp)) {
      console.error('[SLACK_POST] Failed to verify Slack request signature');
      return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
    }
    console.log('[SLACK_POST] Request signature verified successfully');

    // Process according to event type
    if (body.type === 'event_callback') {
      console.log('[SLACK_POST] Processing event callback', { event_type: body.event?.type });
      
      // CRITICAL: Acknowledge receipt immediately
      const response = NextResponse.json({ ok: true });
      
      // Process the event asynchronously after responding
      if (body.event.type === 'app_mention') {
        console.log('[SLACK_POST] Starting background processing for app_mention');
        
        // Use setTimeout with 0 delay to ensure this runs after the response is sent
        setTimeout(() => {
          processSlackMessage(body.event, true)
            .catch(error => console.error('[SLACK_POST] Async error in app_mention handler:', error));
        }, 0);
      } else if (body.event.type === 'message') {
        console.log('[SLACK_POST] Starting background processing for message');
        
        // Use setTimeout with 0 delay to ensure this runs after the response is sent
        setTimeout(() => {
          processSlackMessage(body.event, false)
            .catch(error => console.error('[SLACK_POST] Async error in direct message handler:', error));
        }, 0);
      } else {
        console.log(`[SLACK_POST] Ignoring unsupported event type: ${body.event.type}`);
      }
      
      // Immediately respond to Slack to acknowledge receipt
      console.log('[SLACK_POST] Sending acknowledge response to Slack');
      return response;
    }
    
    // Handle other event types or return an error
    console.log(`[SLACK_POST] Unhandled request type: ${body.type}`);
    return NextResponse.json({ error: 'Unhandled request type' }, { status: 400 });
  } catch (error) {
    console.error('[SLACK_POST] Unhandled error in Slack POST handler:', error);
    if (error instanceof Error) {
      console.error('[SLACK_POST] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}