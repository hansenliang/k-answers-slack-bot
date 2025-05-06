import { NextResponse } from 'next/server';

// Simple health check endpoint for monitoring
export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'k-answers-slack-bot'
  });
} 