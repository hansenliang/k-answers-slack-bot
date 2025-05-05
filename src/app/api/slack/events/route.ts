import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { timingSafeEqual, createHmac } from 'crypto';
import { enqueueSlackMessage } from '@/lib/jobQueue';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, validateSlackEnvironment, logEnvironmentStatus } from '@/lib/env';
import { Redis } from '@upstash/redis';

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

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL || '',
  token: process.env.UPSTASH_REDIS_TOKEN || '',
});

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

// Rate limiting configuration
const MAX_REQUESTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
console.log(`[SLACK_CONFIG] Rate limit config: ${MAX_REQUESTS_PER_MINUTE} requests per ${RATE_LIMIT_WINDOW_MS/1000} seconds`);

// Redis-based rate limiting function
async function checkRateLimit(userId: string): Promise<boolean> {
  console.log(`[RATE_LIMIT] Checking rate limit for user ${userId}`);
  
  try {
    const key = `rate:${userId}`;
    const count = await redis.incr(key);
    
    // Set expiry for 60 seconds if this is the first request
    if (count === 1) {
      await redis.expire(key, 60);
    }
    
    console.log(`[RATE_LIMIT] User ${userId} request count: ${count}/${MAX_REQUESTS_PER_MINUTE}`);
    
    // Check if user has exceeded the rate limit
    if (count > MAX_REQUESTS_PER_MINUTE) {
      console.log(`[RATE_LIMIT] User ${userId} has exceeded rate limit: ${count}/${MAX_REQUESTS_PER_MINUTE}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`[RATE_LIMIT] Error checking rate limit for user ${userId}:`, error);
    // Default to allowing the request if rate limiting fails
    return true;
  }
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

// Process Slack message by enqueueing it for RAG processing
async function processSlackMessage(event: any, isAppMention = false, requestUrl?: string): Promise<boolean> {
  const eventId = event.event_ts;
  const processingId = `direct-${eventId.substring(0, 8)}`;

  try {
    // Skip if message is from a bot (prevent loops)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log(`[PROCESS:${processingId}] Ignoring message from a bot`);
      return false;
    }
    
    const userId = event.user;
    const channelId = event.channel || '';
    const threadTs = event.thread_ts || event.ts;
    
    // Check rate limit
    if (!await checkRateLimit(userId)) {
      console.log(`[PROCESS:${processingId}] User ${userId} hit rate limit, sending notification`);
      
      await webClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again."
      });
      return false;
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
      return false;
    }

    // Check if this event has already been processed (deduplication)
    const eventKey = `event:${event.ts}`;
    const isNewEvent = await redis.setnx(eventKey, 1);
    if (!isNewEvent) {
      console.log(`[PROCESS:${processingId}] Skipping duplicate event ${event.ts}`);
      return true; // Return true to indicate successful handling (by skipping)
    }
    
    // Set expiry for the event key (5 minutes)
    await redis.expire(eventKey, 300);

    // Enqueue the Slack message for processing
    console.log(`[PROCESS:${processingId}] Enqueueing message for processing`);
    await enqueueSlackMessage({
      channelId,
      userId,
      questionText,
      threadTs: event.thread_ts ?? event.ts,
      eventTs: event.ts,
      useStreaming: false
    });
    
    // Fire-and-forget trigger so the first job is processed immediately
    try {
      // Use a hardcoded production domain if in production, otherwise use the request URL
      const baseUrl = process.env.VERCEL_ENV === 'production' 
        ? 'https://k-answers-bot.vercel.app' 
        : requestUrl 
          ? new URL(requestUrl).origin 
          : process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3000';
      
      // IMPORTANT: Use WORKER_SECRET_KEY which is what the worker endpoint checks for
      const workerSecret = process.env.WORKER_SECRET_KEY || '';
      
      if (!workerSecret) {
        console.warn(`[PROCESS:${processingId}] WORKER_SECRET_KEY environment variable is not set`);
      }
      
      console.log(`[PROCESS:${processingId}] Triggering worker at ${baseUrl}/api/slack/rag-worker`);
      
      // Don't await the fetch - fire and forget
      fetch(`${baseUrl}/api/slack/rag-worker?key=${workerSecret}`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trigger-Source': 'slack_events'
        }
      })
      .then(response => {
        if (!response.ok) {
          console.error(`[PROCESS:${processingId}] Worker trigger failed with status ${response.status}`);
          return response.text().then(text => {
            console.error(`[PROCESS:${processingId}] Worker error response: ${text}`);
          });
        } else {
          console.log(`[PROCESS:${processingId}] Worker successfully triggered with status ${response.status}`);
        }
      })
      .catch(error => {
        console.error(`[PROCESS:${processingId}] Error triggering worker:`, error);
      });
    } catch (triggerError) {
      console.error(`[PROCESS:${processingId}] Error triggering worker (non-blocking):`, triggerError);
    }
    
    return true;
  } catch (error) {
    console.error(`[PROCESS:${processingId}] Error in message processing:`, error);
    return false;
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
      
      // CRITICAL: Create response immediately to acknowledge receipt
      const response = NextResponse.json({ ok: true });
      
      // Enqueue the event asynchronously after responding - no setTimeout needed
      if (body.event.type === 'app_mention' || body.event.type === 'message') {
        const isAppMention = body.event.type === 'app_mention';
        console.log(`[SLACK_POST] Starting async processing for ${isAppMention ? 'app_mention' : 'message'}`);
        
        // Fire and forget - don't await the result to avoid blocking the response
        processSlackMessage(body.event, isAppMention, request.url)
          .catch(error => console.error(`[SLACK_POST] Async error in ${isAppMention ? 'app_mention' : 'message'} handler:`, error));
      } else {
        console.log(`[SLACK_POST] Ignoring unsupported event type: ${body.event.type}`);
      }
      
      // Immediately respond to Slack to acknowledge receipt
      console.log('[SLACK_POST] Sending acknowledge response to Slack');
      return response; // CRITICAL FIX: Return the response object
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