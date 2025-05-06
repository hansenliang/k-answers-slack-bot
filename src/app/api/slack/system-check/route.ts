import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { Redis } from '@upstash/redis';

// Define the runtime as nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

// Function to check Slack API
async function checkSlackAPI(): Promise<{status: string, details: any}> {
  try {
    console.log('[SYS_CHECK] Testing Slack API connection');
    
    // Check if client is available
    if (!webClient) {
      console.error('[SYS_CHECK] Slack client not initialized');
      return { 
        status: 'error', 
        details: { error: 'Slack client not initialized. Check SLACK_BOT_TOKEN.' } 
      };
    }
    
    // Try to get bot info
    const authResult = await webClient.auth.test();
    console.log(`[SYS_CHECK] Slack auth test successful. Bot ID: ${authResult.user_id}, Team: ${authResult.team}`);
    
    return {
      status: 'ok',
      details: {
        team: authResult.team,
        teamId: authResult.team_id,
        botId: authResult.user_id,
        url: authResult.url
      }
    };
  } catch (error) {
    console.error('[SYS_CHECK] Slack API check failed:', error);
    
    return {
      status: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code || 'unknown'
      }
    };
  }
}

// Function to check Redis connection
async function checkRedis(): Promise<{status: string, details: any}> {
  try {
    console.log('[SYS_CHECK] Testing Redis connection');
    
    // Check environment variables
    const redisUrl = process.env.UPSTASH_REDIS_URL;
    const redisToken = process.env.UPSTASH_REDIS_TOKEN;
    
    if (!redisUrl || !redisToken) {
      console.error('[SYS_CHECK] Redis credentials missing');
      return {
        status: 'error',
        details: {
          error: 'Redis credentials missing',
          urlPresent: !!redisUrl,
          tokenPresent: !!redisToken
        }
      };
    }
    
    // Fix URL if needed
    const fixedUrl = redisUrl.startsWith('https://') 
      ? redisUrl 
      : redisUrl.includes('.upstash.io') 
        ? `https://${redisUrl.replace(/^[\/]*/, '')}` 
        : redisUrl;
    
    console.log(`[SYS_CHECK] Using Redis URL: ${fixedUrl.substring(0, 12)}...`);
    
    // Create Redis client
    const redis = new Redis({
      url: fixedUrl,
      token: redisToken,
      automaticDeserialization: false
    });
    
    // Try ping
    const pingResult = await redis.ping();
    console.log(`[SYS_CHECK] Redis ping successful: ${pingResult}`);
    
    // Try set/get
    const testKey = `test:${Date.now()}`;
    await redis.set(testKey, 'test-value');
    const testValue = await redis.get(testKey);
    console.log(`[SYS_CHECK] Redis set/get test: ${testValue === 'test-value' ? 'success' : 'failure'}`);
    
    // Check queue
    const queueSize = await redis.llen('queue:slack-message-queue:waiting');
    const processingSize = await redis.llen('queue:slack-message-queue:processing');
    console.log(`[SYS_CHECK] Queue sizes - waiting: ${queueSize}, processing: ${processingSize}`);
    
    // Clean up
    await redis.del(testKey);
    
    return {
      status: 'ok',
      details: {
        pingResponse: pingResult,
        getSetTest: testValue === 'test-value' ? 'success' : 'failure',
        queueSize,
        processingSize,
        redisUrlFormat: fixedUrl.startsWith('https://') ? 'valid' : 'invalid'
      }
    };
  } catch (error) {
    console.error('[SYS_CHECK] Redis check failed:', error);
    
    return {
      status: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// Function to check Vercel environment
function checkEnvironment(): {status: string, details: any} {
  try {
    const envDetails = {
      nodeEnv: process.env.NODE_ENV || 'unknown',
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
      region: process.env.VERCEL_REGION || 'unknown',
      slackBotTokenPresent: !!process.env.SLACK_BOT_TOKEN,
      slackSigningSecretPresent: !!process.env.SLACK_SIGNING_SECRET,
      redisUrlPresent: !!process.env.UPSTASH_REDIS_URL,
      redisTokenPresent: !!process.env.UPSTASH_REDIS_TOKEN,
      workerSecretPresent: !!process.env.WORKER_SECRET_KEY,
      openaiKeyPresent: !!process.env.OPENAI_API_KEY
    };
    
    console.log('[SYS_CHECK] Environment details:', envDetails);
    
    return {
      status: 'ok',
      details: envDetails
    };
  } catch (error) {
    console.error('[SYS_CHECK] Environment check failed:', error);
    
    return {
      status: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// Function to check worker endpoint
async function checkWorker(): Promise<{status: string, details: any}> {
  try {
    console.log('[SYS_CHECK] Testing worker endpoint');
    
    // Get base URL
    const baseUrl = process.env.VERCEL_ENV === 'production' 
      ? 'https://k-answers-bot.vercel.app' 
      : process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000';
    
    const workerSecret = process.env.WORKER_SECRET_KEY || '';
    
    if (!workerSecret) {
      console.warn('[SYS_CHECK] WORKER_SECRET_KEY not set');
    }
    
    // Try to call worker endpoint
    console.log(`[SYS_CHECK] Calling worker at ${baseUrl}/api/slack/rag-worker`);
    
    const response = await fetch(`${baseUrl}/api/slack/rag-worker?key=${workerSecret}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trigger-Source': 'system-check'
      },
      body: JSON.stringify({ type: 'system_check', timestamp: Date.now() })
    });
    
    console.log(`[SYS_CHECK] Worker response status: ${response.status}`);
    
    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
      console.log('[SYS_CHECK] Worker response data:', responseData);
    } catch (parseError) {
      console.error('[SYS_CHECK] Failed to parse worker response:', parseError);
      responseData = { parseError: true, text: responseText.substring(0, 100) + '...' };
    }
    
    return {
      status: response.ok ? 'ok' : 'error',
      details: {
        statusCode: response.status,
        response: responseData
      }
    };
  } catch (error) {
    console.error('[SYS_CHECK] Worker check failed:', error);
    
    return {
      status: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// Function to test a simple message send 
async function testMessageSend(channelId?: string): Promise<{status: string, details: any}> {
  try {
    if (!channelId) {
      return {
        status: 'skipped',
        details: { reason: 'No channel ID provided' }
      };
    }
    
    if (!webClient) {
      return {
        status: 'error',
        details: { error: 'Slack client not initialized' }
      };
    }
    
    console.log(`[SYS_CHECK] Sending test message to channel ${channelId}`);
    
    // Send a test message
    const result = await webClient.chat.postMessage({
      channel: channelId,
      text: `System check test message (${new Date().toISOString()})`,
      unfurl_links: false,
      unfurl_media: false
    });
    
    console.log(`[SYS_CHECK] Message sent successfully, ts: ${result.ts}`);
    
    return {
      status: 'ok',
      details: {
        channel: result.channel,
        ts: result.ts
      }
    };
  } catch (error) {
    console.error('[SYS_CHECK] Message send test failed:', error);
    
    return {
      status: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code || 'unknown'
      }
    };
  }
}

// Main handler
export async function GET(request: Request): Promise<NextResponse> {
  try {
    console.log('[SYS_CHECK] Starting system check');
    
    // Get request parameters
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channel');
    const skipMessageTest = url.searchParams.get('skipMessage') === 'true';
    
    // Run all checks in parallel
    const [slackCheck, redisCheck, envCheck, workerCheck, messageTest] = await Promise.all([
      checkSlackAPI(),
      checkRedis(),
      checkEnvironment(),
      checkWorker(),
      skipMessageTest ? { status: 'skipped', details: { reason: 'Explicitly skipped' } } : testMessageSend(channelId || undefined)
    ]);
    
    // Determine overall system status
    const overallStatus = 
      slackCheck.status === 'error' || 
      redisCheck.status === 'error' || 
      workerCheck.status === 'error' ? 'error' : 'ok';
    
    // Return results
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      status: overallStatus,
      slack: slackCheck,
      redis: redisCheck,
      environment: envCheck,
      worker: workerCheck,
      messageTest: messageTest
    });
  } catch (error) {
    console.error('[SYS_CHECK] Unhandled error during system check:', error);
    
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 