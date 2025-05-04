import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { SlackMessageJob, slackMessageQueue } from '@/lib/jobQueue';
import { WebClient } from '@slack/web-api';

// Define the runtime as nodejs to support fs, path, and other Node.js core modules
export const runtime = 'nodejs';

// Set maximum function duration in seconds
export const maxDuration = 60;

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

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

// Send a message to Slack
async function sendSlackMessage({ channel, text, thread_ts }: { channel: string, text: string, thread_ts?: string }) {
  console.log(`[SLACK] Sending message to channel ${channel}${thread_ts ? ' in thread ' + thread_ts : ''}`);
  
  try {
    // Make sure we're using the webClient correctly
    if (!webClient) {
      console.error('[SLACK] Slack web client is not initialized');
      throw new Error('Slack web client is not initialized');
    }
    
    // Post message to Slack
    const result = await webClient.chat.postMessage({
      channel,
      text,
      thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    });
    
    console.log(`[SLACK] Message sent successfully: ${result.ts}`);
    return result;
  } catch (error) {
    console.error('[SLACK] Error sending message to Slack:', error);
    
    // Log more details about the error
    if (error instanceof Error) {
      console.error(`[SLACK] Error type: ${error.name}`);
      console.error(`[SLACK] Error message: ${error.message}`);
      console.error(`[SLACK] Error stack: ${error.stack}`);
    }
    
    throw error;
  }
}

// Query the RAG system (this would be your actual implementation)
async function queryRag(question: string): Promise<string> {
  console.log(`[RAG] Querying RAG for question: "${question}"`);
  
  // This is where you'd implement your actual RAG query logic
  // For now, we'll simulate a delay and return a simple response
  await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
  
  console.log(`[RAG] RAG processing complete`);
  return `Here is the answer to your question: "${question}".\n\nThis is a placeholder response. Please implement actual RAG query logic.`;
}

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
  let waitingMessageTimeoutId: NodeJS.Timeout | undefined;
  let waitingMessageSent = false;

  try {
    // First send interim message after a short delay if processing takes too long
    const waitingMessagePromise = new Promise<void>((resolve) => {
      waitingMessageTimeoutId = setTimeout(async () => {
        try {
          await sendSlackMessage({
            channel: job.channelId,
            text: 'I\'m working on your question. This might take a minute...',
            thread_ts: job.threadTs || job.eventTs
          });
          waitingMessageSent = true;
          console.log(`[WORKER:${jobId}] Sent waiting message to user`);
        } catch (waitError) {
          console.error(`[WORKER:${jobId}] Error sending waiting message:`, waitError);
        }
        resolve();
      }, 5000); // Send waiting message after 5 seconds
    });

    // Process the request with timeout
    try {
      // Race between the actual processing and timeout
      const result = await Promise.race([
        queryRag(job.questionText),
        timeoutPromise
      ]);
      
      // Clear the timeout since we finished before it triggered
      if (timeoutId) clearTimeout(timeoutId);
      if (waitingMessageTimeoutId) clearTimeout(waitingMessageTimeoutId);
      
      const processingTime = Date.now() - startTime;
      console.log(`[WORKER:${jobId}] Successfully processed job in ${processingTime}ms`);
      
      // Success - assuming the result is something we can send back
      await sendSlackMessage({
        channel: job.channelId,
        text: result,
        thread_ts: job.threadTs || job.eventTs
      });
      
      console.log(`[WORKER:${jobId}] Successfully sent response to user`);
      return true;
    } catch (error) {
      // Clear the timeout since we got an error
      if (timeoutId) clearTimeout(timeoutId);
      if (waitingMessageTimeoutId) clearTimeout(waitingMessageTimeoutId);
      
      console.error(`[WORKER:${jobId}] Error during processing:`, error);
      
      // If we already sent a waiting message, update it to show the error
      // Otherwise send a new error message
      try {
        await sendSlackMessage({
          channel: job.channelId,
          text: `I'm sorry, I encountered an error while processing your request. Please try again later.`,
          thread_ts: job.threadTs || job.eventTs
        });
        console.log(`[WORKER:${jobId}] Sent error message to user`);
      } catch (slackError) {
        console.error(`[WORKER:${jobId}] Failed to send error message to user:`, slackError);
      }
      
      return false;
    }
  } finally {
    // Ensure timeouts are cleared in case of early returns or other code paths
    if (timeoutId) clearTimeout(timeoutId);
    if (waitingMessageTimeoutId) clearTimeout(waitingMessageTimeoutId);
  }
}

// Main handler for the worker route
export async function POST(request: Request) {
  console.log('[WORKER] Worker endpoint called via POST');
  return handleWorkerRequest(request);
}

