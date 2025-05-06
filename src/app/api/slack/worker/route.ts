import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { queryRag, streamRag } from '@/lib/rag';

// Set runtime to nodejs for the worker function
export const runtime = 'nodejs';

// Set maximum function duration to 10 seconds (Vercel Hobby limit)
export const maxDuration = 10;

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

// Helper function to retry Slack API calls once on rate limit
async function callSlackWithRetry<T>(
  apiCall: () => Promise<T>
): Promise<T> {
  try {
    return await apiCall();
  } catch (error: any) {
    // Check if it's a rate limit error
    const isRateLimit = error?.data?.error === 'ratelimited';
    
    if (isRateLimit) {
      console.log('[WORKER] Hit Slack rate limit, retrying after 1s');
      // Wait 1 second and retry once
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await apiCall();
    }
    
    // Not a rate limit or already retried, rethrow
    throw error;
  }
}

// Improved slack API call helper with recursive retries for rate limits
async function slackCall<T>(
  method: (params: any) => Promise<T>,
  params: any,
  attempts = 3
): Promise<T> {
  try {
    return await method(params);
  } catch (error: any) {
    if (error?.data?.error === 'ratelimited' && attempts > 0) {
      // Sleep for just over 1 second (Slack's rate limit is 1 msg/sec per channel)
      await new Promise(resolve => setTimeout(resolve, 1100)); 
      return slackCall(method, params, attempts - 1);
    }
    throw error;
  }
}

// Process RAG query with streaming updates
async function processWithStreaming(
  questionText: string, 
  channelId: string, 
  stubTs: string
): Promise<boolean> {
  console.log('[WORKER] Processing with streaming updates');
  
  let lastUpdateTime = Date.now();
  let lastContent = "";
  
  try {
    // Handle streaming content
    await streamRag(questionText, async (content) => {
      // Only update if there's meaningful content and it's been at least 2 seconds since the last update
      const now = Date.now();
      if (content && content !== "Thinking..." && (now - lastUpdateTime >= 2000)) {
        try {
          await slackCall(webClient!.chat.update, {
            channel: channelId,
            ts: stubTs,
            text: content
          });
          lastUpdateTime = now;
          lastContent = content;
          console.log(`[WORKER] Updated message with streaming content (${content.length} chars)`);
        } catch (updateError) {
          console.error('[WORKER] Error updating message during streaming:', updateError);
          // Continue streaming even if an update fails
        }
      }
    });
    
    // Final update if the last content update wasn't recent
    if (Date.now() - lastUpdateTime >= 1000 && lastContent) {
      try {
        await slackCall(webClient!.chat.update, {
          channel: channelId,
          ts: stubTs,
          text: lastContent
        });
        console.log('[WORKER] Sent final streaming content update');
      } catch (finalUpdateError) {
        console.error('[WORKER] Error sending final content update:', finalUpdateError);
      }
    }
    
    return true;
  } catch (error) {
    console.error('[WORKER] Error in streaming process:', error);
    
    // If we have partial content, try to send that
    if (lastContent) {
      try {
        await slackCall(webClient!.chat.update, {
          channel: channelId,
          ts: stubTs,
          text: lastContent + "\n\n(Note: This response may be incomplete due to a processing error.)"
        });
      } catch (errorUpdateError) {
        console.error('[WORKER] Failed to update message with error note:', errorUpdateError);
      }
    } else {
      // No content was generated - show user-visible error
      try {
        await slackCall(webClient!.chat.update, {
          channel: channelId,
          ts: stubTs,
          text: "⚠️ Sorry, I hit an error tracking down the docs. Please try again."
        });
      } catch (errorUpdateError) {
        console.error('[WORKER] Failed to update message with error:', errorUpdateError);
      }
    }
    
    return false;
  }
}

// Simple idempotency helper using the event timestamp
// This prevents duplicate processing if QStash delivers the same job multiple times
const processedJobs = new Map<string, number>();
const PROCESSED_EXPIRY_MS = 60 * 60 * 1000; // Keep entries for 1 hour

// Periodically clean up old entries to prevent memory leaks
setInterval(() => {
  const cutoffTime = Date.now() - PROCESSED_EXPIRY_MS;
  const expiredIds = [];
  for (const [jobId, timestamp] of processedJobs.entries()) {
    if (timestamp && typeof timestamp === 'number' && timestamp < cutoffTime) {
      expiredIds.push(jobId);
    }
  }
  expiredIds.forEach(id => processedJobs.delete(id));
}, 15 * 60 * 1000); // Run cleanup every 15 minutes

