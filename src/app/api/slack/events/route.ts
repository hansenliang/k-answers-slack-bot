import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { createHmac, timingSafeEqual } from 'crypto';
import { enqueueSlackMessage } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

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

// Helper function to handle Slack message directly, bypassing the queue
async function handleDirectProcessing(event: any, isAppMention = false) {
  let userId, questionText = '';
  const eventId = event.event_ts;
  const processingId = `direct-${eventId.substring(0, 8)}`;

  try {
    userId = event.user;
    const channelId = event.channel || '';  // Ensure channelId is a string
    const threadTs = event.thread_ts || event.ts;

    // Check if text property exists before using it
    if (!event.text) {
      console.log(`[DIRECT_PROCESS:${processingId}] Warning: event.text is undefined or null`);
      // Set a default questionText for logging/debugging
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

    console.log(`[DIRECT_PROCESS:${processingId}] Processing message for user ${userId} with text: "${questionText.substring(0, 30)}..."`);

    // If we don't have valid text or channel, we can't proceed
    if (questionText === "[No text provided]" || !channelId) {
      console.error(`[DIRECT_PROCESS:${processingId}] Cannot process message: ${!channelId ? 'Missing channelId' : 'No text provided'}`);
      return false;
    }

    // Send "Thinking..." message and capture its timestamp for updating later
    console.log(`[DIRECT_PROCESS:${processingId}] Sending initial thinking message`);
    
    // Create message options with conditional thread_ts inclusion
    const messageOptions: any = {
      channel: channelId,
      text: "Thinking..."
    };
    
    // Only add thread_ts if it exists
    if (threadTs) {
      messageOptions.thread_ts = threadTs;
    }
    
    const initialResponse = await webClient.chat.postMessage(messageOptions);

    const messageTs = initialResponse.ts;
    console.log(`[DIRECT_PROCESS:${processingId}] Initial message sent with ts: ${messageTs}`);

    // Process the response with RAG in the background
    // We're not awaiting this to keep the request time short for Slack
    // Fix linter error by ensuring all parameters are strings
    const messageTimeStamp = messageTs || '';
    handleRagProcessing(questionText, channelId, messageTimeStamp)
      .catch(error => console.error(`[DIRECT_PROCESS:${processingId}] Error in background processing:`, error));

    return true;
  } catch (error) {
    console.error(`[DIRECT_PROCESS:${processingId}] Error in direct processing:`, error);
    
    // Try to send an error message if we have channelId
    try {
      if (event.channel) {
        await webClient.chat.postMessage({
          channel: event.channel,
          text: "I encountered an error while processing your message. Please try again later."
          // No thread_ts here - if we failed earlier, we may not have a valid threadTs
        });
      } else {
        console.error(`[DIRECT_PROCESS:${processingId}] Cannot send error message: Missing channelId`);
      }
    } catch (msgError) {
      console.error(`[DIRECT_PROCESS:${processingId}] Error sending error message:`, msgError);
    }
    
    return false;
  }
}

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
    
    console.log(`[APP_MENTION] Received app_mention from user ${userId} in channel ${channelId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`[APP_MENTION] User ${userId} hit rate limit, sending notification`);
      
      const threadTs = event.thread_ts || event.ts;
      const messageOptions: any = {
        channel: channelId,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again."
      };
      
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      }
      
      await webClient.chat.postMessage(messageOptions);
      console.log(`[APP_MENTION] Rate limit notification sent to user ${userId}`);
      return;
    }

    // Extract message text (remove the @mention part) 
    const botUserId = await getBotUserId();
    const mentionTag = `<@${botUserId}>`;
    const questionText = event.text.replace(mentionTag, '').trim();
    
    if (!questionText) {
      console.log(`[APP_MENTION] Empty question from user ${userId}, sending prompt`);
      
      const threadTs = event.thread_ts || event.ts;
      const messageOptions: any = {
        channel: channelId,
        text: "I didn't receive a question. Please try again with a question after the mention."
      };
      
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      }
      
      await webClient.chat.postMessage(messageOptions);
      console.log(`[APP_MENTION] Empty question notification sent to user ${userId}`);
      return;
    }

    // Process the message directly instead of using the queue
    console.log(`[APP_MENTION] Processing message directly for user ${userId}`);
    await handleDirectProcessing(event, true);
  } catch (error) {
    console.error('[APP_MENTION] Error handling app_mention event:', error);
    try {
      console.log(`[APP_MENTION] Attempting to send error message for event ${event.event_ts}`);
      
      const threadTs = event.thread_ts || event.ts;
      const messageOptions: any = {
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later."
      };
      
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      }
      
      await webClient.chat.postMessage(messageOptions);
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
      console.log('[DIRECT_MSG] Ignoring DM from a bot', { 
        bot_id: event.bot_id, 
        subtype: event.subtype
      });
      return;
    }

    const userId = event.user;
    console.log(`[DIRECT_MSG] Received DM from user ${userId} in channel ${event.channel}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`[DIRECT_MSG] User ${userId} hit rate limit, sending notification`);
      
      const threadTs = event.thread_ts;
      const messageOptions: any = {
        channel: event.channel,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again."
      };
      
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      }
      
      await webClient.chat.postMessage(messageOptions);
      console.log(`[DIRECT_MSG] Rate limit notification sent to user ${userId}`);
      return;
    }

    // Process the message directly instead of using the queue
    console.log(`[DIRECT_MSG] Processing message directly for user ${userId}`);
    await handleDirectProcessing(event, false);
  } catch (error) {
    console.error('[DIRECT_MSG] Error handling direct message event:', error);
    try {
      console.log(`[DIRECT_MSG] Attempting to send error message for event ${event.event_ts}`);
      await webClient.chat.postMessage({
        channel: event.channel,
        text: "I encountered an error while processing your question. Please try again later."
      });
      console.log(`[DIRECT_MSG] Error message sent for event ${event.event_ts}`);
    } catch (postError) {
      console.error('[DIRECT_MSG] Failed to send error message:', postError);
    }
  }
};

