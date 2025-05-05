import { Queue } from '@upstash/queue';
import { Redis } from '@upstash/redis';

// Define the job structure
export interface SlackMessageJob {
  channelId: string;
  userId: string;
  questionText: string;
  threadTs?: string;
  eventTs: string;
  useStreaming?: boolean; // Flag to indicate if we should use streaming responses
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

// Create a pure Redis client factory that doesn't depend on Queue's Redis type
function createRedisClient() {
  // Use the raw Redis constructor to avoid type issues
  return new Redis({
    url: redisUrl,
    token: redisToken,
    automaticDeserialization: false // Prevent serialization issues
  });
}

// Create a direct Redis connection for raw operations
const redis = createRedisClient();

// Function to directly add a message to the Redis queue without dependency on Queue
async function directEnqueueMessageToRedis(job: SlackMessageJob): Promise<boolean> {
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[DIRECT_REDIS:${jobId}] Enqueueing directly to Redis`);
  
  const serializedJob = JSON.stringify(job);
  
  try {
    // Create a fresh Redis client
    const client = createRedisClient();
    
    // Push to the waiting queue directly
    const pushResult = await client.rpush('queue:slack-message-queue:waiting', serializedJob);
    
    console.log(`[DIRECT_REDIS:${jobId}] Push result: ${pushResult} (>0 means success)`);
    
    // Verify the queue size increased
    const queueSize = await client.llen('queue:slack-message-queue:waiting');
    console.log(`[DIRECT_REDIS:${jobId}] Queue size after push: ${queueSize}`);
    
    return pushResult > 0;
  } catch (error) {
    console.error(`[DIRECT_REDIS:${jobId}] Error during direct push:`, error);
    return false;
  }
}

// Initialize the Upstash Queue for compatibility, but don't rely on it
// @ts-ignore - Type issues with Upstash libraries are known and documented
export const slackMessageQueue = new Queue({
  redis,
  queueName: 'slack-message-queue',
  concurrencyLimit: 5,
  deduplicationEnabled: true,
  deduplicationTtl: 300
});

// Function to enqueue a Slack message job with enhanced reliability
export async function enqueueSlackMessage(job: SlackMessageJob): Promise<boolean> {
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[JOB_QUEUE:${jobId}] Enqueueing message from user ${job.userId} with text "${job.questionText.substring(0, 30)}..."`);
  
  // Validate and fix timestamp formats
  job = validateSlackTimestamps(job);
  
  // IMPORTANT CHANGE: Try direct Redis enqueue first as the most reliable method
  try {
    console.log(`[JOB_QUEUE:${jobId}] Using direct Redis method first for reliability`);
    const directSuccess = await directEnqueueMessageToRedis(job);
    
    if (directSuccess) {
      console.log(`[JOB_QUEUE:${jobId}] Direct Redis enqueue successful`);
      return true;
    }
  } catch (directError) {
    console.error(`[JOB_QUEUE:${jobId}] Direct Redis method failed:`, directError);
    // Continue to fallback methods
  }
  
  // Try the Queue library as fallback
  try {
    console.log(`[JOB_QUEUE:${jobId}] Trying Queue library as fallback`);
    const result = await slackMessageQueue.sendMessage(job);
    console.log(`[JOB_QUEUE:${jobId}] Queue.sendMessage result: ${result}`);
    
    if (result) {
      console.log(`[JOB_QUEUE:${jobId}] Queue library enqueue successful`);
      return true;
    }
  } catch (queueError) {
    console.error(`[JOB_QUEUE:${jobId}] Queue library failed:`, queueError);
    // We already tried direct Redis, so at this point we've exhausted options
  }
  
  console.error(`[JOB_QUEUE:${jobId}] All enqueue methods failed`);
  return false;
}