export async function POST(request: Request) {
  console.log('[WORKER] Worker received request');
  
  try {
    // Parse the request body
    const job = await request.json();
    console.log('[WORKER] Processing job:', job);
    
    // Extract job details
    const { 
      questionText, 
      channelId, 
      threadTs, 
      stub_ts, 
      channel_type,
      response_url, // Support for response_url from slash commands
      useStreaming = false, // Default to non-streaming mode
      eventTs // Used for idempotency check
    } = job;
    
    // Log job details for debugging
    console.log("[WORKER] Job received", {
      channelId,
      stub_ts,
      threadTs,
      text_len: questionText?.length
    });
    
    // Check for diagnostic/health requests
    const url = new URL(request.url);
    const isDiagnostic = url.searchParams.get('diagnostic') === '1' || 
                          url.searchParams.get('health') === '1' ||
                          url.searchParams.get('drain') === '1';
    
    if (isDiagnostic) {
      console.log('[WORKER] Processing diagnostic/health request');
      return NextResponse.json({ 
        status: 'healthy',
        mode: 'diagnostic',
        message: 'Worker endpoint is functioning correctly' 
      });
    }
    
    // Validate required fields - at minimum we need questionText and either channelId or response_url
    if (!questionText || (!channelId && !response_url)) {
      console.error('[WORKER] Missing required job fields');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Check idempotency - avoid processing the same message twice
    // This is important when QStash delivers a message multiple times
    if (eventTs) {
      const jobId = `${threadTs || channelId}-${eventTs}`;
      if (processedJobs.has(jobId)) {
        console.log(`[WORKER] Skipping already processed job: ${jobId}`);
        return NextResponse.json({ 
          status: 'skipped', 
          message: 'Job already processed', 
          jobId 
        });
      }

      // Mark this job as being processed
      processedJobs.set(jobId, Date.now());
    }
    
    // Only use streaming if explicitly enabled via environment variable
    const streamingEnabled = process.env.ENABLE_STREAMING === "true" && useStreaming;
    
    // If we have a stub message and streaming is enabled, use streaming mode
    if (stub_ts && channelId && webClient && streamingEnabled) {
      const success = await processWithStreaming(questionText, channelId, stub_ts);
      return NextResponse.json({ 
        status: success ? 'success' : 'partial_success', 
        mode: 'streaming' 
      });
    }
    
    // Otherwise, process normally (standard single response)
    console.log(`[WORKER] Calling RAG with question: "${questionText.substring(0, 30)}..."`);
    
    try {
      // Process the RAG query - this is the heavy part (can take 8-9s)
      const startTime = Date.now();
      const answer = await queryRag(questionText);
      const processingTime = Date.now() - startTime;
      console.log(`[WORKER] RAG processing completed in ${processingTime}ms`);
      
      // If we have response_url and no bot token, use response_url
      if (response_url && !webClient) {
        console.log('[WORKER] About to send answer via response_url');
        const res = await fetch(response_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ text: answer })
        });
        
        const responseText = await res.text().catch(() => "no body");
        console.log('[WORKER] Response URL fetch result:', { status: res.status, body: responseText });
        
        if (!res.ok) {
          console.error('[WORKER] Failed to send response via response_url:', responseText);
          return NextResponse.json({ status: 'error', error: 'Failed to send response' }, { status: 500 });
        }
        
        return NextResponse.json({ status: 'success', mode: 'response_url' });
      }
      
      // Check if Slack client is available for normal messaging
      if (!webClient) {
        console.error('[WORKER] Slack client not initialized and no response_url available');
        return NextResponse.json({ error: 'Slack client not initialized' }, { status: 500 });
      }
      
      // If we have a stub message, update it
      if (stub_ts && channelId) {
        console.log('[WORKER] About to send answer via chat.update', { stub_ts });
        const updateResult = await slackCall(webClient.chat.update, {
          channel: channelId,
          ts: stub_ts,
          text: answer
        });
        console.log('[WORKER] Slack API update response:', updateResult);
        console.log('[WORKER] Updated thinking message with answer');
      } else if (channelId) {
        // Otherwise, send a new message
        // Use thread_ts conditionally based on channel type
        const messageParams: any = {
          channel: channelId,
          text: answer
        };
        
        // Only thread in channels/groups, not in DMs
        if (threadTs && channel_type !== 'im' && channel_type !== 'mpim') {
          messageParams.thread_ts = threadTs;
        }
        
        console.log('[WORKER] About to send answer via new message', { channelId, hasThreadTs: !!threadTs });
        const postResult = await slackCall(webClient.chat.postMessage, messageParams);
        console.log('[WORKER] Slack API postMessage response:', postResult);
        console.log('[WORKER] Sent new message with answer');
      }
      
      return NextResponse.json({ status: 'success', mode: 'standard' });
    } catch (ragError) {
      console.error('[WORKER] Error during RAG processing:', ragError);
      
      // User-visible error fallback
      if (stub_ts && channelId && webClient) {
        console.log('[WORKER] About to update message with error notification', { stub_ts });
        const errorResult = await slackCall(webClient.chat.update, {
          channel: channelId,
          ts: stub_ts,
          text: "⚠️ Sorry, I hit an error tracking down the docs. Please try again."
        });
        console.log('[WORKER] Error notification update result:', errorResult);
      } else if (response_url) {
        // Try using response_url as fallback
        try {
          console.log('[WORKER] About to send error via response_url');
          const errorRes = await fetch(response_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
              text: "⚠️ Sorry, I hit an error tracking down the docs. Please try again." 
            })
          });
          
          console.log('[WORKER] Error response_url result:', { 
            status: errorRes.status, 
            ok: errorRes.ok,
            body: await errorRes.text().catch(() => "no body")
          });
        } catch (responseUrlError) {
          console.error('[WORKER] Failed to send error via response_url:', responseUrlError);
        }
      }
      
      // Re-throw the error for proper logging
      throw ragError;
    }
  } catch (error) {
    console.error('[WORKER] Unhandled error:', error);
    return NextResponse.json({ 
      status: 'error', 
      error: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
} 