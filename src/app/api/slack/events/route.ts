import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { timingSafeEqual, createHmac } from 'crypto';
import { queryRag } from '@/lib/rag';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Helper function to retry Slack API calls with exponential backoff
async function callSlackWithRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 200
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      
      // Check if we should retry - only retry rate limits and certain network errors
      const isRateLimit = error?.data?.error === 'ratelimited';
      const shouldRetry = isRateLimit || 
                          error?.code === 'ETIMEDOUT' || 
                          error?.code === 'ECONNRESET' || 
                          error?.code === 'ECONNREFUSED';
                          
      if (!shouldRetry || attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = initialDelayMs * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4);
      
      // Use rate limit header if available
      if (isRateLimit && error?.headers?.['retry-after']) {
        const retryAfter = parseInt(error.headers['retry-after'], 10) * 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Simple in-memory deduplication cache (will reset on server restart)
// Store event IDs with timestamp to expire old entries
const processedEvents = new Map<string, number>();
const EVENT_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

// Clean up expired events periodically
setInterval(() => {
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_EXPIRATION_MS) {
      processedEvents.delete(eventId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

// Check if an event has already been processed
function isEventProcessed(eventId: string): boolean {
  return processedEvents.has(eventId);
}

// Mark an event as processed
function markEventProcessed(eventId: string): void {
  processedEvents.set(eventId, Date.now());
}

// Cache for bot ID to avoid repeated API calls
let botUserIdCache: string | null = null;

// Get bot user ID (with caching)
async function getBotUserId(): Promise<string> {
  console.log('[SLACK] Getting bot user ID');
  if (botUserIdCache) {
    return botUserIdCache;
  }

  try {
    if (!webClient) {
      throw new Error('Slack client not initialized');
    }
    
    const botInfo = await webClient.auth.test();
    botUserIdCache = botInfo.user_id as string;
    console.log(`[SLACK] Got and cached bot ID: ${botUserIdCache}`);
    return botUserIdCache;
  } catch (error) {
    console.error('[SLACK] Failed to get bot ID:', error);
    throw error;
  }
}

// Verify Slack request signature
function verifySlackRequest(
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp || !SLACK_SIGNING_SECRET) {
    return false;
  }

  // Check if timestamp is too old (more than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

// Rate limiting - simple in-memory implementation (resets on server restart)
const userRequests = new Map<string, { count: number, resetTime: number }>();
const MAX_REQUESTS_PER_MINUTE = 5;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userRecord = userRequests.get(userId);
  
  // Reset counter if time window has passed
  if (!userRecord || userRecord.resetTime < now) {
    userRequests.set(userId, { count: 1, resetTime: now + 60000 }); // 1 minute
    return true;
  }
  
  // Increment counter if within time window
  if (userRecord.count < MAX_REQUESTS_PER_MINUTE) {
    userRecord.count++;
    return true;
  }
  
  return false;
}

// Process Slack message directly
async function processMessage(event: any, isAppMention = false): Promise<void> {
  // Skip bot messages to prevent loops
  if (!event || event.bot_id || event.subtype === 'bot_message') {
    return;
  }
  
  // Validate required fields
  const userId = event.user;
  const channelId = event.channel;
  const ts = event.ts;
  
  if (!userId || !channelId || !ts || !event.text) {
    console.error('[SLACK] Missing required event fields', { userId, channelId, ts });
    return;
  }
  
  // Handle threading properly - if this is a threaded message, reply in the same thread
  const threadTs = event.thread_ts || event.ts;
  const isThreadedReply = !!event.thread_ts;
  
  // Check if Slack client is available
  if (!webClient) {
    console.error('[SLACK] Cannot process message: Slack client not initialized');
    return;
  }
  
  // Extract question text
  let questionText = '';
  try {
    if (isAppMention) {
      const botUserId = await getBotUserId();
      const mentionTag = `<@${botUserId}>`;
      questionText = event.text.replace(mentionTag, '').trim();
    } else {
      questionText = event.text.trim();
    }
    
    if (!questionText) {
      console.log('[SLACK] Empty question after processing, skipping');
      return;
    }
    
    console.log(`[SLACK] Processing message: "${questionText.substring(0, 30)}..."${isThreadedReply ? ' (thread reply)' : ''}`);
  } catch (error) {
    console.error('[SLACK] Error extracting question text:', error);
    return;
  }
  
  // Check rate limit
  if (!checkRateLimit(userId)) {
    try {
      await webClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "You've hit your rate limit (5 questions/min). Please wait a moment and try again."
      });
    } catch (rateLimitError) {
      console.error('[SLACK] Error sending rate limit message:', rateLimitError);
    }
    return;
  }
  
  // Unique ID for tracking this request in logs
  const requestId = `${userId.substring(0, 6)}-${Date.now().toString(36)}`;
  
  // Send "thinking" message first to acknowledge within 3-second window
  let thinkingMsgTs: string | undefined;
  try {
    const thinkingResponse = await webClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "I'm thinking about your question... (This may take a moment)"
    });
    thinkingMsgTs = thinkingResponse.ts as string;
    console.log(`[SLACK:${requestId}] Sent thinking message, ts: ${thinkingMsgTs}`);
  } catch (error) {
    console.error(`[SLACK:${requestId}] Error sending thinking message:`, error);
    // Continue processing even if acknowledgment fails
  }
  
  try {
    // Process the query directly - no queueing
    console.log(`[SLACK:${requestId}] Calling RAG with question: "${questionText.substring(0, 30)}..."`);
    const startTime = Date.now();
    const answer = await queryRag(questionText);
    const processingTime = Date.now() - startTime;
    console.log(`[SLACK:${requestId}] RAG processing completed in ${processingTime}ms`);
    
    // If we got a thinking message, update it instead of sending a new message
    if (thinkingMsgTs) {
      try {
        await webClient.chat.update({
          channel: channelId,
          ts: thinkingMsgTs,
          text: answer
        });
        console.log(`[SLACK:${requestId}] Updated thinking message with answer`);
        return;
      } catch (updateError) {
        console.error(`[SLACK:${requestId}] Failed to update thinking message:`, updateError);
        // Fall back to sending a new message
      }
    }
    
    // Send a new response if updating failed or we didn't send a thinking message
    await webClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: answer
    });
    
    console.log(`[SLACK:${requestId}] Successfully sent response`);
  } catch (error) {
    console.error(`[SLACK:${requestId}] Error processing message:`, error);
    
    // Notify user of error
    try {
      // If we have a thinking message, update it instead of sending a new one
      if (thinkingMsgTs) {
        await webClient.chat.update({
          channel: channelId,
          ts: thinkingMsgTs,
          text: "I'm sorry, I encountered an error while processing your request. Please try again later."
        });
      } else {
        await webClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: "I'm sorry, I encountered an error while processing your request. Please try again later."
        });
      }
    } catch (notifyError) {
      console.error(`[SLACK:${requestId}] Error sending error notification:`, notifyError);
    }
  }
}