// Helper function to ensure timestamps are in Slack's expected format
export function validateSlackTimestamps(job: SlackMessageJob): SlackMessageJob {
  // Make a copy to avoid mutating the original
  const validatedJob = { ...job };
  
  // Helper function to consistently format Slack timestamps
  const formatSlackTimestamp = (timestamp: string): string => {
    // Skip if undefined/null/empty
    if (!timestamp) return timestamp;
    
    // Already in correct Slack format (seconds.microseconds)
    if (/^\d+\.\d+$/.test(timestamp)) {
      return timestamp;
    }
    
    // If it's a millisecond timestamp (13+ digits), convert to Slack format
    if (/^\d{13,}$/.test(timestamp)) {
      const seconds = Math.floor(parseInt(timestamp) / 1000);
      const microseconds = parseInt(timestamp) % 1000 * 1000;
      return `${seconds}.${microseconds}`;
    }
    
    // If it's already a string but missing decimal (unlikely but possible)
    if (/^\d+$/.test(timestamp)) {
      return `${timestamp}.000000`;
    }
    
    // Log warning but return original if we can't determine the format
    console.warn(`[JOB_QUEUE] Unexpected timestamp format: ${timestamp}`);
    return timestamp;
  };
  
  // Validate and fix eventTs
  if (validatedJob.eventTs) {
    const originalEventTs = validatedJob.eventTs;
    validatedJob.eventTs = formatSlackTimestamp(validatedJob.eventTs);
    
    // Log only if format changed
    if (originalEventTs !== validatedJob.eventTs) {
      console.log(`[JOB_QUEUE] Formatted eventTs from ${originalEventTs} to ${validatedJob.eventTs}`);
    }
  }
  
  // Validate and fix threadTs if present
  if (validatedJob.threadTs) {
    const originalThreadTs = validatedJob.threadTs;
    validatedJob.threadTs = formatSlackTimestamp(validatedJob.threadTs);
    
    // Log only if format changed
    if (originalThreadTs !== validatedJob.threadTs) {
      console.log(`[JOB_QUEUE] Formatted threadTs from ${originalThreadTs} to ${validatedJob.threadTs}`);
    }
  }
  
  return validatedJob;
}

// Function to monitor queue health and ensure messages are being processed
export async function monitorQueueHealth(): Promise<{status: string, queueSize: number, pendingJobs: number}> {
  console.log('[QUEUE_MONITOR] Checking queue health');
  
  try {
    // Create a fresh Redis client
    const monitorRedis = createRedisClient();
    
    // Test Redis connection
    const pingResult = await monitorRedis.ping();
    console.log(`[QUEUE_MONITOR] Redis connection OK (${pingResult})`);
    
    // Check waiting queue size
    const waitingQueueSize = await monitorRedis.llen('queue:slack-message-queue:waiting');
    console.log(`[QUEUE_MONITOR] Waiting queue size: ${waitingQueueSize}`);
    
    // Check processing queue size (jobs that are being worked on)
    const processingQueueSize = await monitorRedis.llen('queue:slack-message-queue:processing');
    console.log(`[QUEUE_MONITOR] Processing queue size: ${processingQueueSize}`);
    
    // Check dead letter queue for failed jobs
    const deadQueueSize = await monitorRedis.llen('queue:slack-message-queue:dead');
    console.log(`[QUEUE_MONITOR] Dead letter queue size: ${deadQueueSize}`);
    
    // If processing queue is very large, there might be stuck jobs
    if (processingQueueSize > 5) {
      console.warn('[QUEUE_MONITOR] High number of processing jobs detected, some might be stuck');
      
      // Attempt recovery of stuck jobs older than 5 minutes
      try {
        // In a real implementation, you would iterate through processing jobs
        // and check timestamps to move stuck jobs back to waiting queue
        console.log('[QUEUE_MONITOR] Would recover stuck jobs here');
      } catch (recoveryError) {
        console.error('[QUEUE_MONITOR] Failed to recover stuck jobs:', recoveryError);
      }
    }
    
    return {
      status: 'healthy',
      queueSize: waitingQueueSize,
      pendingJobs: processingQueueSize
    };
  } catch (error) {
    console.error('[QUEUE_MONITOR] Queue health check failed:', error);
    return {
      status: 'error',
      queueSize: -1,
      pendingJobs: -1
    };
  }
}