// Function to handle the RAG processing and update the message when done
async function handleRagProcessing(questionText: string, channelId: string, messageTs: string) {
  const processingId = `rag-${Date.now().toString().substring(0, 8)}`;
  
  try {
    console.log(`[RAG_PROCESS:${processingId}] Starting RAG processing for question: "${questionText.substring(0, 30)}..."`);
    
    // Get the answer from RAG
    const startTime = Date.now();
    const answer = await queryRag(questionText);
    const processingTime = Date.now() - startTime;
    
    console.log(`[RAG_PROCESS:${processingId}] RAG processing completed in ${processingTime}ms`);
    
    // Update the original "Thinking..." message with the answer
    console.log(`[RAG_PROCESS:${processingId}] Updating message with answer`);
    await webClient.chat.update({
      channel: channelId,
      ts: messageTs,
      text: answer
    });
    
    console.log(`[RAG_PROCESS:${processingId}] Message successfully updated with answer`);
    return true;
  } catch (error) {
    console.error(`[RAG_PROCESS:${processingId}] Error during RAG processing:`, error);
    
    // Try to update the message with an error
    try {
      await webClient.chat.update({
        channel: channelId,
        ts: messageTs,
        text: "I'm sorry, I encountered an error while processing your question. Please try again later."
      });
    } catch (updateError) {
      console.error(`[RAG_PROCESS:${processingId}] Error updating message with error:`, updateError);
    }
    
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
      
      // CRITICAL: Prepare the response first to send it back to Slack quickly
      const response = NextResponse.json({ ok: true });
      
      // Process the event asynchronously after sending the response
      if (event.type === 'app_mention') {
        // Fire and forget - don't block the response to Slack
        console.log('[SLACK_POST] Starting background processing for app_mention');
        
        // Use setTimeout with 0 delay to ensure this runs after the response is sent
        setTimeout(() => {
          handleAppMention(event)
            .catch(error => console.error('[SLACK_POST] Async error in app_mention handler:', error));
        }, 0);
      } else if (event.type === 'message') {
        // Fire and forget - don't block the response to Slack
        console.log('[SLACK_POST] Starting background processing for message');
        
        // Use setTimeout with 0 delay to ensure this runs after the response is sent
        setTimeout(() => {
          handleDirectMessage(event)
            .catch(error => console.error('[SLACK_POST] Async error in direct message handler:', error));
        }, 0);
      } else {
        console.log(`[SLACK_POST] Ignoring unsupported event type: ${event.type}`);
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