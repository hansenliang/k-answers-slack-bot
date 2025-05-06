import { NextResponse } from 'next/server';

// Set runtime to nodejs since we'll make external API calls
export const runtime = 'nodejs';

/**
 * This endpoint is for testing the Slack worker functionality directly
 * without going through QStash, to help isolate where failures occur.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    console.log('[DIRECT_TEST] Received test request', body);
    
    // Get the worker URL from environment or use hardcoded localhost for local testing
    const workerUrl = process.env.RAG_WORKER_URL || 'http://localhost:3000/api/slack/worker';
    
    // Construct a test message with debug tag
    const testPayload = {
      questionText: body.questionText || "What is Customer Hub? [direct-test]",
      channelId: body.channelId,
      stub_ts: body.stub_ts,
      threadTs: body.threadTs,
      channel_type: body.channel_type || "channel",
      eventTs: Date.now().toString(),
      isDebugTest: true
    };
    
    console.log('[DIRECT_TEST] Calling worker directly with payload:', testPayload);
    
    // Call the worker endpoint directly
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });
    
    const responseText = await workerResponse.text();
    
    // Return detailed information about the worker call
    return NextResponse.json({
      direct_call: {
        status: workerResponse.status,
        ok: workerResponse.ok,
        statusText: workerResponse.statusText,
        response: responseText,
      },
      test_payload: testPayload,
      worker_url: workerUrl,
    });
  } catch (error) {
    console.error('[DIRECT_TEST] Error in direct test:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}

// Also support GET requests with query parameters
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channel');
    const stubTs = url.searchParams.get('stub_ts');
    const questionText = url.searchParams.get('question') || "What is Customer Hub? [direct-test-get]";
    
    if (!channelId) {
      return NextResponse.json({ 
        error: 'Missing required parameter: channel', 
        usage: '/api/slack/direct-test?channel=C12345&stub_ts=1234567890.123456&question=Your question here'
      }, { status: 400 });
    }
    
    // Build test payload from query parameters
    const testPayload = {
      questionText,
      channelId,
      stub_ts: stubTs,
      channel_type: "channel",
      eventTs: Date.now().toString(),
      isDebugTest: true
    };
    
    // Get the worker URL from environment or use hardcoded localhost for local testing
    const workerUrl = process.env.RAG_WORKER_URL || 'http://localhost:3000/api/slack/worker';
    
    console.log('[DIRECT_TEST] GET request calling worker with:', testPayload);
    
    // Call the worker endpoint directly
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });
    
    const responseText = await workerResponse.text();
    
    // Return detailed information about the worker call
    return NextResponse.json({
      direct_call: {
        status: workerResponse.status,
        ok: workerResponse.ok,
        statusText: workerResponse.statusText,
        response: responseText,
      },
      test_payload: testPayload,
      worker_url: workerUrl,
    });
  } catch (error) {
    console.error('[DIRECT_TEST] Error in GET test:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
} 