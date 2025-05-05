import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { SlackMessageJob, slackMessageQueue } from '@/lib/jobQueue';
import { WebClient } from '@slack/web-api';
import { queryRag, streamRag } from '@/lib/rag';

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

// Get direct message from Redis if queue library fails
async function getDirectMessageFromRedis(): Promise<{streamId: string, body: SlackMessageJob} | null> {
  try {
    console.log('[WORKER] Attempting to directly access Redis queue');
    
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL || '',
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    });
    
    // Get queue items
    const items = await redis.lrange('queue:slack-message-queue:waiting', 0, 0);
    
    if (items.length === 0) {
      console.log('[WORKER] No items found in Redis queue');
      return null;
    }
    
    console.log('[WORKER] Found item in direct Redis queue');
    
    // Parse the item and create a synthetic message
    try {
      const parsedItem = JSON.parse(items[0]);
      
      // If it's already in the right format
      if (parsedItem.streamId && parsedItem.body) {
        // Remove the item from the queue
        await redis.lrem('queue:slack-message-queue:waiting', 1, items[0]);
        return parsedItem;
      }
      
      // If it's a direct job (not wrapped)
      if (parsedItem.channelId && parsedItem.userId && parsedItem.questionText) {
        // Remove the item from the queue
        await redis.lrem('queue:slack-message-queue:waiting', 1, items[0]);
        
        // Return in the correct format
        return {
          streamId: `manual-${Date.now()}`,
          body: parsedItem
        };
      }
    } catch (parseError) {
      console.error('[WORKER] Error parsing queue item:', parseError);
      return null;
    }
    
    return null;
  } catch (error) {
    console.error('[WORKER] Error directly accessing Redis:', error);
    return null;
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
    
    // Helper function to format timestamp consistently
    const formatSlackTimestamp = (timestamp: string): string => {
      // Skip if undefined/null
      if (!timestamp) return timestamp;
      
      // Already in correct Slack format (seconds.microseconds)
      if (/^\d+\.\d+$/.test(timestamp)) {
        return timestamp;
      }
      
      // If it's a millisecond timestamp, convert to Slack format
      if (/^\d{13,}$/.test(timestamp)) {
        const seconds = Math.floor(parseInt(timestamp) / 1000);
        const microseconds = parseInt(timestamp) % 1000 * 1000;
        return `${seconds}.${microseconds}`;
      }
      
      // If it's already a string but missing decimal (unlikely)
      if (/^\d+$/.test(timestamp)) {
        return `${timestamp}.000000`;
      }
      
      console.warn(`[SLACK] Unexpected timestamp format: ${timestamp}`);
      return timestamp;
    };
    
    // Format thread_ts if provided
    const formattedThreadTs = thread_ts ? formatSlackTimestamp(thread_ts) : undefined;
    
    if (formattedThreadTs !== thread_ts && thread_ts) {
      console.log(`[SLACK] Reformatted thread_ts from ${thread_ts} to ${formattedThreadTs}`);
    }
    
    // Log entire message before sending
    console.log(`[SLACK] About to send message: ${JSON.stringify({
      channel,
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      thread_ts: formattedThreadTs
    })}`);
    
    // Post message to Slack
    const result = await webClient.chat.postMessage({
      channel,
      text,
      thread_ts: formattedThreadTs,
      unfurl_links: false,
      unfurl_media: false,
    });
    
    console.log(`[SLACK] Message sent successfully: ${result.ts}`);
    return result;
  } catch (error) {
    console.error('[SLACK] Error sending message to Slack:', error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      console.error(`[SLACK] Error type: ${error.name}`);
      console.error(`[SLACK] Error message: ${error.message}`);
      console.error(`[SLACK] Error stack: ${error.stack}`);
      
      // Special handling for invalid_thread_ts errors
      if (error.message && error.message.includes('invalid_thread_ts')) {
        console.error(`[SLACK] This is a thread_ts format error. Used thread_ts: ${thread_ts}`);
        
        // Try to send a backup message without thread_ts
        try {
          // Check again if webClient is available
          if (!webClient) {
            console.error('[SLACK] Cannot send fallback message - Slack web client is not initialized');
            throw new Error('Slack web client is not initialized');
          }
          
          console.log('[SLACK] Attempting fallback message without thread_ts');
          const result = await webClient.chat.postMessage({
            channel,
            text: "I encountered an error with the message threading. Here's your response as a new message:\n\n" + text,
            unfurl_links: false,
            unfurl_media: false,
          });
          console.log(`[SLACK] Fallback message sent successfully: ${result.ts}`);
          return result;
        } catch (fallbackError) {
          console.error('[SLACK] Fallback message also failed:', fallbackError);
        }
      }
    }
    
    throw error;
  }
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
          // IMPORTANT: Use the correct thread_ts format directly without modifying it
          // Ensure we're using the original Slack timestamp format
          const thread_ts = job.threadTs || job.eventTs;
          console.log(`[WORKER:${jobId}] Using thread_ts: ${thread_ts} for waiting message`);
          
          await sendSlackMessage({
            channel: job.channelId,
            text: 'I\'m working on your question. This might take a minute...',
            thread_ts: thread_ts
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
      
      // IMPORTANT: Use the correct thread_ts format directly without modifying it
      // Ensure we're using the original Slack timestamp format
      const thread_ts = job.threadTs || job.eventTs;
      console.log(`[WORKER:${jobId}] Using thread_ts: ${thread_ts} for final response`);
      
      // Success - assuming the result is something we can send back
      await sendSlackMessage({
        channel: job.channelId,
        text: result,
        thread_ts: thread_ts
      });
      
      console.log(`[WORKER:${jobId}] Successfully sent response to user`);
      return true;
    } catch (error) {
      // Clear the timeout since we got an error
      if (timeoutId) clearTimeout(timeoutId);
      if (waitingMessageTimeoutId) clearTimeout(waitingMessageTimeoutId);
      
      console.error(`[WORKER:${jobId}] Error during processing:`, error);
      
      // IMPORTANT: Use the correct thread_ts format directly without modifying it
      // Ensure we're using the original Slack timestamp format
      const thread_ts = job.threadTs || job.eventTs;
      console.log(`[WORKER:${jobId}] Using thread_ts: ${thread_ts} for error message`);
      
      // If we already sent a waiting message, update it to show the error
      // Otherwise send a new error message
      try {
        await sendSlackMessage({
          channel: job.channelId,
          text: `I'm sorry, I encountered an error while processing your request. Please try again later.`,
          thread_ts: thread_ts
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

// Process a job with streaming responses
async function processJobWithStreaming(job: SlackMessageJob): Promise<boolean> {
  const startTime = Date.now();
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[WORKER:${jobId}] Starting to process job with streaming for user ${job.userId}, channel ${job.channelId}, text: "${job.questionText.substring(0, 30)}..."`);
  
  // Create a timeout promise outside to avoid variable reference issues
  const timeoutMs = 55000; // Set to 55 seconds to leave buffer for cleanup
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Processing timeout after 55 seconds'));
    }, timeoutMs);
  });

  try {
    // IMPORTANT: Use the correct thread_ts format directly without modifying it
    const thread_ts = job.threadTs || job.eventTs;
    console.log(`[WORKER:${jobId}] Using thread_ts: ${thread_ts} for streaming responses`);
    
    // Send the initial thinking message
    let messageResponse;
    try {
      messageResponse = await sendSlackMessage({
        channel: job.channelId,
        text: "Thinking...",
        thread_ts: thread_ts
      });
      console.log(`[WORKER:${jobId}] Sent initial thinking message with ts: ${messageResponse?.ts}`);
    } catch (initialMsgError) {
      console.error(`[WORKER:${jobId}] Failed to send initial thinking message:`, initialMsgError);
      // Continue with the process even if we couldn't send the initial message
    }
    
    // Get the message timestamp for updates
    const messageTs = messageResponse?.ts;
    if (!messageTs) {
      console.error(`[WORKER:${jobId}] Failed to get message timestamp for updates`);
      // Fall back to normal processing if we can't get the message timestamp
      return await processJob(job);
    }
    
    // Handle streaming content
    let lastContent = "";
    let aborted = false;
    
    // Create a function to handle message updates
    const handleMessageUpdate = async (content: string): Promise<void> => {
      if (aborted) return; // Don't continue if the process has been aborted
      
      // Only update if the content has changed
      if (content !== lastContent) {
        lastContent = content;
        
        try {
          // Attempt to update the message with new content
          await webClient!.chat.update({
            channel: job.channelId,
            ts: messageTs,
            text: content
          });
          console.log(`[WORKER:${jobId}] Updated message with new content (${content.length} chars)`);
        } catch (updateError) {
          console.error(`[WORKER:${jobId}] Error updating message:`, updateError);
          
          // Handle rate limiting errors with proper backoff
          if (updateError && (updateError as any).code === 'slack_webapi_platform_error') {
            const slackError = updateError as any;
            if (slackError.data && slackError.data.error === 'ratelimited') {
              const retryAfter = parseInt(slackError.headers?.['retry-after'] || '1', 10);
              console.log(`[WORKER:${jobId}] Rate limited by Slack. Backing off for ${retryAfter} seconds`);
              
              // Wait for the recommended retry time before continuing
              await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
              
              // Try again after backoff
              try {
                await webClient!.chat.update({
                  channel: job.channelId,
                  ts: messageTs,
                  text: content
                });
                console.log(`[WORKER:${jobId}] Successfully updated message after rate limit backoff`);
              } catch (retryError) {
                console.error(`[WORKER:${jobId}] Failed to update message after backoff:`, retryError);
              }
            }
          }
          // If we can't update, we'll still continue collecting the full response
        }
      }
    };
    
    // Start the streaming RAG process
    const streamingPromise = streamRag(job.questionText, handleMessageUpdate);
    
    try {
      // Race between the streaming process and the timeout
      await Promise.race([
        streamingPromise,
        timeoutPromise.catch(error => {
          // If timeout occurs, abort streaming but still send what we have
          aborted = true;
          throw error;
        })
      ]);
      
      // Clear the timeout since we finished before it triggered
      if (timeoutId) clearTimeout(timeoutId);
      
      const processingTime = Date.now() - startTime;
      console.log(`[WORKER:${jobId}] Successfully processed streaming job in ${processingTime}ms`);
      
      // Ensure that the content is delivered in its entirety
      if (lastContent && !aborted) {
        try {
          console.log(`[WORKER:${jobId}] Sending final content update (${lastContent.length} chars)`);
          await webClient!.chat.update({
            channel: job.channelId,
            ts: messageTs,
            text: lastContent
          });
        } catch (finalUpdateError) {
          console.error(`[WORKER:${jobId}] Error sending final update:`, finalUpdateError);
        }
      }
      
      return true;
    } catch (error) {
      // Clear the timeout
      if (timeoutId) clearTimeout(timeoutId);
      
      console.error(`[WORKER:${jobId}] Error during streaming process:`, error);
      
      // If we have partial content, try to send that with an error note
      if (lastContent) {
        try {
          await webClient!.chat.update({
            channel: job.channelId,
            ts: messageTs,
            text: lastContent + "\n\n(Note: This response may be incomplete due to an error during processing.)"
          });
          console.log(`[WORKER:${jobId}] Updated message with partial content and error note`);
        } catch (errorUpdateError) {
          console.error(`[WORKER:${jobId}] Failed to update message with error note:`, errorUpdateError);
        }
      } else {
        // If we have no content at all, send a generic error message
        try {
          await webClient!.chat.update({
            channel: job.channelId,
            ts: messageTs,
            text: "I'm sorry, I encountered an error while processing your request. Please try again later."
          });
          console.log(`[WORKER:${jobId}] Updated message with error message`);
        } catch (errorMsgError) {
          console.error(`[WORKER:${jobId}] Failed to update message with error:`, errorMsgError);
        }
      }
      
      return false;
    }
  } finally {
    // Ensure timeout is cleared
    if (timeoutId) clearTimeout(timeoutId);
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
        console.log('[WORKER] No messages in queue to process');
        
        // Try direct Redis access as a final attempt
        message = await getDirectMessageFromRedis();
        
        if (!message) {
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
      const useStreaming = message.body.useStreaming !== false; // Default to streaming if not explicitly disabled
      console.log(`[WORKER:${jobId}] Processing mode: ${useStreaming ? 'streaming' : 'standard'}`);
      const success = useStreaming 
        ? await processJobWithStreaming(message.body)
        : await processJob(message.body);
      
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
          console.error(`[WORKER:${jobId}] Error verifying message:`, verifyError);
        }
      }
      
      return NextResponse.json({
        status: success ? 'success' : 'error',
        action: 'job_processing',
        jobId: jobId
      });
    } catch (error) {
      console.error(`[WORKER] Error processing message:`, error);
      return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  } catch (error) {
    console.error(`[WORKER] Error processing request:`, error);
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}