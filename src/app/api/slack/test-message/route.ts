import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';

// Define the runtime as nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

// Main handler - simple endpoint for testing Slack messaging
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Get request parameters
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channel');
    const text = url.searchParams.get('text') || 'Test message from direct endpoint';
    
    if (!channelId) {
      return NextResponse.json({ error: 'Missing channel parameter' }, { status: 400 });
    }
    
    // Log environment details
    console.log('[TEST_MSG] Environment check:');
    console.log(`[TEST_MSG] SLACK_BOT_TOKEN present: ${!!process.env.SLACK_BOT_TOKEN}`);
    console.log(`[TEST_MSG] SLACK_BOT_TOKEN length: ${process.env.SLACK_BOT_TOKEN?.length || 0}`);
    console.log(`[TEST_MSG] WebClient initialized: ${!!webClient}`);
    
    // Check if client is available
    if (!webClient) {
      return NextResponse.json({ 
        error: 'Slack client not initialized. Check SLACK_BOT_TOKEN environment variable.' 
      }, { status: 500 });
    }
    
    console.log(`[TEST_MSG] Attempting to send direct message to channel ${channelId}`);
    
    // Send a test message
    const result = await webClient.chat.postMessage({
      channel: channelId,
      text: text,
      unfurl_links: false,
      unfurl_media: false
    });
    
    console.log(`[TEST_MSG] Message sent successfully to channel ${result.channel}, ts: ${result.ts}`);
    
    // Return success
    return NextResponse.json({
      status: 'success',
      message: 'Slack message sent successfully',
      result: {
        channel: result.channel,
        ts: result.ts,
        text: text
      }
    });
  } catch (error) {
    // Detailed error logging for debugging
    console.error('[TEST_MSG] Error sending Slack message:', error);
    
    if (error && typeof error === 'object') {
      const errorObj = error as any;
      console.error('[TEST_MSG] Error details:');
      console.error(`[TEST_MSG] Name: ${errorObj.name}`);
      console.error(`[TEST_MSG] Message: ${errorObj.message}`);
      
      if (errorObj.data) {
        console.error(`[TEST_MSG] Error data:`, errorObj.data);
      }
      
      if (errorObj.code) {
        console.error(`[TEST_MSG] Error code: ${errorObj.code}`);
      }
    }
    
    // Return error response
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 