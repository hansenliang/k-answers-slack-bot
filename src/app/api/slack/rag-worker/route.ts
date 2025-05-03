import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { slackMessageQueue } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';
import { SlackMessageJob } from '@/lib/jobQueue';

// Define the runtime as edge to avoid timeout issues
export const runtime = 'edge';

// Initialize Slack client
console.log('[WORKER_INIT] Initializing Slack WebClient');
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
console.log('[WORKER_INIT] WebClient initialized');

// Process a job from the queue
async function processJob(job: SlackMessageJob): Promise<boolean> {
  console.log(`[WORKER] Processing job for user ${job.userId}, channel ${job.channelId}`);
  
  try {
    // Query the RAG system
    console.log(`[WORKER] Calling queryRag for message: "${job.questionText}"`);
    const startTime = Date.now();
    const answer = await queryRag(job.questionText);
    console.log(`[WORKER] Received answer from queryRag in ${Date.now() - startTime}ms`);

    // Send the response back to the user
    console.log(`[WORKER] Sending response to user ${job.userId} in channel ${job.channelId}`);
    await webClient.chat.postMessage({
      channel: job.channelId,
      text: answer,
      thread_ts: job.threadTs,
    });

    console.log(`[WORKER] Successfully sent response to user ${job.userId}`);
    return true;
  } catch (error) {
    console.error('[WORKER] Error processing job:', error);
    
    try {
      // Notify the user of the error
      await webClient.chat.postMessage({
        channel: job.channelId,
        text: "I encountered an error while processing your question. Please try again later.",
        thread_ts: job.threadTs,
      });
      console.log(`[WORKER] Sent error notification to user ${job.userId}`);
    } catch (postError) {
      console.error('[WORKER] Failed to send error message:', postError);
    }
    
    return false;
  }
}

// Main handler for the worker route
export async function GET(request: Request) {
  console.log('[WORKER] Worker endpoint called');
  
  try {
    // For cron jobs from Vercel, we can rely on the fact that they are internal
    // and skip the authentication check
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const isCronJob = request.headers.get('x-vercel-cron') === 'true';
    
    // If it's not a cron job and the key doesn't match, reject the request
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
    
    console.log(`[WORKER] Retrieved message from queue: ${JSON.stringify(message.body)}`);
    
    // Process the job
    const success = await processJob(message.body);
    
    // Verify the message if processing was successful
    if (success) {
      console.log('[WORKER] Job processed successfully, verifying message');
      await slackMessageQueue.verifyMessage(message.streamId);
      console.log('[WORKER] Message verified successfully');
    }
    
    return NextResponse.json({ 
      status: success ? 'success' : 'error',
      jobId: message.streamId
    });
  } catch (error) {
    console.error('[WORKER] Unhandled error in worker:', error);
    return NextResponse.json({ 
      status: 'error',
      message: 'Internal server error'
    }, { status: 500 });
  }
}

// Also handle POST requests to support both GET and POST
export async function POST(request: Request) {
  return GET(request);
} 