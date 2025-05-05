import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { validateSlackTimestamps, monitorQueueHealth, SlackMessageJob, getJobFromRedis } from '@/lib/jobQueue';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Function to create a fresh Redis client
function createRedisClient(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_URL || '',
    token: process.env.UPSTASH_REDIS_TOKEN || '',
  });
}

// Get a readable queue structure
async function getQueueStructure(): Promise<any> {
  try {
    const redis = createRedisClient();
    
    // Get all queue names
    const scanResult = await redis.scan(0, { match: 'queue:slack-message-queue:*', count: 100 });
    const queueKeys = scanResult[1] || [];
    
    // Get counts for each queue
    const queueCounts = await Promise.all(
      queueKeys.map(async (key) => {
        const count = await redis.llen(key);
        return { key, count };
      })
    );
    
    // Get sample items from each queue (up to 3)
    const queueSamples = await Promise.all(
      queueKeys.map(async (key) => {
        const items = await redis.lrange(key, 0, 2);
        // Try to parse each item
        const parsedItems = items.map(item => {
          try {
            return JSON.parse(item);
          } catch (e) {
            return { raw: item.substring(0, 100) + '...' };
          }
        });
        return { key, samples: parsedItems };
      })
    );
    
    return {
      queues: queueCounts,
      samples: queueSamples,
    };
  } catch (error) {
    console.error('[QUEUE_DIAGNOSTIC] Error getting queue structure:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Count active rate limits
async function getRateLimits(): Promise<any> {
  try {
    const redis = createRedisClient();
    
    // Get all rate limit keys
    const scanResult = await redis.scan(0, { match: 'rate:*', count: 100 });
    const rateKeys = scanResult[1] || [];
    
    // Get values and TTLs for each rate limit
    const rateLimits = await Promise.all(
      rateKeys.map(async (key) => {
        const value = await redis.get(key);
        const ttl = await redis.ttl(key);
        return { key, value, ttl };
      })
    );
    
    return rateLimits;
  } catch (error) {
    console.error('[QUEUE_DIAGNOSTIC] Error getting rate limits:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Attempt to fix common queue issues
async function attemptQueueRepairs(): Promise<any> {
  try {
    const redis = createRedisClient();
    const results = [];
    
    // Check for stuck processing jobs
    const processingCount = await redis.llen('queue:slack-message-queue:processing');
    if (processingCount > 0) {
      console.log(`[QUEUE_REPAIR] Found ${processingCount} stuck jobs in processing queue`);
      
      // Get the stuck jobs
      const stuckJobs = await redis.lrange('queue:slack-message-queue:processing', 0, -1);
      
      // Move them back to waiting
      for (const job of stuckJobs) {
        try {
          // Remove from processing queue
          await redis.lrem('queue:slack-message-queue:processing', 1, job);
          // Add to waiting queue
          await redis.rpush('queue:slack-message-queue:waiting', job);
          results.push({ action: 'moved_to_waiting', job: job.substring(0, 50) + '...' });
        } catch (moveError) {
          console.error('[QUEUE_REPAIR] Error moving stuck job:', moveError);
          results.push({ action: 'move_failed', error: moveError instanceof Error ? moveError.message : String(moveError) });
        }
      }
    }
    
    return {
      processingQueueSize: processingCount,
      repairResults: results
    };
  } catch (error) {
    console.error('[QUEUE_DIAGNOSTIC] Error repairing queue:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Main handler
export async function GET(request: Request) {
  console.log('[QUEUE_DIAGNOSTIC] Starting queue diagnostic check');
  
  try {
    // Check for repair parameter
    const url = new URL(request.url);
    const shouldRepair = url.searchParams.has('repair');
    
    // Run diagnostics
    const [healthData, structureData, rateLimitData, sampleJob] = await Promise.all([
      monitorQueueHealth(),
      getQueueStructure(),
      getRateLimits(),
      getJobFromRedis()
    ]);
    
    // Attempt repairs if requested
    let repairData = null;
    if (shouldRepair) {
      repairData = await attemptQueueRepairs();
    }
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      health: healthData,
      structure: structureData,
      rateLimits: rateLimitData,
      nextJob: sampleJob ? {
        userId: sampleJob.job.userId,
        channelId: sampleJob.job.channelId,
        questionTextPreview: sampleJob.job.questionText.substring(0, 50) + '...',
        eventTs: sampleJob.job.eventTs
      } : null,
      repairs: repairData
    });
  } catch (error) {
    console.error('[QUEUE_DIAGNOSTIC] Error during diagnostic:', error);
    return NextResponse.json({ 
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
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