import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { Redis } from '@upstash/redis';
import { slackMessageQueue } from '@/lib/jobQueue';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL || '',
  token: process.env.UPSTASH_REDIS_TOKEN || '',
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const auth = url.searchParams.get('auth');
    
    // Simple auth to prevent unauthorized access
    if (auth !== process.env.WORKER_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Test Slack connectivity
    let slackStatus = 'unknown';
    let botInfo = null;
    let error = null;
    
    try {
      botInfo = await slackClient.auth.test();
      slackStatus = 'connected';
    } catch (e) {
      slackStatus = 'error';
      error = e instanceof Error ? e.message : String(e);
    }

    // Get queue status
    let queueStatus = 'unknown';
    let queueStats = {};
    
    try {
      const queueInfo = await redis.llen('queue:slack-message-queue:waiting');
      queueStatus = 'connected';
      queueStats = {
        pendingJobs: queueInfo,
      };
    } catch (e) {
      queueStatus = 'error';
      error = e instanceof Error ? e.message : String(e);
    }
    
    // Get environment info
    const envInfo = {
      nodeEnv: process.env.NODE_ENV,
      hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasPinecone: !!process.env.PINECONE_API_KEY,
      hasUpstashRedis: !!process.env.UPSTASH_REDIS_URL && !!process.env.UPSTASH_REDIS_TOKEN,
      hasWorkerSecret: !!process.env.WORKER_SECRET_KEY,
    };
    
    // Return diagnostic information
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      slack: {
        status: slackStatus,
        botId: botInfo?.user_id || null,
        botName: botInfo?.user || null,
        team: botInfo?.team || null,
        error
      },
      queue: {
        status: queueStatus,
        stats: queueStats
      },
      environment: envInfo,
      runtime: {
        version: process.version,
        platform: process.platform
      }
    });
  } catch (error) {
    console.error('[DIAGNOSTIC] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Add a POST endpoint for testing Slack message posting and worker triggering
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const auth = url.searchParams.get('auth');
    
    // Simple auth to prevent unauthorized access
    if (auth !== process.env.WORKER_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const data = await request.json();
    const { action, channel, message } = data;
    
    // Handle different actions
    switch (action) {
      case 'send_test_message':
        if (!channel || !message) {
          return NextResponse.json({ error: 'Missing channel or message' }, { status: 400 });
        }
        
        try {
          const result = await slackClient.chat.postMessage({
            channel,
            text: `[TEST MESSAGE] ${message}`,
          });
          
          return NextResponse.json({
            success: true,
            messageTs: result.ts,
            channel: result.channel
          });
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'trigger_worker':
        try {
          // Make a fetch request to the worker endpoint
          const workerUrl = new URL(request.url);
          workerUrl.pathname = '/api/slack/rag-worker';
          
          const workerResponse = await fetch(workerUrl.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${process.env.WORKER_SECRET_KEY}`
            }
          });
          
          const workerData = await workerResponse.json();
          
          return NextResponse.json({
            success: true,
            workerResponse: workerData
          });
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[DIAGNOSTIC] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 