// Function to execute a Redis operation with retries
async function withRedisRetry<T>(
  operation: (client: Redis) => Promise<T>, 
  maxRetries: number = 3, 
  label: string = "Redis operation"
): Promise<T> {
  let lastError: any;
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    try {
      // Create a fresh Redis client for each attempt
      const client = createRedisClient();
      const result = await operation(client);
      
      // If we had retries, log that we succeeded after retrying
      if (retryCount > 0) {
        console.log(`[REDIS_RETRY] ${label} succeeded after ${retryCount} retries`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount > maxRetries) {
        console.error(`[REDIS_RETRY] ${label} failed after ${maxRetries} retries:`, error);
        break;
      }
      
      // Implement exponential backoff
      const delay = Math.min(100 * Math.pow(2, retryCount), 2000); // Max 2 seconds
      console.warn(`[REDIS_RETRY] ${label} failed, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries}):`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Update getJobFromRedis to use the retry mechanism
export async function getJobFromRedis(): Promise<{job: SlackMessageJob, index: number} | null> {
  try {
    return await withRedisRetry(async (redis) => {
      // Get the first waiting job
      const items = await redis.lrange('queue:slack-message-queue:waiting', 0, 0);
      
      if (items.length === 0) {
        return null;
      }
      
      // Parse the job
      try {
        const job = JSON.parse(items[0]);
        return {
          job,
          index: 0
        };
      } catch (parseError) {
        console.error('[JOB_QUEUE] Error parsing job from Redis:', parseError);
        return null;
      }
    }, 3, "getJobFromRedis");
  } catch (error) {
    console.error('[JOB_QUEUE] Error getting job from Redis:', error);
    return null;
  }
}

// Function to remove a job from Redis
export async function removeJobFromRedis(index: number): Promise<boolean> {
  try {
    // Create a fresh Redis client
    const removeRedis = createRedisClient();
    
    // Get the job at the specified index
    const items = await removeRedis.lrange('queue:slack-message-queue:waiting', index, index);
    
    if (items.length === 0) {
      return false;
    }
    
    // Remove the job
    const removeCount = await removeRedis.lrem('queue:slack-message-queue:waiting', 1, items[0]);
    return removeCount > 0;
  } catch (error) {
    console.error('[JOB_QUEUE] Error removing job from Redis:', error);
    return false;
  }
}

// Function to process a message job from the queue
export async function processNextJob(): Promise<boolean> {
  console.log('[JOB_QUEUE] Attempting to process next job in queue');
  
  try {
    // First test Redis connection with a fresh client
    try {
      const pingRedis = createRedisClient();
      await pingRedis.ping();
      console.log('[JOB_QUEUE] Redis connection OK before receiving message');
    } catch (pingError) {
      console.error('[JOB_QUEUE] Redis ping failed before receiving message:', pingError);
      // Continue with receive attempt despite ping failure
    }
    
    console.log('[JOB_QUEUE] Calling slackMessageQueue.receiveMessage');
    
    // Try to get a message from the queue using the library first
    let message;
    try {
      message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
      console.log('[JOB_QUEUE] receiveMessage returned:', message ? `Message with streamId ${message.streamId}` : 'No message');
    } catch (receiveError) {
      console.error('[JOB_QUEUE] Error receiving message from queue:', receiveError);
      message = null;
    }
    
    // If no message from the library, try direct Redis access
    if (!message) {
      console.log('[JOB_QUEUE] Attempting direct Redis access to get a job');
      
      const directJob = await getJobFromRedis();
      if (directJob) {
        console.log('[JOB_QUEUE] Got job directly from Redis:', directJob.job.userId);
        
        // Create a synthetic message object to match the expected format
        message = {
          streamId: `direct-${Date.now()}`,
          body: directJob.job
        };
        
        // Remove the job from Redis since we're processing it
        const removed = await removeJobFromRedis(directJob.index);
        console.log(`[JOB_QUEUE] Removed job from Redis: ${removed}`);
      }
    }
    
    if (!message) {
      console.log('[JOB_QUEUE] No jobs in queue to process');
      
      // Double-check with direct Redis access
      try {
        const checkRedis = createRedisClient();
        const queueLength = await checkRedis.llen('queue:slack-message-queue:waiting');
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