// Unified handler for the worker endpoint
async function handleWorkerRequest(request: Request) {
  try {
    const startTime = Date.now();
    const url = new URL(request.url);
    
    // Get all request headers for debugging
    const headerEntries = Array.from(request.headers.entries());
    console.log(`[WORKER] Request headers: ${JSON.stringify(headerEntries)}`);
    
    // Get authorization from multiple sources
    const queryKey = url.searchParams.get('key');
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    const isChained = url.searchParams.get('chain') === 'true';
    const isCronJob = request.headers.get('x-vercel-cron') === 'true';
    const isSlackEvent = request.headers.get('X-Trigger-Source') === 'slack_events';
    const jobId = request.headers.get('X-Job-ID');
    
    // Attempt to parse and log request body
    let requestBody: any;
    let requestBodyText = '';
    let isDirectTrigger = false;
    
    try {
      // Clone the request to avoid consuming the body
      const clonedRequest = request.clone();
      requestBodyText = await clonedRequest.text();
      
      if (requestBodyText) {
        console.log(`[WORKER] Request body: ${requestBodyText.substring(0, 200)}${requestBodyText.length > 200 ? '...' : ''}`);
        try {
          requestBody = JSON.parse(requestBodyText);
          isDirectTrigger = requestBody?.type === 'direct_trigger';
          
          if (isDirectTrigger && requestBody.jobId) {
            console.log(`[WORKER] Direct trigger detected, jobId: ${requestBody.jobId}`);
          }
        } catch (error) {
          const jsonError = error as Error;
          console.warn(`[WORKER] Failed to parse request body as JSON: ${jsonError.message}`);
        }
      } else {
        console.log(`[WORKER] Request has no body`);
      }
    } catch (error) {
      const bodyError = error as Error;
      console.error(`[WORKER] Error reading request body: ${bodyError.message}`);
    }
    
    // Log complete request information
    console.log(`[WORKER] Request details: method=${request.method}, url=${request.url}, directTrigger=${isDirectTrigger}, slackEvent=${isSlackEvent}, jobId=${jobId || requestBody?.jobId || 'none'}`);
    
    // Special handling for direct job processing from diagnostic
    const isDirectJob = requestBody?.type === 'direct_job';
    if (isDirectJob && requestBody?.job) {
      console.log('[WORKER] Direct job request detected from diagnostic');
      try {
        const jobBody = requestBody.job;
        console.log(`[WORKER] Processing direct job: ${JSON.stringify(jobBody).substring(0, 100)}...`);
        
        // Create a job ID for logging
        const directJobId = `${jobBody.userId}-${jobBody.eventTs?.substring(0, 8) || 'diagnostic'}`;
        console.log(`[WORKER:${directJobId}] Starting to process direct job`);
        
        // Process the job directly
        const success = await processJob(jobBody);
        console.log(`[WORKER:${directJobId}] Direct job processing ${success ? 'succeeded' : 'failed'}`);
        
        return NextResponse.json({
          status: success ? 'success' : 'error',
          action: 'direct_job_processing',
          jobId: directJobId
        });
      } catch (directJobError) {
        console.error('[WORKER] Error processing direct job:', directJobError);
        return NextResponse.json({
          status: 'error',
          error: directJobError instanceof Error ? directJobError.message : String(directJobError)
        }, { status: 500 });
      }
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
      // Create a test Redis connection
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_URL || '',
        token: process.env.UPSTASH_REDIS_TOKEN || '',
      });
      
      // Check URL format and domain
      const redisUrl = process.env.UPSTASH_REDIS_URL || '';
      console.log(`[WORKER] Redis URL format: ${redisUrl.startsWith('https://') ? 'valid' : 'invalid'}`);
      console.log(`[WORKER] Redis URL contains upstash.io domain: ${redisUrl.includes('.upstash.io')}`);
      
      const pingResponse = await redis.ping();
      console.log(`[WORKER] Redis connection test successful, response: ${pingResponse}`);
      
      // Get queue size first
      const queueSize = await hasMoreJobs();
      console.log(`[WORKER] Initial queue size: ${queueSize}`);
    } catch (error) {
      console.error('[WORKER] Redis connection test failed:', error);
      return NextResponse.json({ error: 'Redis connection failed', message: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
    
    // Get a job from the queue
    console.log('[WORKER] Attempting to receive message from queue');
    let message;
    try {
      message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
      console.log('[WORKER] receiveMessage completed, result:', message ? 'Message received' : 'No message found');
      
      if (!message) {
        // Try direct Redis approach as fallback
        console.log('[WORKER] Attempting direct Redis queue access as fallback');
        try {
          const queueKey = 'queue:slack-message-queue:waiting';
          // Create a new direct Redis connection
          const directRedis = new Redis({
            url: process.env.UPSTASH_REDIS_URL || '',
            token: process.env.UPSTASH_REDIS_TOKEN || '',
          });
          
          // Get the first item without removing it
          const items = await directRedis.lrange(queueKey, 0, 0);
          
          if (items.length > 0) {
            console.log('[WORKER] Found item in queue via direct Redis access');
            try {
              // Try to parse the item
              const parsedItem = JSON.parse(items[0]);
              console.log('[WORKER] Parsed item structure:', Object.keys(parsedItem));
              
              // If it has the expected format, process it
              if (parsedItem.body && typeof parsedItem.body === 'object') {
                console.log('[WORKER] Item has body property, attempting to process');
                
                // Create a synthetic message object
                message = {
                  streamId: parsedItem.streamId || `manual-${Date.now()}`,
                  body: parsedItem.body
                };
                
                // Remove the item from the queue
                console.log('[WORKER] Manually removing item from queue');
                await directRedis.lrem(queueKey, 1, items[0]);
                
                console.log('[WORKER] Successfully retrieved message via fallback method');
              } else {
                console.log('[WORKER] Item does not have expected format:', parsedItem);
              }
            } catch (parseError) {
              console.error('[WORKER] Error parsing queue item:', parseError);
            }
          }
        } catch (directRedisError) {
          console.error('[WORKER] Error in direct Redis fallback:', directRedisError);
        }
      }
      
      if (!message) {
        // If this was a direct trigger from Slack events and no message was found,
        // there might be a race condition where the message is still being enqueued
        if ((isDirectTrigger || isSlackEvent) && requestBody) {
          console.log('[WORKER] Direct trigger with no message - waiting to check for delayed enqueue');
          // Wait a bit longer (2 seconds) as message enqueuing might be delayed
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try again after waiting
          message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
          console.log('[WORKER] After waiting, receiveMessage completed, result:', message ? 'Message received' : 'No message found');
        }
        
        // Still no message found
        if (!message) {
          console.log('[WORKER] No messages in queue to process');
          
          // Check queue directly as a last resort
          try {
            const redis = new Redis({
              url: process.env.UPSTASH_REDIS_URL || '',
              token: process.env.UPSTASH_REDIS_TOKEN || '',
            });
            
            // Double-check queue length via direct Redis
            const queueLength = await redis.llen('queue:slack-message-queue:waiting');
            console.log(`[WORKER] Double-check queue length via direct Redis: ${queueLength}`);
          } catch (directError) {
            console.error('[WORKER] Error checking queue length directly:', directError);
          }
          
          return NextResponse.json({ status: 'no_jobs' });
        }
      }
      
      // Log the message object structure for debugging
      console.log('[WORKER] Message object structure:', {
        streamId: message.streamId,
        messageType: typeof message,
        bodyType: typeof message.body,
        availableProps: Object.keys(message),
        bodyProps: Object.keys(message.body)
      });
      
      // We have a valid message to process
      const jobId = `${message.body.userId}-${message.body.eventTs.substring(0, 8)}`;
      console.log(`[WORKER] Retrieved message from queue: ${JSON.stringify(message.body)}, stream ID: ${message.streamId}`);
      
      // Process the job
      console.log(`[WORKER:${jobId}] Starting job processing`);
      const success = await processJob(message.body);
      
      // Verify the message was processed successfully
      if (success) {
        // Verify the message in the queue to acknowledge it's been processed
        try {
          console.log(`[WORKER:${jobId}] Attempting to verify message in queue with streamId: ${message.streamId}`);
          
          // According to @upstash/queue documentation, verifyMessage is used to acknowledge
          // and remove a message after processing
          const verificationResult = await slackMessageQueue.verifyMessage(message.streamId);
          
          console.log(`[WORKER:${jobId}] Message processed and verification result: ${verificationResult}`);
        } catch (verifyError) {
          console.error(`[WORKER:${jobId}] Error verifying message in queue:`, verifyError);
          
          // Log detailed error information
          if (verifyError instanceof Error) {
            console.error(`[WORKER:${jobId}] Error type: ${verifyError.name}`);
            console.error(`[WORKER:${jobId}] Error message: ${verifyError.message}`);
            console.error(`[WORKER:${jobId}] Error stack: ${verifyError.stack}`);
          }
        }
      } else {
        console.error(`[WORKER:${jobId}] Failed to process message`);
        // Don't verify to allow reprocessing
      }
      
      // Check if there are more jobs in the queue
      const remainingJobs = await hasMoreJobs();
      console.log(`[WORKER] Remaining jobs in queue: ${remainingJobs}`);
      
      // Chain worker execution if there are more jobs
      if (remainingJobs > 0) {
        // Call this endpoint again to process the next job
        console.log('[WORKER] Calling worker again to process next job');
        
        try {
          // Fire and forget - don't await to avoid exceeding timeout
          fetch(`${url.origin}${url.pathname}?key=${expectedKey}&chain=true`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }).catch(chainError => {
            console.error('[WORKER] Error chaining worker:', chainError instanceof Error ? chainError.message : String(chainError));
          });
          
          console.log('[WORKER] Chained worker call initiated');
        } catch (chainError) {
          console.error('[WORKER] Failed to chain worker:', chainError instanceof Error ? chainError.message : String(chainError));
        }
      }
      
      return NextResponse.json({ 
        status: success ? 'success' : 'error',
        remainingJobs,
        executionTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[WORKER] Error processing message:', error instanceof Error ? error.message : String(error));
      return NextResponse.json({ error: 'Failed to process message', message: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  } catch (error) {
    console.error('[WORKER] Unhandled error in worker:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('[WORKER] Stack trace:', error.stack);
    }
    return NextResponse.json({ error: 'Internal worker error', message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}