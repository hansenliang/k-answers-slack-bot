import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { createHmac, timingSafeEqual } from 'crypto';
import { enqueueSlackMessage } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';

// Initialize Slack client
console.log('[SLACK_INIT] Initializing Slack WebClient');
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
console.log('[SLACK_INIT] WebClient initialized');

// Cache for bot ID
let botUserIdCache: string | null = null;

// Get bot user ID (with caching)
const getBotUserId = async (): Promise<string> => {
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
};

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
console.log(`[SLACK_CONFIG] Rate limit config: ${MAX_REQUESTS_PER_MINUTE} requests per ${RATE_LIMIT_WINDOW_MS/1000} seconds`);

// Rate limiting function
const checkRateLimit = (userId: string): boolean => {
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
};

// Verify Slack request signature
const verifySlackRequest = (
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean => {
  console.log('[SLACK_VERIFY] Verifying Slack request signature');
  if (!signature || !timestamp) {
    console.error('[SLACK_VERIFY] Missing signature or timestamp');
    return false;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
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
  const mySignature = `v0=${createHmac('sha256', signingSecret)
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
};

// Handle a mention in a public channel
const handleAppMention = async (event: any) => {
  console.log('[APP_MENTION] Starting to process app_mention event', { event_id: event.event_ts });
  try {
    // Skip if the message is from a bot (loop prevention)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('[APP_MENTION] Ignoring message from a bot', { bot_id: event.bot_id, subtype: event.subtype });
      return;
    }

    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    
    console.log(`[APP_MENTION] Received app_mention from user ${userId} in channel ${channelId}, thread_ts: ${threadTs}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`[APP_MENTION] User ${userId} hit rate limit, sending notification`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: threadTs,
      });
      console.log(`[APP_MENTION] Rate limit notification sent to user ${userId}`);
      return;
    }

    // Extract message text (remove the @mention part)
    console.log(`[APP_MENTION] Getting bot info to extract mention`);
    const botUserId = await getBotUserId();
    console.log(`[APP_MENTION] Bot user ID: ${botUserId}`);
    
    const mentionTag = `<@${botUserId}>`;
    const questionText = event.text.replace(mentionTag, '').trim();
    console.log(`[APP_MENTION] Extracted question text: "${questionText}"`);
    
    if (!questionText) {
      console.log(`[APP_MENTION] Empty question from user ${userId}, sending prompt`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: "I didn't receive a question. Please try again with a question after the mention.",
        thread_ts: threadTs,
      });
      console.log(`[APP_MENTION] Empty question notification sent to user ${userId}`);
      return;
    }

    // Send acknowledgment to user immediately
    console.log(`[APP_MENTION] Sending acknowledgment to user ${userId}`);
    await webClient.chat.postMessage({
      channel: channelId,
      text: "I'm processing your question. I'll be back shortly with an answer.",
      thread_ts: threadTs,
    });

    // Process the question in the background without waiting for it to complete
    console.log(`[APP_MENTION] Starting background processing for user ${userId}`);
    processQuestion(questionText, channelId, threadTs).catch(error => {
      console.error('[APP_MENTION] Background processing error:', error);
    });

    console.log(`[APP_MENTION] Successfully initiated background processing for ${userId}`);
  } catch (error) {
    console.error('[APP_MENTION] Error handling app_mention event:', error);
    try {
      console.log(`[APP_MENTION] Attempting to send error message for event ${event.event_ts}`);
      await webClient.chat.postMessage({
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later.",
        thread_ts: event.thread_ts || event.ts,
      });
      console.log(`[APP_MENTION] Error message sent for event ${event.event_ts}`);
    } catch (postError) {
      console.error('[APP_MENTION] Failed to send error message:', postError);
    }
  }
};

