import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { slackMessageQueue } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';
import { SlackMessageJob } from '@/lib/jobQueue';
import { Redis } from '@upstash/redis';

// Define the runtime as nodejs to support fs, path, and other Node.js core modules
export const runtime = 'nodejs';

// Set maximum function duration in seconds
export const maxDuration = 60;

// Initialize Slack client
console.log('[WORKER_INIT] Initializing Slack WebClient');
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
console.log('[WORKER_INIT] WebClient initialized');

// Process a job from the queue
async function processJob(job: SlackMessageJob): Promise<boolean> {
  const startTime = Date.now();
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[WORKER:${jobId}] Starting to process job for user ${job.userId}, channel ${job.channelId}, text: "${job.questionText.substring(0, 30)}..."`);
  
  // Create a timeout promise outside to avoid variable reference issues
  const timeoutMs = 55000; // Set to 55 seconds to leave buffer for cleanup
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Processing timeout after 55 seconds'));
    }, timeoutMs);
  });

  // Set up interim message timeout
  let waitingMessageTimeoutId: NodeJS.Timeout | null = null;
  
  try {
    // Set up timeout for intermediate message (5 seconds)
    waitingMessageTimeoutId = setTimeout(async () => {
      try {
        console.log(`[WORKER:${jobId}] Sending interim message as processing is taking time`);
        await webClient.chat.postMessage({
          channel: job.channelId,
          text: "I'm still working on your question. Please wait a bit longer.",
          thread_ts: job.threadTs,
        });
        console.log(`[WORKER:${jobId}] Interim message sent successfully`);
      } catch (error) {
        console.error(`[WORKER:${jobId}] Failed to send interim message:`, error);
      }
    }, 5000);
    
    // The actual processing function
    const processingTask = async (): Promise<boolean> => {
      try {
        // Query the RAG system
        console.log(`[WORKER:${jobId}] Calling queryRag for message: "${job.questionText}"`);
        const answer = await queryRag(job.questionText);
        console.log(`[WORKER:${jobId}] Received answer from queryRag in ${Date.now() - startTime}ms, length: ${answer.length} chars`);
        
        // Send the response back to the user
        console.log(`[WORKER:${jobId}] Sending response to user ${job.userId} in channel ${job.channelId}`);
        const messageResult = await webClient.chat.postMessage({
          channel: job.channelId,
          text: answer,
          thread_ts: job.threadTs,
        });
        
        console.log(`[WORKER:${jobId}] Successfully sent response, message ts: ${messageResult.ts}`);
        return true;
      } catch (error) {
        console.error(`[WORKER:${jobId}] Error in processing task:`, error);
        throw error;
      }
    };
    
    // Race between the processing and timeout
    const result = await Promise.race([processingTask(), timeoutPromise]);
    
    return result as boolean;
  } catch (error) {
    console.error(`[WORKER:${jobId}] Error processing job:`, error);
    
    // Check if it's a timeout error
    const isTimeout = error instanceof Error && 
                      error.message.includes('timeout');
    
    try {
      // Notify the user of the error
      await webClient.chat.postMessage({
        channel: job.channelId,
        text: isTimeout 
          ? "I'm sorry, but processing your question took too long and timed out. Please try asking a more specific question."
          : "I encountered an error while processing your question. Please try again later.",
        thread_ts: job.threadTs,
      });
      console.log(`[WORKER:${jobId}] Sent ${isTimeout ? 'timeout' : 'error'} notification to user ${job.userId}`);
    } catch (postError) {
      console.error(`[WORKER:${jobId}] Failed to send error message:`, postError);
    }
    
    return false;
  } finally {
    // Clean up any timeouts
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (waitingMessageTimeoutId) {
      clearTimeout(waitingMessageTimeoutId);
    }
    console.log(`[WORKER:${jobId}] Job processing completed in ${Date.now() - startTime}ms`);
  }
}

// Check if there are more jobs in the queue
async function hasMoreJobs(): Promise<number> {
  try {
    // Access Redis directly to check queue size
    console.log('[WORKER] Checking queue size...');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL || '',
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    });
    
    const count = await redis.llen('queue:slack-message-queue:waiting');
    console.log(`[WORKER] Queue size check result: ${count} jobs remaining`);
    return count;
  } catch (error) {
    console.error('[WORKER] Error checking queue size:', error);
    if (error instanceof Error) {
      console.error(`[WORKER] Queue check error details: ${error.message}`);
    }
    return 0;
  }
}

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

// Trigger the worker to process the next job
async function triggerNextWorker(request: Request) {
  try {
    // Get deployment URL
    const baseUrl = getDeploymentUrl(request);
    const workerSecretKey = process.env.WORKER_SECRET_KEY || '';
    
    if (!baseUrl) {
      console.error('[WORKER] Cannot trigger next worker: No deployment URL found');
      return;
    }
    
    if (!workerSecretKey) {
      console.error('[WORKER] Cannot trigger next worker: No worker secret key found');
      return;
    }
    
    console.log(`[WORKER] Triggering next worker at ${baseUrl}/api/slack/rag-worker`);
    
    // Fire and forget - don't await the result
    fetch(`${baseUrl}/api/slack/rag-worker?key=${workerSecretKey}&chain=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerSecretKey}`
      },
      body: JSON.stringify({ type: 'chain_trigger' })  // Add a simple payload
    }).catch(error => {
      console.error('[WORKER] Failed to trigger next worker:', error);
    });
    
    console.log('[WORKER] Next worker trigger request sent');
  } catch (error) {
    console.error('[WORKER] Error triggering next worker:', error);
  }
}

// Main handler for the worker route
export async function POST(request: Request) {
  console.log('[WORKER] Worker endpoint called via POST');
  return handleWorkerRequest(request);
}

// Also handle GET requests to support both GET and POST
export async function GET(request: Request) {
  console.log('[WORKER] Worker endpoint called via GET');
  return handleWorkerRequest(request);
}

// Unified handler for the worker endpoint
async function handleWorkerRequest(request: Request) {
  try {
    const startTime = Date.now();
    const url = new URL(request.url);
    
    // Get authorization from multiple sources
    const queryKey = url.searchParams.get('key');
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    const isChained = url.searchParams.get('chain') === 'true';
    const isCronJob = request.headers.get('x-vercel-cron') === 'true';
    const isSlackEvent = request.headers.get('X-Slack-Event') === 'true';
    
    // Check for direct trigger from Slack events endpoint
    let isDirectTrigger = false;
    let requestBody;
    
    try {
      const contentType = request.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const rawBody = await request.text();
        if (rawBody) {
          requestBody = JSON.parse(rawBody);
          isDirectTrigger = requestBody?.type === 'direct_trigger';
          
          if (isDirectTrigger) {
            console.log(`[WORKER] Direct trigger detected, jobId: ${requestBody.jobId || 'unknown'}`);
          }
        }
      }
    } catch (parseError) {
      console.error('[WORKER] Error parsing request body:', parseError);
      // Continue processing - this isn't fatal
    }
    
    const expectedKey = process.env.WORKER_SECRET_KEY || '';
    
    // Log auth details (but protect the full key)
    console.log(`[WORKER] Auth details: Query key present: ${!!queryKey}, Bearer token present: ${!!bearerToken}, Expected key present: ${!!expectedKey}`);
    console.log(`[WORKER] Request type: ${isCronJob ? 'Vercel cron' : isChained ? 'Chained call' : isDirectTrigger ? 'Direct trigger' : isSlackEvent ? 'Slack event' : 'External call'}`);
    
    // Check authorization - accept either query param or bearer token
    const isAuthorized = isCronJob || 
                         (queryKey && queryKey === expectedKey) || 
                         (bearerToken && bearerToken === expectedKey);
    
    if (!isAuthorized) {
      console.error('[WORKER] Unauthorized access attempt. Check WORKER_SECRET_KEY environment variable.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check Redis connection before proceeding
    try {
      // Create a test Redis connection to validate configuration
      const redisUrl = process.env.UPSTASH_REDIS_URL || '';
      const redisToken = process.env.UPSTASH_REDIS_TOKEN || '';
      
      // Log Redis config for debugging (without exposing full credentials)
      console.log(`[WORKER] Redis config: URL ${redisUrl ? 'present' : 'missing'}, token ${redisToken ? 'present' : 'missing'}`);
      
      // Validate and fix URL format
      let validRedisUrl = redisUrl;
      if (!redisUrl.startsWith('https://') && redisUrl.includes('.upstash.io')) {
        validRedisUrl = `https://${redisUrl.replace(/^[\/]*/, '')}`;
        console.log(`[WORKER] Fixed Redis URL format to include https:// protocol`);
      } else if (!redisUrl.startsWith('https://')) {
        console.error(`[WORKER] Invalid Redis URL format: does not start with https://`);
      }
      
      const redis = new Redis({
        url: validRedisUrl,
        token: redisToken,
      });
      
      // Add more debugging about the Redis connection
      console.log(`[WORKER] Redis URL format: ${redisUrl.startsWith('https://') ? 'valid' : 'invalid'}`);
      if (redisUrl.includes('.upstash.io')) {
        console.log('[WORKER] Redis URL contains upstash.io domain');
      } else {
        console.error('[WORKER] Redis URL does not contain upstash.io domain');
      }
      
      // Test Redis connection by getting a simple value
      const pingResponse = await redis.ping();
      console.log(`[WORKER] Redis connection test successful, response: ${pingResponse}`);
      
      // Try to check the queue
      const queueLength = await redis.llen('queue:slack-message-queue:waiting');
      console.log(`[WORKER] Initial queue size: ${queueLength}`);
    } catch (redisError) {
      console.error('[WORKER] Redis connection test failed:', redisError);
      if (redisError instanceof Error) {
        console.error(`[WORKER] Error details: ${redisError.message}`);
        if ('cause' in redisError) {
          console.error(`[WORKER] Error cause:`, redisError.cause);
        }
      }
      return NextResponse.json({ 
        status: 'error',
        message: 'Redis configuration error',
        error: redisError instanceof Error ? redisError.message : String(redisError),
        hint: 'Ensure UPSTASH_REDIS_URL starts with https:// and is in the correct format'
      }, { status: 500 });
    }
    
    // Get a job from the queue
    console.log('[WORKER] Attempting to receive message from queue');
    let message;
    try {
      message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
      
      if (!message) {
        console.log('[WORKER] No messages in queue to process');
        
        // Additional check - try direct Redis access to verify
        try {
          const directRedis = new Redis({
            url: process.env.UPSTASH_REDIS_URL || '',
            token: process.env.UPSTASH_REDIS_TOKEN || '',
          });
          
          const queueLength = await directRedis.llen('queue:slack-message-queue:waiting');
          console.log(`[WORKER] Double-check queue length via direct Redis: ${queueLength}`);
          
          if (queueLength > 0) {
            console.error('[WORKER] Queue reported as empty by Upstash Queue SDK, but direct Redis check shows items. Potential SDK issue.');
          }
        } catch (directError) {
          console.error('[WORKER] Failed direct Redis queue check:', directError);
        }
        
        // If this is a direct trigger and there are no messages, it might be a race condition - the message
        // might still be in the process of being enqueued. Try waiting a short time and then checking again.
        if (isDirectTrigger) {
          console.log('[WORKER] Direct trigger with no messages - waiting briefly to check again');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          
          // Try to receive again
          message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
          
          if (!message) {
            console.log('[WORKER] Still no message after waiting - possible race condition with enqueuing');
            
            // Try direct Redis check one more time
            try {
              const directRedis = new Redis({
                url: process.env.UPSTASH_REDIS_URL || '',
                token: process.env.UPSTASH_REDIS_TOKEN || '',
              });
              
              const queueItems = await directRedis.lrange('queue:slack-message-queue:waiting', 0, 0);
              console.log(`[WORKER] Final check for queue content: ${queueItems.length > 0 ? 'Items exist' : 'Queue empty'}`);
              
              if (queueItems.length > 0) {
                console.error('[WORKER] Queue has items but receiveMessage is not retrieving them. Possible SDK issue.');
              }
            } catch (finalError) {
              console.error('[WORKER] Final queue check failed:', finalError);
            }
          } else {
            console.log(`[WORKER] Found message after waiting, stream ID: ${message.streamId}`);
          }
        }
        
        if (!message) {
          return NextResponse.json({ status: 'no_jobs' });
        }
      }
      
      const jobId = `${message.body.userId}-${message.body.eventTs.substring(0, 8)}`;
      console.log(`[WORKER] Retrieved message from queue for user ${message.body.userId}, text: "${message.body.questionText.substring(0, 30)}...", stream ID: ${message.streamId}`);
      
      // Process the job
      console.log(`[WORKER:${jobId}] Starting job processing`);
      const success = await processJob(message.body);
      
      // Verify the message if processing was successful
      if (success) {
        console.log(`[WORKER:${jobId}] Job processed successfully, verifying message`);
        try {
          await slackMessageQueue.verifyMessage(message.streamId);
          console.log(`[WORKER:${jobId}] Message verified successfully`);
        } catch (verifyError) {
          console.error(`[WORKER:${jobId}] Failed to verify message:`, verifyError);
        }
      } else {
        console.log(`[WORKER:${jobId}] Job processing failed, not verifying message`);
      }
      
      // Check if there are more jobs in the queue
      const remainingJobs = await hasMoreJobs();
      console.log(`[WORKER] Remaining jobs in queue: ${remainingJobs}`);
      
      // If there are more jobs, trigger another worker
      if (remainingJobs > 0) {
        console.log('[WORKER] There are more jobs, triggering next worker');
        triggerNextWorker(request);
      } else {
        console.log('[WORKER] No more jobs in queue, worker chain complete');
      }
      
      console.log(`[WORKER] Worker execution completed in ${Date.now() - startTime}ms`);
      
      return NextResponse.json({ 
        status: success ? 'success' : 'error',
        jobId: message.streamId,
        remainingJobs,
        executionTime: Date.now() - startTime
      });
      
    } catch (queueError) {
      console.error('[WORKER] Failed to retrieve message from queue:', queueError);
      
      // Enhanced error logging
      if (queueError instanceof Error) {
        console.error(`[WORKER] Error type: ${queueError.name}`);
        console.error(`[WORKER] Error message: ${queueError.message}`);
        if (queueError.stack) {
          console.error(`[WORKER] Error stack: ${queueError.stack}`);
        }
        if ('cause' in queueError) {
          console.error(`[WORKER] Error cause:`, queueError.cause);
        }
      }
      
      return NextResponse.json({ 
        status: 'error',
        message: 'Failed to access job queue',
        error: queueError instanceof Error ? queueError.message : String(queueError)
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[WORKER] Unhandled error in worker:', error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      console.error(`[WORKER] Error type: ${error.name}`);
      console.error(`[WORKER] Error message: ${error.message}`);
      if (error.stack) {
        console.error(`[WORKER] Error stack: ${error.stack}`);
      }
    }
    
    return NextResponse.json({ 
      status: 'error',
      message: 'Internal server error'
    }, { status: 500 });
  }
} 