import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { timingSafeEqual, createHmac } from 'crypto';

// Define the runtime as nodejs
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

// Define interfaces for type safety
interface SlackConnectionSuccess {
  status: 'connected';
  botId: string;
  botName: string;
  team: string;
  teamId: string;
}

interface SlackConnectionError {
  status: 'error' | 'untested';
  error?: string;
}

type SlackConnection = SlackConnectionSuccess | SlackConnectionError;

// POST handler for testing direct processing
export async function POST(request: Request) {
  try {
    console.log('[DEBUG_EVENT] Received event for debugging');
    
    // Get all request headers for debugging
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    console.log('[DEBUG_EVENT] Headers:', JSON.stringify(headers));
    
    // Get raw body
    const rawBody = await request.text();
    console.log(`[DEBUG_EVENT] Raw body (${rawBody.length} bytes):`, rawBody.substring(0, 200));
    
    // Try to parse the body
    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
      console.log('[DEBUG_EVENT] Parsed event type:', parsedBody.type);
    } catch (parseError) {
      console.error('[DEBUG_EVENT] Failed to parse body:', parseError);
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    // Handle URL verification challenge
    if (parsedBody.type === 'url_verification') {
      console.log('[DEBUG_EVENT] Handling URL verification challenge');
      return NextResponse.json({ challenge: parsedBody.challenge });
    }
    
    // Verify request signature
    const signature = request.headers.get('x-slack-signature');
    const timestamp = request.headers.get('x-slack-request-timestamp');
    const verified = verifySignature(rawBody, signature, timestamp);
    
    console.log(`[DEBUG_EVENT] Signature verification: ${verified ? 'success' : 'failed'}`);
    
    // Extract channel and message details
    let channelId = null;
    let threadTs = null;
    let text = null;
    let userId = null;
    let eventType = null;
    
    if (parsedBody.type === 'event_callback' && parsedBody.event) {
      eventType = parsedBody.event.type;
      channelId = parsedBody.event.channel;
      userId = parsedBody.event.user;
      text = parsedBody.event.text;
      threadTs = parsedBody.event.thread_ts || parsedBody.event.ts;
    }
    
    console.log(`[DEBUG_EVENT] Extracted details: channel=${channelId}, user=${userId}, event=${eventType}`);
    
    // Test sending a direct response message if we have channel info
    let responseMessage = null;
    if (channelId && webClient) {
      try {
        console.log(`[DEBUG_EVENT] Sending direct debug response to channel ${channelId}`);
        const response = await webClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Debug response: I received a ${eventType} event from <@${userId}>`,
          unfurl_links: false
        });
        
        console.log(`[DEBUG_EVENT] Message sent successfully, ts: ${response.ts}`);
        responseMessage = { sent: true, ts: response.ts };
      } catch (sendError) {
        console.error('[DEBUG_EVENT] Failed to send response message:', sendError);
        responseMessage = { sent: false, error: sendError instanceof Error ? sendError.message : String(sendError) };
      }
    }
    
    // Return debug information
    return NextResponse.json({
      received: true,
      verified,
      eventType: parsedBody.type,
      innerEventType: eventType,
      channelId,
      userId,
      responseMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[DEBUG_EVENT] Error processing debug event:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// GET handler for checking configuration
export async function GET(request: Request) {
  try {
    // Check environment variables
    const envCheck = {
      slackTokenPresent: !!process.env.SLACK_BOT_TOKEN,
      slackTokenLength: process.env.SLACK_BOT_TOKEN?.length || 0,
      slackSigningSecretPresent: !!process.env.SLACK_SIGNING_SECRET,
      signSecretLength: process.env.SLACK_SIGNING_SECRET?.length || 0,
      webClientInitialized: !!webClient
    };
    
    // Check Slack API connection
    let slackConnection: SlackConnection = { status: 'untested' };
    if (webClient) {
      try {
        const authTest = await webClient.auth.test();
        slackConnection = {
          status: 'connected',
          botId: authTest.user_id as string,
          botName: authTest.user as string,
          team: authTest.team as string,
          teamId: authTest.team_id as string
        };
      } catch (apiError) {
        slackConnection = {
          status: 'error',
          error: apiError instanceof Error ? apiError.message : String(apiError)
        };
      }
    }
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      environment: envCheck,
      slackConnection,
      usage: {
        test: "Send a POST request to this endpoint with a Slack event JSON payload",
        docs: "https://api.slack.com/events-api#receiving_events"
      }
    });
  } catch (error) {
    console.error('[DEBUG_EVENT] Error in GET handler:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Helper function to verify Slack signature
function verifySignature(body: string, signature: string | null, timestamp: string | null): boolean {
  if (!signature || !timestamp) {
    return false;
  }
  
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return false;
  }
  
  // Check timestamp age (5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }
  
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex')}`;
  
  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch (e) {
    return false;
  }
} 