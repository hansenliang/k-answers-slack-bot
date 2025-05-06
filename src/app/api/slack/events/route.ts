import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { timingSafeEqual, createHmac } from 'crypto';

// Set runtime to edge for faster response
export const runtime = 'edge';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Helper function to retry Slack API calls with exponential backoff
async function callSlackWithRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries = 1, // Reducing this to 1 retry to ensure we stay under the 3s limit
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
      
      // Simple backoff for edge function
      if (isRateLimit && error?.headers?.['retry-after']) {
        const retryAfter = parseInt(error.headers['retry-after'], 10) * 1000;
        await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 500))); // Cap at 500ms to stay under 3s
      } else {
        await new Promise(resolve => setTimeout(resolve, initialDelayMs));
      }
    }
  }
  
  throw lastError;
}

// Simple in-memory deduplication cache (will reset on server restart)
// Store event IDs with timestamp to expire old entries
const processedEvents = new Map<string, number>();
const EVENT_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

// Check if an event has already been processed
function isEventProcessed(eventId: string): boolean {
  return processedEvents.has(eventId);
}

// Mark an event as processed
function markEventProcessed(eventId: string): void {
  processedEvents.set(eventId, Date.now());
  
  // Clean up old entries inline (simpler for edge function)
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_EXPIRATION_MS) {
      processedEvents.delete(eventId);
    }
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

// Function to send the "thinking" message and process event
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
  
  // Check if Slack client is available
  if (!webClient) {
    console.error('[SLACK] Cannot process message: Slack client not initialized');
    return;
  }
  
  // Extract question text
  let questionText = '';
  try {
    if (isAppMention) {
      // For app mentions, extract the text (removing the mention)
      const botUserId = event.text.match(/<@([A-Z0-9]+)>/)?.[1];
      if (botUserId) {
        const mentionTag = `<@${botUserId}>`;
        questionText = event.text.replace(mentionTag, '').trim();
      } else {
        questionText = event.text.trim();
      }
    } else {
      questionText = event.text.trim();
    }
    
    if (!questionText) {
      console.log('[SLACK] Empty question after processing, skipping');
      return;
    }
  } catch (error) {
    console.error('[SLACK] Error extracting question text:', error);
    return;
  }
  
  try {
    // Send "thinking" message first to acknowledge within 3-second window
    let stubTS: string | undefined;
    try {
      const thinkingResponse = await callSlackWithRetry(() => webClient!.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "I'm searching the docs..." // Updated wording
      }));
      stubTS = thinkingResponse.ts as string;
    } catch (error) {
      console.error('[SLACK] Error sending thinking message:', error);
      // Continue without the thinking message
    }
    
    // Prepare event payload for worker
    const workerPayload = {
      userId,
      channelId,
      threadTs,
      eventTs: ts,
      questionText,
      stub_ts: stubTS,
      channel_type: event.channel_type,
      isAppMention,
      // Include response_url if available (for slash commands)
      response_url: event.response_url
    };
    
    // Use edge-compatible fetch for QStash instead of the Node client
    const res = await fetch("https://qstash.upstash.io/v1/publish", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
        "Content-Type": "application/json",
        "Upstash-Forward-Url": process.env.RAG_WORKER_URL!,
      },
      body: JSON.stringify(workerPayload),
    });
    
    if (!res.ok) {
      console.error("QStash publish failed", await res.text());
    } else {
      console.log('[SLACK] Successfully queued message for processing');
    }
  } catch (error) {
    console.error('[SLACK] Error enqueueing message:', error);
  }
}

// Main request handler
export async function POST(request: Request) {
  try {
    // Get the raw request body
    const rawBody = await request.text();
    let body;
    
    try {
      body = JSON.parse(rawBody);
    } catch (err) {
      console.error('[SLACK] Failed to parse request body:', err);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Handle URL verification challenge immediately
    if (body.type === 'url_verification') {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Verify the request signature
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
      
      // Process app_mention or message events (including DMs now)
      if (body.event.type === 'app_mention' || body.event.type === 'message') {
        const isAppMention = body.event.type === 'app_mention';
        
        // Start processing but don't await
        processMessage(body.event, isAppMention)
          .catch(error => console.error('[SLACK] Async processing error:', error));
      }
      
      // Immediately respond to Slack
      return response;
    }
    
    // Handle slash commands directly
    if (body.command) {
      // Acknowledge immediately for slash commands
      const response = NextResponse.json({ response_type: "in_channel", text: "I'm searching the docs..." });
      
      // Process the slash command asynchronously
      const payload = {
        userId: body.user_id,
        channelId: body.channel_id,
        response_url: body.response_url, // Slash commands provide a response_url
        questionText: body.text,
        command: body.command
      };
      
      // Queue up the job using QStash
      try {
        const res = await fetch("https://qstash.upstash.io/v1/publish", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
            "Content-Type": "application/json",
            "Upstash-Forward-Url": process.env.RAG_WORKER_URL!,
          },
          body: JSON.stringify(payload),
        });
        
        if (!res.ok) {
          console.error("QStash publish failed for slash command", await res.text());
        }
      } catch (error) {
        console.error('[SLACK] Error enqueueing slash command:', error);
      }
      
      return response;
    }
    
    // Handle other event types
    return NextResponse.json({ error: 'Unhandled request type' }, { status: 400 });
  } catch (error) {
    console.error('[SLACK] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}