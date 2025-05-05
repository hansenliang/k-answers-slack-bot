import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { SlackMessageJob } from '@/lib/jobQueue';
import { WebClient } from '@slack/web-api';

// Define the runtime as nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

// Create a direct Redis client for operations
function createRedisClient() {
  const redisUrl = process.env.UPSTASH_REDIS_URL || '';
  const redisToken = process.env.UPSTASH_REDIS_TOKEN || '';
  
  // Fix URL if needed
  const fixedUrl = redisUrl.startsWith('https://') 
    ? redisUrl 
    : redisUrl.includes('.upstash.io')
      ? `https://${redisUrl.replace(/^[\/]*/, '')}`
      : redisUrl;
  
  console.log(`[FORCE_WORKER] Using Redis URL: ${fixedUrl.substring(0, 12)}...`);
  
  return new Redis({
    url: fixedUrl,
    token: redisToken,
    automaticDeserialization: false
  });
}

// Create a test job and add it directly to Redis
async function createTestJob(channelId: string): Promise<{success: boolean, job?: SlackMessageJob}> {
  try {
    const testJob: SlackMessageJob = {
      channelId,
      userId: 'force-worker',
      questionText: 'Test message from force-worker endpoint. If you see this, the queue and worker are functioning correctly.',
      eventTs: Date.now().toString(),
      useStreaming: false
    };
    
    console.log(`[FORCE_WORKER] Created test job for channel ${channelId}`);
    
    // Add to Redis queue directly
    const redis = createRedisClient();
    const serializedJob = JSON.stringify(testJob);
    const pushResult = await redis.rpush('queue:slack-message-queue:waiting', serializedJob);
    
    console.log(`[FORCE_WORKER] Direct Redis push result: ${pushResult}`);
    
    if (pushResult > 0) {
      return { success: true, job: testJob };
    } else {
      return { success: false };
    }
  } catch (error) {
    console.error('[FORCE_WORKER] Error creating test job:', error);
    return { success: false };
  }
}

// Trigger the worker to process the queue
async function triggerWorker(): Promise<{success: boolean, response?: any}> {
  try {
    const baseUrl = process.env.VERCEL_ENV === 'production' 
      ? 'https://k-answers-bot.vercel.app' 
      : process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000';
    
    const workerSecret = process.env.WORKER_SECRET_KEY || '';
    
    console.log(`[FORCE_WORKER] Triggering worker at ${baseUrl}/api/slack/rag-worker`);
    
    const response = await fetch(`${baseUrl}/api/slack/rag-worker?key=${workerSecret}`, { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trigger-Source': 'force-worker'
      },
      body: JSON.stringify({ type: 'force_worker', timestamp: Date.now() })
    });
    
    if (!response.ok) {
      console.error(`[FORCE_WORKER] Worker trigger failed with status ${response.status}`);
      const responseText = await response.text();
      console.error(`[FORCE_WORKER] Worker error response: ${responseText}`);
      return { success: false };
    }
    
    const responseData = await response.json();
    console.log(`[FORCE_WORKER] Worker trigger response:`, responseData);
    
    return { success: true, response: responseData };
  } catch (error) {
    console.error('[FORCE_WORKER] Error triggering worker:', error);
    return { success: false };
  }
}

// Check the Redis queue state
async function checkQueueState(): Promise<{queueSize: number, items: any[]}> {
  try {
    const redis = createRedisClient();
    
    // Check queue size
    const queueSize = await redis.llen('queue:slack-message-queue:waiting');
    console.log(`[FORCE_WORKER] Queue size: ${queueSize}`);
    
    // Get queue items for inspection (limited to 5)
    const items = [];
    if (queueSize > 0) {
      const rawItems = await redis.lrange('queue:slack-message-queue:waiting', 0, 4);
      
      for (const item of rawItems) {
        try {
          const parsed = JSON.parse(item);
          items.push({
            userId: parsed.userId,
            channelId: parsed.channelId,
            questionTextPreview: parsed.questionText?.substring(0, 30) + '...',
            timestamp: parsed.eventTs
          });
        } catch (parseError) {
          items.push({ rawItem: item.substring(0, 100) + '...' });
        }
      }
    }
    
    return { queueSize, items };
  } catch (error) {
    console.error('[FORCE_WORKER] Error checking queue state:', error);
    return { queueSize: -1, items: [] };
  }
}

// Main handler
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Check for authentication (optional)
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channel');
    const action = url.searchParams.get('action') || 'check';
    
    // Always check queue state
    const queueState = await checkQueueState();
    
    if (action === 'create-job' && channelId) {
      // Create a test job and add it to the queue
      const jobResult = await createTestJob(channelId);
      
      if (jobResult.success) {
        // Trigger the worker to process the job
        const workerResult = await triggerWorker();
        
        return NextResponse.json({
          status: 'success',
          action: 'create-job',
          job: jobResult.job,
          workerTriggered: workerResult.success,
          workerResponse: workerResult.response,
          queueState
        });
      } else {
        return NextResponse.json({
          status: 'error',
          message: 'Failed to create test job',
          queueState
        }, { status: 500 });
      }
    } else if (action === 'trigger-worker') {
      // Just trigger the worker
      const workerResult = await triggerWorker();
      
      return NextResponse.json({
        status: 'success',
        action: 'trigger-worker',
        workerTriggered: workerResult.success,
        workerResponse: workerResult.response,
        queueState
      });
    } else {
      // Just check queue state
      return NextResponse.json({
        status: 'success',
        action: 'check',
        queueState,
        usage: 'Use ?action=create-job&channel=CHANNEL_ID to create a test job and trigger the worker'
      });
    }
  } catch (error) {
    console.error('[FORCE_WORKER] Unhandled error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 