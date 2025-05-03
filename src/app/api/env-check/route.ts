import { NextResponse } from 'next/server';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Mask sensitive values to avoid exposing them in logs
function maskValue(value: string): string {
  if (!value) return 'missing';
  if (value.length <= 8) return 'present (short)';
  return `present (${value.length} chars, starts with ${value.substring(0, 3)}...)`;
}

export async function GET(request: Request) {
  try {
    // Check authorization to prevent accidental exposure
    const url = new URL(request.url);
    const authKey = url.searchParams.get('auth_key');
    
    // Very basic authorization - should be improved in production
    if (authKey !== 'env_check') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check for required environment variables
    const envChecks = {
      // Slack
      SLACK_BOT_TOKEN: maskValue(process.env.SLACK_BOT_TOKEN || ''),
      SLACK_SIGNING_SECRET: maskValue(process.env.SLACK_SIGNING_SECRET || ''),
      
      // Redis
      UPSTASH_REDIS_URL: maskValue(process.env.UPSTASH_REDIS_URL || ''),
      UPSTASH_REDIS_TOKEN: maskValue(process.env.UPSTASH_REDIS_TOKEN || ''),
      
      // Worker
      WORKER_SECRET_KEY: maskValue(process.env.WORKER_SECRET_KEY || ''),
      
      // OpenAI
      OPENAI_API_KEY: maskValue(process.env.OPENAI_API_KEY || ''),
      
      // Pinecone
      PINECONE_API_KEY: maskValue(process.env.PINECONE_API_KEY || ''),
      
      // Deployment
      DEPLOYMENT_URL: process.env.DEPLOYMENT_URL || 'missing',
      VERCEL_URL: process.env.VERCEL_URL || 'missing',
      
      // Node environment
      NODE_ENV: process.env.NODE_ENV || 'missing',
    };
    
    // Check for other useful environment variables
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: process.env.HOSTNAME || 'unknown',
      currentTime: new Date().toISOString(),
    };
    
    return NextResponse.json({
      status: 'success',
      environmentVariables: envChecks,
      system: systemInfo
    });
  } catch (error) {
    console.error('Error in environment check:', error);
    return NextResponse.json({ 
      status: 'error',
      message: 'Error checking environment',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 