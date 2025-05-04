import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { Redis } from '@upstash/redis';
import { slackMessageQueue, enqueueSlackMessage, SlackMessageJob } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';
import { SLACK_BOT_TOKEN, validateSlackEnvironment, logEnvironmentStatus } from '@/lib/env';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

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

// Test sending a message to Slack
async function testSlackMessage(channel: string, text: string, thread_ts?: string) {
  console.log(`[DIAGNOSTIC] Testing Slack message to channel ${channel}`);
  
  if (!webClient) {
    throw new Error('Slack web client is not initialized');
  }
  
  const result = await webClient.chat.postMessage({
    channel,
    text,
    thread_ts,
    unfurl_links: false,
    unfurl_media: false,
  });
  
  return result;
}

// Test direct queue access
async function testDirectQueueAccess() {
  console.log('[DIAGNOSTIC] Testing direct queue access');
  
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL || '',
    token: process.env.UPSTASH_REDIS_TOKEN || '',
  });
  
  // Ping Redis to check connection
  const pingResult = await redis.ping();
  console.log(`[DIAGNOSTIC] Redis ping result: ${pingResult}`);
  
  // Check queue length
  const queueLength = await redis.llen('queue:slack-message-queue:waiting');
  console.log(`[DIAGNOSTIC] Current queue length: ${queueLength}`);
  
  // Look at queue contents
  let queueItems: string[] = [];
  if (queueLength > 0) {
    queueItems = await redis.lrange('queue:slack-message-queue:waiting', 0, queueLength - 1);
    console.log(`[DIAGNOSTIC] First queue item: ${queueItems[0] ? queueItems[0].substring(0, 100) + '...' : 'none'}`);
  }
  
  return {
    pingResult,
    queueLength,
    queueItems: queueItems.map(item => {
      try {
        return JSON.parse(item);
      } catch (e) {
        return { error: 'Failed to parse', raw: item.substring(0, 50) + '...' };
      }
    })
  };
}

// Test RAG functionality
async function testRag(question: string) {
  console.log(`[DIAGNOSTIC] Testing RAG with question: "${question}"`);
  const startTime = Date.now();
  
  try {
    const answer = await queryRag(question);
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      answer,
      duration_ms: duration
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime
    };
  }
}

