import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { slackMessageQueue } from '@/lib/jobQueue';
import { queryRag } from '@/lib/rag';
import { SlackMessageJob } from '@/lib/jobQueue';

// Define the runtime as nodejs to support fs, path, and other Node.js core modules
export const runtime = 'nodejs';

// Initialize Slack client
console.log('[WORKER_INIT] Initializing Slack WebClient');
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
console.log('[WORKER_INIT] WebClient initialized');

// Process a job from the queue
async function processJob(job: SlackMessageJob): Promise<boolean> {
  const startTime = Date.now();
  const jobId = `${job.userId}-${job.eventTs.substring(0, 8)}`;
  console.log(`[WORKER:${jobId}] Starting to process job for user ${job.userId}, channel ${job.channelId}`);
  
  try {
    // Set up timeout for intermediate message (5 seconds)
    const timeoutId = setTimeout(async () => {
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
    
    // Query the RAG system
    console.log(`[WORKER:${jobId}] Calling queryRag for message: "${job.questionText}"`);
    let answer;
    try {
      answer = await queryRag(job.questionText);
      console.log(`[WORKER:${jobId}] Received answer from queryRag in ${Date.now() - startTime}ms, length: ${answer.length} chars`);
    } catch (ragError) {
      // Clear the timeout as we're handling the error now
      clearTimeout(timeoutId);
      console.error(`[WORKER:${jobId}] Error from queryRag:`, ragError);
      throw ragError; // Re-throw to be caught by the outer catch
    }
    
    // Clear the timeout as we got the answer
    clearTimeout(timeoutId);

    // Send the response back to the user
    console.log(`[WORKER:${jobId}] Sending response to user ${job.userId} in channel ${job.channelId}`);
    try {
      const messageResult = await webClient.chat.postMessage({
        channel: job.channelId,
        text: answer,
        thread_ts: job.threadTs,
      });

      console.log(`[WORKER:${jobId}] Successfully sent response, message ts: ${messageResult.ts}`);
      return true;
    } catch (slackError) {
      console.error(`[WORKER:${jobId}] Failed to send message to Slack:`, slackError);
      
      // Try to send a shorter error message as a fallback
      try {
        await webClient.chat.postMessage({
          channel: job.channelId,
          text: "I generated an answer but encountered an error sending it. The response might be too long or there was a network issue. Please try a more specific question.",
          thread_ts: job.threadTs,
        });
        console.log(`[WORKER:${jobId}] Sent error notification after failed response`);
      } catch (fallbackError) {
        console.error(`[WORKER:${jobId}] Even the fallback error message failed:`, fallbackError);
      }
      
      throw slackError; // Re-throw to be caught by the outer catch
    }
  } catch (error) {
    console.error(`[WORKER:${jobId}] Error processing job:`, error);
    
    try {
      // Notify the user of the error
      await webClient.chat.postMessage({
        channel: job.channelId,
        text: "I encountered an error while processing your question. Please try again later.",
        thread_ts: job.threadTs,
      });
      console.log(`[WORKER:${jobId}] Sent error notification to user ${job.userId}`);
    } catch (postError) {
      console.error(`[WORKER:${jobId}] Failed to send error message:`, postError);
    }
    
    return false;
  } finally {
    console.log(`[WORKER:${jobId}] Job processing completed in ${Date.now() - startTime}ms`);
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
    
    console.log(`[WORKER] Request type: ${isCronJob ? 'Vercel cron job' : 'External call'}, has key: ${!!key}`);
    
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