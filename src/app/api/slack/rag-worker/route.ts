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
  console.log(`[WORKER:${jobId}] Starting to process job for user ${job.userId}, channel ${job.channelId}`);
  
  // Set up a timeout for the entire processing
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Processing timeout after 55 seconds'));
    }, 55000); // Set to 55 seconds to leave buffer for cleanup
    
    // Clean up the timeout if the promise is resolved before timeout
    (timeoutPromise as any).cleanup = () => clearTimeout(timeoutId);
  });
  
  try {
    // Set up timeout for intermediate message (5 seconds)
    const waitingMessageTimeoutId = setTimeout(async () => {
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
    
    // Race between the processing and timeout
    const result = await Promise.race([
      // The actual processing
      (async () => {
        try {
          // Query the RAG system
          console.log(`[WORKER:${jobId}] Calling queryRag for message: "${job.questionText}"`);
          const answer = await queryRag(job.questionText);
          console.log(`[WORKER:${jobId}] Received answer from queryRag in ${Date.now() - startTime}ms, length: ${answer.length} chars`);
          
          // Clear the waiting message timeout
          clearTimeout(waitingMessageTimeoutId);
          
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
          // Clear the waiting message timeout
          clearTimeout(waitingMessageTimeoutId);
          throw error;
        }
      })(),
      timeoutPromise
    ]);
    
    // Clean up the timeout
    if ((timeoutPromise as any).cleanup) {
      (timeoutPromise as any).cleanup();
    }
    
    return result as boolean;
  } catch (error) {
    console.error(`[WORKER:${jobId}] Error processing job:`, error);
    
    // Clear the timeout if it exists
    if ((timeoutPromise as any).cleanup) {
      (timeoutPromise as any).cleanup();
    }
    
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
    console.log(`[WORKER:${jobId}] Job processing completed in ${Date.now() - startTime}ms`);
  }
}

// Check if there are more jobs in the queue
async function hasMoreJobs(): Promise<number> {
  try {
    // Access Redis directly to check queue size
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL || '',
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    });
    
    const count = await redis.llen('queue:slack-message-queue:waiting');
    return count;
  } catch (error) {
    console.error('[WORKER] Error checking queue size:', error);
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
    
    if (!baseUrl) {
      console.error('[WORKER] Cannot trigger next worker: No deployment URL found');
      return;
    }
    
    console.log('[WORKER] Triggering next worker execution');
    
    // Fire and forget - don't await the result
    fetch(`${baseUrl}/api/slack/rag-worker?key=${process.env.WORKER_SECRET_KEY}&chain=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }).catch(error => {
      console.error('[WORKER] Failed to trigger next worker:', error);
    });
    
    console.log('[WORKER] Next worker triggered successfully');
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
    const key = url.searchParams.get('key');
    const isChained = url.searchParams.get('chain') === 'true';
    const isCronJob = request.headers.get('x-vercel-cron') === 'true';
    const isSlackEvent = request.headers.get('X-Slack-Event') === 'true';
    
    console.log(`[WORKER] Request type: ${isCronJob ? 'Vercel cron' : isChained ? 'Chained call' : isSlackEvent ? 'Slack event' : 'External call'}, has key: ${!!key}`);
    
    // If it's not authorized, reject the request
    if (!isCronJob && key !== process.env.WORKER_SECRET_KEY) {
      console.error('[WORKER] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get a job from the queue
    console.log('[WORKER] Attempting to receive message from queue');
    const message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
    
    if (!message) {
      console.log('[WORKER] No messages in queue to process');
      return NextResponse.json({ status: 'no_jobs' });
    }
    
    const jobId = `${message.body.userId}-${message.body.eventTs.substring(0, 8)}`;
    console.log(`[WORKER] Retrieved message from queue: ${JSON.stringify(message.body)}, stream ID: ${message.streamId}`);
    
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
  } catch (error) {
    console.error('[WORKER] Unhandled error in worker:', error);
    return NextResponse.json({ 
      status: 'error',
      message: 'Internal server error'
    }, { status: 500 });
  }
} 