// Test worker endpoint
async function testWorker(job?: SlackMessageJob) {
  console.log('[DIAGNOSTIC] Testing worker endpoint');
  
  const workerUrl = new URL(process.env.VERCEL_URL ? 
    `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  workerUrl.pathname = '/api/slack/rag-worker';
  
  const workerSecretKey = process.env.WORKER_SECRET_KEY || '';
  const url = `${workerUrl.origin}/api/slack/rag-worker?key=${workerSecretKey}`;
  
  let payload = {};
  if (job) {
    // If a job is provided, format a direct job processing request
    payload = {
      type: 'direct_job',
      job
    };
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerSecretKey}`
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }
    
    return {
      status: response.status,
      ok: response.ok,
      data: responseData
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Test the entire chain
async function testFullChain(channelId: string, questionText: string, userId: string = 'test-user') {
  console.log(`[DIAGNOSTIC] Testing full chain flow with question: "${questionText}"`);
  const startTime = Date.now();
  const results: any = { startTime };
  
  try {
    // Step 1: Create a job
    const job = {
      channelId,
      userId,
      questionText,
      threadTs: undefined,
      eventTs: Date.now().toString()
    };
    results.job = job;
    
    // Step 2: Enqueue the job
    results.enqueue = { startTime: Date.now() };
    try {
      const enqueued = await enqueueSlackMessage(job);
      results.enqueue.success = enqueued;
      results.enqueue.duration_ms = Date.now() - results.enqueue.startTime;
    } catch (enqueueError) {
      results.enqueue.success = false;
      results.enqueue.error = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      results.enqueue.duration_ms = Date.now() - results.enqueue.startTime;
    }
    
    // Step 3: Check queue state
    results.queueCheck = { startTime: Date.now() };
    try {
      const queueState = await testDirectQueueAccess();
      results.queueCheck.state = queueState;
      results.queueCheck.duration_ms = Date.now() - results.queueCheck.startTime;
    } catch (queueError) {
      results.queueCheck.success = false;
      results.queueCheck.error = queueError instanceof Error ? queueError.message : String(queueError);
      results.queueCheck.duration_ms = Date.now() - results.queueCheck.startTime;
    }
    
    // Step 4: Trigger worker directly
    results.workerTrigger = { startTime: Date.now() };
    try {
      const workerResponse = await testWorker(job);
      results.workerTrigger.response = workerResponse;
      results.workerTrigger.duration_ms = Date.now() - results.workerTrigger.startTime;
    } catch (workerError) {
      results.workerTrigger.success = false;
      results.workerTrigger.error = workerError instanceof Error ? workerError.message : String(workerError);
      results.workerTrigger.duration_ms = Date.now() - results.workerTrigger.startTime;
    }
    
    // Step 5: Test RAG directly (separately)
    results.ragTest = { startTime: Date.now() };
    try {
      const ragResponse = await testRag(questionText);
      results.ragTest.response = ragResponse;
      results.ragTest.duration_ms = Date.now() - results.ragTest.startTime;
    } catch (ragError) {
      results.ragTest.success = false;
      results.ragTest.error = ragError instanceof Error ? ragError.message : String(ragError);
      results.ragTest.duration_ms = Date.now() - results.ragTest.startTime;
    }
    
    results.totalDuration_ms = Date.now() - startTime;
    return results;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      results,
      totalDuration_ms: Date.now() - startTime
    };
  }
}

// Diagnostic interface
interface DiagnosticResult {
  environment: {
    status: 'valid' | 'invalid';
    missing: string[];
  };
  botConnection: {
    status: 'unknown' | 'connected' | 'error';
    teamName: string;
    botId: string;
    error: string | null;
  };
  timestamp: string;
}

// Diagnostic endpoint for testing Slack integration
export async function GET(): Promise<NextResponse<DiagnosticResult>> {
  console.log('[SLACK_DIAGNOSTIC] Running Slack API diagnostic');
  
  // Log full environment status
  logEnvironmentStatus();
  
  // Check Slack environment variables
  const slackEnv = validateSlackEnvironment();
  
  // Initialize diagnostic results
  const diagnosticResults: DiagnosticResult = {
    environment: {
      status: slackEnv.valid ? 'valid' : 'invalid',
      missing: slackEnv.missing
    },
    botConnection: {
      status: 'unknown',
      teamName: '',
      botId: '',
      error: null
    },
    timestamp: new Date().toISOString()
  };
  
  // If environment is invalid, return early
  if (!slackEnv.valid) {
    console.error(`[SLACK_DIAGNOSTIC] Invalid environment: missing ${slackEnv.missing.join(', ')}`);
    return NextResponse.json(diagnosticResults, { status: 500 });
  }
  
  // Test connection to Slack API
  try {
    console.log('[SLACK_DIAGNOSTIC] Testing Slack API connection');
    const webClient = new WebClient(SLACK_BOT_TOKEN);
    
    // Get bot and team info
    const authTest = await webClient.auth.test();
    console.log('[SLACK_DIAGNOSTIC] Slack API connection successful', authTest);
    
    // Update results
    diagnosticResults.botConnection = {
      status: 'connected',
      teamName: authTest.team as string,
      botId: authTest.user_id as string,
      error: null
    };
    
    return NextResponse.json(diagnosticResults);
  } catch (error) {
    console.error('[SLACK_DIAGNOSTIC] Slack API connection failed:', error);
    
    // Update results with error
    diagnosticResults.botConnection = {
      status: 'error',
      teamName: '',
      botId: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    
    return NextResponse.json(diagnosticResults, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const channel = searchParams.get('channel');
    const message = searchParams.get('message') || 'Test message from diagnostic endpoint';
    
    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    }
    
    switch (action) {
      case 'test_slack':
        try {
          if (!channel) {
            return NextResponse.json({ error: 'Missing channel parameter' }, { status: 400 });
          }
          
          console.log(`[DIAGNOSTIC] Testing Slack message to channel ${channel}`);
          const result = await testSlackMessage(channel, message);
          
          return NextResponse.json({
            success: true,
            result
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Slack test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_queue':
        try {
          console.log('[DIAGNOSTIC] Testing queue access');
          const queueResult = await testDirectQueueAccess();
          
          return NextResponse.json({
            success: true,
            queue: queueResult
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Queue test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_rag':
        try {
          console.log(`[DIAGNOSTIC] Testing RAG with message: "${message}"`);
          const ragResult = await testRag(message);
          
          return NextResponse.json({
            success: true,
            rag: ragResult
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] RAG test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_worker':
        try {
          console.log('[DIAGNOSTIC] Testing worker endpoint');
          const workerResult = await testWorker();
          
          return NextResponse.json({
            success: true,
            worker: workerResult
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Worker test failed:', e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return NextResponse.json({
            success: false,
            error: errorMessage
          }, { status: 500 });
        }
        
      case 'test_full_chain':
        try {
          if (!channel) {
            return NextResponse.json({ error: 'Missing channel parameter' }, { status: 400 });
          }
          
          console.log(`[DIAGNOSTIC] Testing full chain with message: "${message}"`);
          const chainResult = await testFullChain(channel, message);
          
          return NextResponse.json({
            success: true,
            chain: chainResult
          });
        } catch (e) {
          console.error('[DIAGNOSTIC] Full chain test failed:', e);
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
        
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[DIAGNOSTIC] Unhandled error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
} 