// Main request handler
export async function POST(request: Request) {
  console.log('[SLACK] Received Slack API request');
  
  try {
    // Get the raw request body
    const rawBody = await request.text();
    let body;
    
    try {
      body = JSON.parse(rawBody);
      console.log('[SLACK] Parsed request body', { type: body.type });
    } catch (err) {
      console.error('[SLACK] Failed to parse request body:', err);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Handle URL verification challenge immediately
    if (body.type === 'url_verification') {
      console.log('[SLACK] Handling URL verification challenge');
      return NextResponse.json({ challenge: body.challenge });
    }

    // Verify the request signature (except for URL verification)
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');
    
    if (!verifySlackRequest(rawBody, signature, timestamp)) {
      console.error('[SLACK] Failed to verify Slack request signature');
      return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
    }
    
    // Check if Slack client is available
    if (!webClient) {
      console.error('[SLACK] Slack client not initialized');
      return NextResponse.json({ error: 'Slack client not initialized' }, { status: 500 });
    }

    // Process according to event type
    if (body.type === 'event_callback') {
      // Create response immediately to acknowledge receipt (Slack requires response within 3 seconds)
      const response = NextResponse.json({ ok: true });
      
      // Check if we've already processed this event (deduplication)
      const eventId = body.event_id || `${body.event?.ts || ''}-${body.event?.channel || ''}`;
      if (isEventProcessed(eventId)) {
        console.log(`[SLACK] Skipping duplicate event ${eventId}`);
        return response;
      }
      
      // Mark this event as processed
      markEventProcessed(eventId);
      
      // Only process app_mention or message events in channels (not DMs)
      if ((body.event.type === 'app_mention' || body.event.type === 'message') && 
          body.event.channel && !body.event.channel.startsWith('D')) {
        const isAppMention = body.event.type === 'app_mention';
        
        // Process the message asynchronously after responding
        setTimeout(() => {
          processMessage(body.event, isAppMention)
            .catch(error => console.error('[SLACK] Async processing error:', error));
        }, 10);
      }
      
      // Immediately respond to Slack
      return response;
    }
    
    // Handle other event types
    return NextResponse.json({ error: 'Unhandled request type' }, { status: 400 });
  } catch (error) {
    console.error('[SLACK] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}