// Handle a direct message
const handleDirectMessage = async (event: any) => {
  console.log('[DIRECT_MSG] Starting to process direct message event', { event_id: event.event_ts });
  try {
    // Only process direct messages (channel_type === 'im')
    if (event.channel_type !== 'im') {
      console.log(`[DIRECT_MSG] Ignoring non-IM message of type ${event.channel_type}`);
      return;
    }
    
    // Skip if the message is from a bot (loop prevention)
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('[DIRECT_MSG] Ignoring DM from a bot', { bot_id: event.bot_id, subtype: event.subtype });
      return;
    }

    const userId = event.user;
    const channelId = event.channel;
    console.log(`[DIRECT_MSG] Received DM from user ${userId} in channel ${channelId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`[DIRECT_MSG] User ${userId} hit rate limit, sending notification`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again.",
        thread_ts: event.thread_ts,
      });
      console.log(`[DIRECT_MSG] Rate limit notification sent to user ${userId}`);
      return;
    }

    const questionText = event.text.trim();
    console.log(`[DIRECT_MSG] Extracted question text: "${questionText}"`);
    
    if (!questionText) {
      console.log(`[DIRECT_MSG] Empty question from user ${userId}, sending prompt`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: "I didn't receive a question. Please try again with a question.",
      });
      console.log(`[DIRECT_MSG] Empty question notification sent to user ${userId}`);
      return;
    }

    // Send acknowledgment to user immediately
    console.log(`[DIRECT_MSG] Sending acknowledgment to user ${userId}`);
    await webClient.chat.postMessage({
      channel: channelId,
      text: "I'm processing your question. I'll be back shortly with an answer.",
      thread_ts: event.thread_ts,
    });

    // Process the question in the background without waiting for it to complete
    console.log(`[DIRECT_MSG] Starting background processing for user ${userId}`);
    processQuestion(questionText, channelId, event.thread_ts).catch(error => {
      console.error('[DIRECT_MSG] Background processing error:', error);
    });

    console.log(`[DIRECT_MSG] Successfully initiated background processing for ${userId}`);
  } catch (error) {
    console.error('[DIRECT_MSG] Error handling direct message event:', error);
    try {
      console.log(`[DIRECT_MSG] Attempting to send error message for event ${event.event_ts}`);
      await webClient.chat.postMessage({
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later.",
      });
      console.log(`[DIRECT_MSG] Error message sent for event ${event.event_ts}`);
    } catch (postError) {
      console.error('[DIRECT_MSG] Failed to send error message:', postError);
    }
  }
};

// Process a question in the background
async function processQuestion(questionText: string, channelId: string, threadTs?: string): Promise<void> {
  try {
    console.log(`[PROCESS_Q] Processing question: "${questionText}"`);
    
    // Use a timeout to ensure the response doesn't get lost even if the 
    // serverless function times out. This effectively gives extra time.
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve("I'm still working on your question. Please wait a bit longer.");
      }, 5000); // 5 seconds
    });
    
    // Start the RAG query
    console.log(`[PROCESS_Q] Calling queryRag`);
    const ragPromise = queryRag(questionText);
    
    // Race between the timeout and the actual query
    const firstResponse = await Promise.race([timeoutPromise, ragPromise]);
    
    // If the first response is the timeout message, send it
    if (firstResponse === "I'm still working on your question. Please wait a bit longer.") {
      console.log(`[PROCESS_Q] Sending interim response while continuing to process`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: firstResponse,
        thread_ts: threadTs,
      });
      
      // Continue processing and send the final response when done
      console.log(`[PROCESS_Q] Continuing to wait for final response`);
      const finalAnswer = await ragPromise;
      console.log(`[PROCESS_Q] Got final answer, sending response`);
      
      await webClient.chat.postMessage({
        channel: channelId,
        text: finalAnswer,
        thread_ts: threadTs,
      });
    } else {
      // The RAG query completed before the timeout, so send the response
      console.log(`[PROCESS_Q] Sending final response directly`);
      await webClient.chat.postMessage({
        channel: channelId,
        text: firstResponse,
        thread_ts: threadTs,
      });
    }
    
    console.log(`[PROCESS_Q] Successfully processed question and sent response`);
  } catch (error) {
    console.error('[PROCESS_Q] Error processing question:', error);
    
    // Send error message to the user
    try {
      await webClient.chat.postMessage({
        channel: channelId,
        text: "I encountered an error while processing your question. Please try again later.",
        thread_ts: threadTs,
      });
      console.log(`[PROCESS_Q] Sent error notification`);
    } catch (postError) {
      console.error('[PROCESS_Q] Failed to send error message:', postError);
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

    // Handle URL verification challenge
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
      
      // Handle events according to their type
      const event = body.event;
      
      switch (event.type) {
        case 'app_mention':
          console.log('[SLACK_POST] Handling app_mention event');
          // Process in background without waiting for response
          handleAppMention(event).catch(error => 
            console.error('[SLACK_POST] Async error in app_mention handler:', error)
          );
          break;
          
        case 'message':
          console.log('[SLACK_POST] Handling message event');
          // Process direct messages in background
          handleDirectMessage(event).catch(error => 
            console.error('[SLACK_POST] Async error in direct message handler:', error)
          );
          break;
          
        default:
          console.log(`[SLACK_POST] Ignoring unsupported event type: ${event.type}`);
      }
      
      // Immediately respond to Slack to acknowledge receipt
      console.log('[SLACK_POST] Sending acknowledge response to Slack');
      return NextResponse.json({ ok: true });
    }
    
    // Handle other event types or return an error
    console.log(`[SLACK_POST] Unhandled request type: ${body.type}`);
    return NextResponse.json({ error: 'Unhandled request type' }, { status: 400 });
  } catch (error) {
    console.error('[SLACK_POST] Unhandled error in Slack POST handler:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 