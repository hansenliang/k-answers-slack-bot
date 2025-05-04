import { Queue } from '@upstash/queue';
import { Redis } from '@upstash/redis';

// Define the job structure
export interface SlackMessageJob {
  channelId: string;
  userId: string;
  questionText: string;
  threadTs?: string;
  eventTs: string;
}

// Validate and fix the Redis URL
function getValidRedisUrl(url: string): string {
  if (!url) {
    console.error('[REDIS_INIT] Redis URL is missing or empty');
    return '';
  }

  console.log(`[REDIS_INIT] Processing Redis URL: ${url.substring(0, 8)}...`);
  
  // Handle different URL formats
  if (url.startsWith('https://')) {
    return url; // Already valid
  }
  
  // Fix URLs that might be missing the protocol
  if (url.includes('.upstash.io')) {
    const fixedUrl = `https://${url.replace(/^[\/]*/, '')}`;
    console.log(`[REDIS_INIT] Fixed Redis URL to include https:// protocol`);
    return fixedUrl;
  }
  
  console.error(`[REDIS_INIT] Invalid Redis URL format: ${url.substring(0, 8)}...`);
  console.error('[REDIS_INIT] URL must be in format: https://xxx.upstash.io');
  return url; // Return original to not break completely
}

// Get Redis configuration with validation
const redisUrl = getValidRedisUrl(process.env.UPSTASH_REDIS_URL || '');
const redisToken = process.env.UPSTASH_REDIS_TOKEN || '';

// Log Redis configuration (safely)
console.log(`[REDIS_INIT] URL format valid: ${redisUrl.startsWith('https://')}`);
console.log(`[REDIS_INIT] Token available: ${!!redisToken}`);

// Initialize the Redis client
const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

// Initialize the Upstash Queue
export const slackMessageQueue = new Queue({
  redis,
  queueName: 'slack-message-queue',
  concurrencyLimit: 5,
});

// Function to enqueue a Slack message job
export async function enqueueSlackMessage(job: SlackMessageJob): Promise<boolean> {
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[JOB_QUEUE:${jobId}] Enqueueing message from user ${job.userId} with text "${job.questionText.substring(0, 30)}..."`);
  
  try {
    // First verify Redis connection
    try {
      console.log(`[JOB_QUEUE:${jobId}] Testing Redis connection before enqueueing`);
      await redis.ping();
      console.log(`[JOB_QUEUE:${jobId}] Redis connection test successful`);
    } catch (pingError) {
      console.error(`[JOB_QUEUE:${jobId}] Redis ping failed before enqueueing:`, pingError);
      // Continue with enqueue attempt despite ping failure
    }
    
    // Get queue info before enqueue
    let initialQueueSize;
    try {
      initialQueueSize = await redis.llen('queue:slack-message-queue:waiting');
      console.log(`[JOB_QUEUE:${jobId}] Initial queue size: ${initialQueueSize}`);
    } catch (lenError) {
      console.error(`[JOB_QUEUE:${jobId}] Failed to get initial queue length:`, lenError);
    }
    
    // IMPORTANT: Always use the Queue library to ensure proper message format
    // Never use direct Redis operations (lpush, etc.) to add messages to the queue
    console.log(`[JOB_QUEUE:${jobId}] Calling slackMessageQueue.sendMessage with properly formatted job`);
    const result = await slackMessageQueue.sendMessage(job);
    console.log(`[JOB_QUEUE:${jobId}] Queue.sendMessage result: ${result}`);
    
    // Verify queue update
    try {
      const newQueueSize = await redis.llen('queue:slack-message-queue:waiting');
      console.log(`[JOB_QUEUE:${jobId}] New queue size after enqueue: ${newQueueSize}`);
      
      if (initialQueueSize !== undefined && newQueueSize <= initialQueueSize) {
        console.warn(`[JOB_QUEUE:${jobId}] Queue size did not increase as expected. Before: ${initialQueueSize}, After: ${newQueueSize}`);
      }
    } catch (verifyError) {
      console.error(`[JOB_QUEUE:${jobId}] Failed to verify queue update:`, verifyError);
    }
    
    console.log(`[JOB_QUEUE:${jobId}] Successfully enqueued message for processing`);
    return true;
  } catch (error) {
    console.error(`[JOB_QUEUE:${jobId}] Failed to enqueue message:`, error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      console.error(`[JOB_QUEUE:${jobId}] Error type: ${error.name}`);
      console.error(`[JOB_QUEUE:${jobId}] Error message: ${error.message}`);
      if (error.stack) {
        console.error(`[JOB_QUEUE:${jobId}] Error stack: ${error.stack}`);
      }
      if ('cause' in error) {
        console.error(`[JOB_QUEUE:${jobId}] Error cause:`, error.cause);
      }
    }
    
    console.error(`[JOB_QUEUE:${jobId}] Redis config - URL starts with ${redisUrl.substring(0, 8)}, token length: ${redisToken.length}`);
    return false;
  }
}

// Function to process a message job from the queue
export async function processNextJob(): Promise<boolean> {
  console.log('[JOB_QUEUE] Attempting to process next job in queue');
  
  try {
    // First test Redis connection
    try {
      await redis.ping();
      console.log('[JOB_QUEUE] Redis connection OK before receiving message');
    } catch (pingError) {
      console.error('[JOB_QUEUE] Redis ping failed before receiving message:', pingError);
      // Continue with receive attempt despite ping failure
    }
    
    console.log('[JOB_QUEUE] Calling slackMessageQueue.receiveMessage');
    const message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
    console.log('[JOB_QUEUE] receiveMessage returned:', message ? `Message with streamId ${message.streamId}` : 'No message');
    
    if (!message) {
      console.log('[JOB_QUEUE] No jobs in queue to process');
      
      // Double-check with direct Redis access
      try {
        const queueLength = await redis.llen('queue:slack-message-queue:waiting');
        console.log(`[JOB_QUEUE] Direct Redis queue check: ${queueLength} items`);
        
        if (queueLength > 0) {
          console.warn('[JOB_QUEUE] Queue reported empty but direct check shows items exist');
        }
      } catch (checkError) {
        console.error('[JOB_QUEUE] Failed direct Redis queue check:', checkError);
      }
      
      return false;
    }
    
    // Log message details for diagnostic purposes
    console.log('[JOB_QUEUE] Received message details:', {
      streamId: message.streamId,
      bodyKeys: Object.keys(message.body),
      bodyType: typeof message.body,
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(message))
    });
    
    const jobId = `${message.body.userId}-${message.body.eventTs.substring(0, 8)}`;
    console.log(`[JOB_QUEUE:${jobId}] Retrieved job from queue: user ${message.body.userId}, channel ${message.body.channelId}`);
    return true;
  } catch (error) {
    console.error('[JOB_QUEUE] Error processing job from queue:', error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      console.error(`[JOB_QUEUE] Error type: ${error.name}`);
      console.error(`[JOB_QUEUE] Error message: ${error.message}`);
      if (error.stack) {
        console.error(`[JOB_QUEUE] Error stack: ${error.stack}`);
      }
    }
    
    return false;
  }
} 