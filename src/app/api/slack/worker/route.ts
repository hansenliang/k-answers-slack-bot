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
      useStreaming = false // Default to non-streaming mode
    } = job;
    
    // Check if we're processing a draining request
    const url = new URL(request.url);
    const isDrain = url.searchParams.get('drain') === '1';
    
    if (isDrain) {
      console.log('[WORKER] Processing drain request - queue cleanup');
      return NextResponse.json({ status: 'drain_processed' });
    }
    
    // Validate required fields - at minimum we need questionText and either channelId or response_url
    if (!questionText || (!channelId && !response_url)) {
      console.error('[WORKER] Missing required job fields');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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
        console.log('[WORKER] Using response_url to respond');
        const res = await fetch(response_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ text: answer })
        });
        
        if (!res.ok) {
          console.error('[WORKER] Failed to send response via response_url:', await res.text());
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
        await slackCall(webClient.chat.update, {
          channel: channelId,
          ts: stub_ts,
          text: answer
        });
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
        
        await slackCall(webClient.chat.postMessage, messageParams);
        console.log('[WORKER] Sent new message with answer');
      }
      
      return NextResponse.json({ status: 'success', mode: 'standard' });
    } catch (ragError) {
      console.error('[WORKER] Error during RAG processing:', ragError);
      
      // User-visible error fallback
      if (stub_ts && channelId && webClient) {
        await slackCall(webClient.chat.update, {
          channel: channelId,
          ts: stub_ts,
          text: "⚠️ Sorry, I hit an error tracking down the docs. Please try again."
        });
      } else if (response_url) {
        // Try using response_url as fallback
        try {
          await fetch(response_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
              text: "⚠️ Sorry, I hit an error tracking down the docs. Please try again." 
            })
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