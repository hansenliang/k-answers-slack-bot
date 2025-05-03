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
  try {
    console.log(`[JOB_QUEUE] Enqueueing message from user ${job.userId} with text "${job.questionText}"`);
    await slackMessageQueue.sendMessage(job);
    console.log(`[JOB_QUEUE] Successfully enqueued message for processing`);
    return true;
  } catch (error) {
    console.error('[JOB_QUEUE] Failed to enqueue message:', error);
    console.error(`[JOB_QUEUE] Redis config - URL starts with ${redisUrl.substring(0, 8)}, token length: ${redisToken.length}`);
    return false;
  }
}

// Function to process a message job from the queue
export async function processNextJob(): Promise<boolean> {
  try {
    console.log('[JOB_QUEUE] Attempting to process next job in queue');
    const message = await slackMessageQueue.receiveMessage<SlackMessageJob>();
    
    if (!message) {
      console.log('[JOB_QUEUE] No jobs in queue to process');
      return false;
    }
    
    console.log(`[JOB_QUEUE] Retrieved job from queue: user ${message.body.userId}, channel ${message.body.channelId}`);
    return true;
  } catch (error) {
    console.error('[JOB_QUEUE] Error processing job from queue:', error);
    return false;
  }
} 