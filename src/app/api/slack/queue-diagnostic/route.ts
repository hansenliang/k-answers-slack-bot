import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { validateSlackTimestamps, monitorQueueHealth, SlackMessageJob } from '@/lib/jobQueue';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    // Check authentication
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('key');
    const expectedKey = process.env.WORKER_SECRET_KEY || '';
    
    if (queryKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Connect to Redis
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL || '',
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    });
    
    // Get queue stats
    const queueHealth = await monitorQueueHealth();
    
    // Get sample job from queue for inspection (without removing it)
    const waitingJobs = await redis.lrange('queue:slack-message-queue:waiting', 0, 0);
    let sampleJob = null;
    
    if (waitingJobs.length > 0) {
      try {
        // Parse and validate job format
        const rawJob = JSON.parse(waitingJobs[0]);
        
        // Extract SlackMessageJob from expected format
        let job: SlackMessageJob | null = null;
        
        if (rawJob.body && typeof rawJob.body === 'object') {
          // Standard queue format
          job = rawJob.body as SlackMessageJob;
        } else if (rawJob.channelId && rawJob.userId) {
          // Direct job format
          job = rawJob as SlackMessageJob;
        }
        
        if (job) {
          // Check timestamp formats and create diagnostic info
          sampleJob = {
            original: {
              ...job,
              questionText: job.questionText.substring(0, 50) + (job.questionText.length > 50 ? '...' : '')
            },
            timestamps: {
              eventTs: job.eventTs,
              threadTs: job.threadTs,
              eventTsFormat: job.eventTs.includes('.') ? 'valid' : 'invalid',
              threadTsFormat: job.threadTs ? (job.threadTs.includes('.') ? 'valid' : 'invalid') : 'not_present'
            },
            validated: validateSlackTimestamps(job)
          };
        }
      } catch (parseError) {
        console.error('[QUEUE_DIAG] Failed to parse job:', parseError);
        sampleJob = { error: 'Failed to parse job', details: parseError instanceof Error ? parseError.message : String(parseError) };
      }
    }
    
    // Get information about dead letter queue if any
    let deadLetterJobs = [];
    try {
      const deadQueueItems = await redis.lrange('queue:slack-message-queue:dead', 0, 2);
      if (deadQueueItems.length > 0) {
        deadLetterJobs = deadQueueItems.map(item => {
          try {
            const parsed = JSON.parse(item);
            // Truncate and sanitize data for the response
            if (parsed.body && typeof parsed.body === 'object') {
              return {
                streamId: parsed.streamId,
                error: parsed.error,
                timestamp: parsed.timestamp,
                body: {
                  ...parsed.body,
                  questionText: parsed.body.questionText ? 
                    parsed.body.questionText.substring(0, 50) + (parsed.body.questionText.length > 50 ? '...' : '') : 
                    'undefined'
                }
              };
            }
            return parsed;
          } catch (e) {
            return { parseError: 'Failed to parse dead letter queue item' };
          }
        });
      }
    } catch (deadQueueError) {
      console.error('[QUEUE_DIAG] Failed to inspect dead letter queue:', deadQueueError);
    }
    
    // Get Redis connection info (sanitized)
    const redisInfo = {
      urlValid: (process.env.UPSTASH_REDIS_URL || '').startsWith('https://'),
      tokenPresent: !!process.env.UPSTASH_REDIS_TOKEN,
      connectionStatus: 'connected' // We know it's connected because we got this far
    };
    
    return NextResponse.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      queueHealth,
      sampleJob,
      redisInfo,
      deadLetterJobs: deadLetterJobs.length > 0 ? deadLetterJobs : undefined,
      diagnosticMode: url.searchParams.get('mode') || 'standard'
    });
  } catch (error) {
    console.error('[QUEUE_DIAG] Diagnostic error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

// Add a POST endpoint for manual queue operations (fixing issues)
export async function POST(request: Request) {
  try {
    // Check authentication
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('key');
    const expectedKey = process.env.WORKER_SECRET_KEY || '';
    
    if (queryKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Parse request body
    const body = await request.json();
    const operation = body.operation;
    
    if (!operation) {
      return NextResponse.json({ error: 'Missing operation parameter' }, { status: 400 });
    }
    
    // Connect to Redis
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL || '',
      token: process.env.UPSTASH_REDIS_TOKEN || '',
    });
    
    let result;
    
    // Handle different operations
    switch (operation) {
      case 'flush_queue':
        // Flush the entire queue (for emergencies only)
        console.warn('[QUEUE_DIAG] Flushing entire queue');
        await redis.del('queue:slack-message-queue:waiting');
        await redis.del('queue:slack-message-queue:processing');
        result = { operation: 'flush_queue', status: 'success' };
        break;
        
      case 'recover_stuck_jobs':
        // Move jobs from processing back to waiting
        console.log('[QUEUE_DIAG] Recovering stuck jobs');
        const processingJobs = await redis.lrange('queue:slack-message-queue:processing', 0, -1);
        
        if (processingJobs.length > 0) {
          console.log(`[QUEUE_DIAG] Found ${processingJobs.length} jobs to recover`);
          
          // Move each job back to waiting queue
          for (const job of processingJobs) {
            await redis.lpush('queue:slack-message-queue:waiting', job);
          }
          
          // Clear processing queue
          await redis.del('queue:slack-message-queue:processing');
          
          result = { 
            operation: 'recover_stuck_jobs', 
            status: 'success', 
            jobsRecovered: processingJobs.length 
          };
        } else {
          result = { 
            operation: 'recover_stuck_jobs', 
            status: 'success', 
            jobsRecovered: 0,
            message: 'No stuck jobs found' 
          };
        }
        break;
        
      default:
        return NextResponse.json({ error: 'Invalid operation' }, { status: 400 });
    }
    
    return NextResponse.json({
      status: 'success',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[QUEUE_DIAG] Operation error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 