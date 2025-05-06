import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

// Define the runtime as nodejs
export const runtime = 'nodejs';

// Store the last 20 events for debugging
const eventLog: any[] = [];
const MAX_EVENTS = 20;

// Verify Slack request signature
function verifySlackRequest(
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp) {
    console.error('[EVENT_LOG] Missing signature or timestamp');
    return false;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[EVENT_LOG] SLACK_SIGNING_SECRET not set');
    return false;
  }

  // Check timestamp age
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    console.error(`[EVENT_LOG] Timestamp too old: ${timestamp}, current: ${currentTime}`);
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
    console.log(`[EVENT_LOG] Signature verification: ${isValid ? 'success' : 'failed'}`);
    return isValid;
  } catch (e) {
    console.error('[EVENT_LOG] Error during signature verification:', e);
    return false;
  }
}

// Log the event and add it to our history
function logEvent(event: any, headers: any) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    headers,
    eventType: event.type,
    requestId: headers['x-slack-request-id'] || 'unknown'
  };
  
  // Add to our log, keeping only the most recent events
  eventLog.unshift(logEntry);
  if (eventLog.length > MAX_EVENTS) {
    eventLog.pop();
  }
  
  console.log(`[EVENT_LOG] Logged ${event.type} event, request ID: ${logEntry.requestId}`);
  return logEntry;
}

// Handle POST requests from Slack
export async function POST(request: Request) {
  console.log('[EVENT_LOG] Received Slack event');
  
  try {
    // Get and log all headers
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    console.log('[EVENT_LOG] Headers:', headers);
    
    // Get the raw request body
    const rawBody = await request.text();
    let parsedBody;
    
    try {
      parsedBody = JSON.parse(rawBody);
      console.log('[EVENT_LOG] Parsed body type:', parsedBody.type);
    } catch (err) {
      console.error('[EVENT_LOG] Failed to parse request body:', err);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Handle URL verification challenge
    if (parsedBody.type === 'url_verification') {
      console.log('[EVENT_LOG] Handling URL verification challenge');
      return NextResponse.json({ challenge: parsedBody.challenge });
    }

    // Verify request signature
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');
    
    if (!verifySlackRequest(rawBody, signature, timestamp)) {
      console.error('[EVENT_LOG] Invalid request signature');
      return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
    }

    // Log the event
    const logEntry = logEvent(parsedBody, headers);
    
    // Return success response to Slack
    return NextResponse.json({ ok: true, logged: true });
  } catch (error) {
    console.error('[EVENT_LOG] Error processing event:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle GET requests to retrieve logs
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limitedLog = eventLog.slice(0, Math.min(limit, MAX_EVENTS));
  
  return NextResponse.json({
    events: limitedLog,
    count: limitedLog.length,
    totalStored: eventLog.length
  });
} 