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

// Initialize the Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL || '',
  token: process.env.UPSTASH_REDIS_TOKEN || '',
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