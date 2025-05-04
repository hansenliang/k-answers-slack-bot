import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { Redis } from '@upstash/redis';
import { slackMessageQueue } from '@/lib/jobQueue';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');

// Initialize Redis client
const redisUrl = process.env.UPSTASH_REDIS_URL || '';
const redisToken = process.env.UPSTASH_REDIS_TOKEN || '';

// Validate and fix URL format
let validRedisUrl = redisUrl;
if (!redisUrl.startsWith('https://') && redisUrl.includes('.upstash.io')) {
  validRedisUrl = `https://${redisUrl.replace(/^[\/]*/, '')}`;
  console.log(`[DIAGNOSTIC] Fixed Redis URL to include https:// protocol`);
} else if (!redisUrl.startsWith('https://') && redisUrl) {
  console.error(`[DIAGNOSTIC] Warning: Redis URL format may be invalid: ${redisUrl.substring(0, 8)}...`);
}

const redis = new Redis({
  url: validRedisUrl,
  token: redisToken,
});

// Get the deployment URL from environment variables
function getDeploymentUrl(request: Request): string {
  // First try explicit environment variables
  if (process.env.DEPLOYMENT_URL) {
    return process.env.DEPLOYMENT_URL;
  }
  
  // Then try Vercel-specific environment variables
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  // Try to extract from the request
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    console.error('Could not extract deployment URL from request:', e);
    return '';
  }
}

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
      deploymentUrl: getDeploymentUrl(request)
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
        platform: process.platform,
        maxDuration: 60 // Configured limit
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
        
      case 'test_redis_connection':
        try {
          // Basic Redis connection test
          const pingResult = await redis.ping();
          console.log(`[DIAGNOSTIC] Redis ping result: ${pingResult}`);
          
          return NextResponse.json({
            success: true,
            redisStatus: {
              ping: pingResult,
              url: redisUrl.substring(0, 10) + '...',
              tokenPresent: !!redisToken
            }
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Redis connection test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_queue_read':
        try {
          // Test queue read operations
          const queueLength = await redis.llen('queue:slack-message-queue:waiting');
          console.log(`[DIAGNOSTIC] Queue length: ${queueLength}`);
          
          // Try to peek at first few items
          let queueItems = [];
          if (queueLength > 0) {
            try {
              queueItems = await redis.lrange('queue:slack-message-queue:waiting', 0, 2);
              console.log(`[DIAGNOSTIC] First queue items:`, queueItems);
            } catch (peekError) {
              console.error('[DIAGNOSTIC] Error peeking at queue:', peekError);
            }
          }
          
          return NextResponse.json({
            success: true,
            queueStatus: {
              length: queueLength,
              items: queueItems,
              queueExists: queueLength !== null
            }
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Queue read test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_queue_write':
        try {
          // Test queue write operations
          const testMessage = {
            channelId: channel || 'test-channel',
            userId: 'test-user',
            questionText: message || 'This is a test message',
            eventTs: Date.now().toString()
          };
          
          console.log(`[DIAGNOSTIC] Attempting to enqueue test message:`, testMessage);
          
          // Try to directly push to Redis
          await redis.rpush('queue:slack-message-queue:waiting', JSON.stringify(testMessage));
          
          // Verify it was added
          const queueLength = await redis.llen('queue:slack-message-queue:waiting');
          
          return NextResponse.json({
            success: true,
            queueWriteStatus: {
              messageAdded: true,
              newLength: queueLength
            }
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Queue write test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_enqueue_message':
        try {
          // Test the actual enqueue function from jobQueue.ts
          if (!channel) {
            return NextResponse.json({ error: 'Missing channel parameter' }, { status: 400 });
          }
          
          console.log(`[DIAGNOSTIC] Testing enqueueSlackMessage with channel ${channel}`);
          
          const testJob = {
            channelId: channel,
            userId: 'test-user',
            questionText: message || 'This is a diagnostic test message',
            threadTs: undefined,
            eventTs: Date.now().toString()
          };
          
          // Import the function directly from jobQueue
          const { enqueueSlackMessage } = await import('@/lib/jobQueue');
          const enqueued = await enqueueSlackMessage(testJob);
          
          if (enqueued) {
            console.log(`[DIAGNOSTIC] Successfully enqueued test message`);
          } else {
            console.error(`[DIAGNOSTIC] Failed to enqueue test message`);
          }
          
          return NextResponse.json({
            success: enqueued,
            enqueuedJob: testJob
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Enqueue message test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_e2e':
        try {
          // End-to-end test: enqueue a message and trigger the worker
          if (!channel) {
            return NextResponse.json({ error: 'Missing channel parameter' }, { status: 400 });
          }
          
          console.log(`[DIAGNOSTIC] Running E2E test with channel ${channel}`);
          
          // Step 1: Enqueue a test message
          const testJob = {
            channelId: channel,
            userId: 'test-user',
            questionText: message || 'This is an end-to-end test message',
            threadTs: undefined,
            eventTs: Date.now().toString()
          };
          
          // Import the function directly from jobQueue
          const { enqueueSlackMessage } = await import('@/lib/jobQueue');
          const enqueued = await enqueueSlackMessage(testJob);
          
          if (!enqueued) {
            console.error(`[DIAGNOSTIC] E2E test failed at message enqueue step`);
            return NextResponse.json({
              success: false,
              error: 'Failed to enqueue test message'
            }, { status: 500 });
          }
          
          console.log(`[DIAGNOSTIC] E2E test: Message enqueued successfully`);
          
          // Step 2: Trigger the worker to process the message
          const workerUrl = new URL(request.url);
          workerUrl.pathname = '/api/slack/rag-worker';
          
          console.log(`[DIAGNOSTIC] E2E test: Triggering worker at ${workerUrl}`);
          
          const workerResponse = await fetch(workerUrl.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${process.env.WORKER_SECRET_KEY}`
            }
          });
          
          const workerData = await workerResponse.json();
          
          console.log(`[DIAGNOSTIC] E2E test: Worker response received:`, workerData);
          
          // Return the combined results
          return NextResponse.json({
            success: true,
            enqueueResult: { success: enqueued, job: testJob },
            workerResult: workerData
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] E2E test failed:', e);
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