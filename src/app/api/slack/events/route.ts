import { NextResponse } from 'next/server';

// Set runtime to edge for faster response
export const runtime = 'edge';

// Initialize constants
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Helper function to make Slack API requests directly using fetch
async function callSlackApi(
  method: string,
  params: Record<string, any>,
  retries = 1
): Promise<any> {
  const url = `https://slack.com/api/${method}`;
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify(params)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.ok) {
        // Handle rate limiting
        if (data.error === 'ratelimited') {
          if (attempt < retries) {
            // Get retry delay from headers or default to 1s
            const retryAfter = response.headers.get('Retry-After');
            const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1100;
            
            // Use a capped delay to ensure we don't wait too long in edge function
            const cappedDelay = Math.min(delayMs, 500);
            await new Promise(resolve => setTimeout(resolve, cappedDelay));
            continue;
          }
        }
        
        throw new Error(`Slack API error: ${data.error}`);
      }
      
      return data;
    } catch (error) {
      lastError = error;
      
      if (attempt === retries) {
        break;
      }
      
      // Simple backoff for non-rate-limit errors
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  throw lastError;
}

// Helper for creating HMAC signatures with Web Crypto API
async function createHmacSignature(secret: string, message: string): Promise<string> {
  // Convert secret and message to Uint8Array
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  // Import the key
  const key = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  
  // Sign the message
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  
  // Convert to hex string
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Compare two strings securely with timing-safe comparison
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
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
async function verifySlackRequest(
  body: string,
  signature: string | null,
  timestamp: string | null
): Promise<boolean> {
  if (!signature || !timestamp || !SLACK_SIGNING_SECRET) {
    return false;
  }

  // Check if timestamp is too old (more than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${await createHmacSignature(SLACK_SIGNING_SECRET, sigBasestring)}`;

  // Convert signatures to Uint8Arrays for comparison
  const encoder = new TextEncoder();
  const sig1 = encoder.encode(mySignature);
  const sig2 = encoder.encode(signature);
  
  return timingSafeEqual(sig1, sig2);
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
  
  // Check if Slack token is available
  if (!SLACK_BOT_TOKEN) {
    console.error('[SLACK] Cannot process message: SLACK_BOT_TOKEN not initialized');
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
      const thinkingResponse = await callSlackApi('chat.postMessage', {
        channel: channelId,
        thread_ts: threadTs,
        text: "I'm searching the docs..."
      });
      
      stubTS = thinkingResponse.ts;
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
    
    const signatureValid = await verifySlackRequest(rawBody, signature, timestamp);
    if (!signatureValid) {
      console.error('[SLACK] Failed to verify Slack request signature');
      return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
    }
    
    // Check if we have a Slack token
    if (!SLACK_BOT_TOKEN) {
      console.error('[SLACK] Slack token not configured');
      return NextResponse.json({ error: 'Slack token not configured' }, { status: 500 });
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