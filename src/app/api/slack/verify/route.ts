import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { SLACK_SIGNING_SECRET, validateSlackEnvironment } from '@/lib/env';

// Set runtime to nodejs to support Node.js built-in modules
export const runtime = 'nodejs';

// Handle Slack signature verification requests
export async function POST(request: Request) {
  console.log('[SLACK_VERIFY] Received verification request');
  
  // Validate Slack environment variables
  const slackEnv = validateSlackEnvironment();
  if (!slackEnv.valid) {
    console.error(`[SLACK_VERIFY] Missing Slack environment variables: ${slackEnv.missing.join(', ')}`);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }
  
  try {
    // Get headers
    const timestamp = request.headers.get('x-slack-request-timestamp');
    const signature = request.headers.get('x-slack-signature');
    
    if (!timestamp || !signature) {
      console.error('[SLACK_VERIFY] Missing headers:', { timestamp: !!timestamp, signature: !!signature });
      return NextResponse.json({ error: 'Missing headers' }, { status: 400 });
    }
    
    // Check timestamp freshness (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
      console.error(`[SLACK_VERIFY] Timestamp too old: ${timestamp}, current: ${now}`);
      return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 });
    }
    
    // Get request body as text
    const body = await request.text();
    
    // Create signature base string
    const signatureBaseString = `v0:${timestamp}:${body}`;
    
    // Create expected signature
    const mySignature = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(signatureBaseString)
      .digest('hex')}`;
    
    // Compare signatures
    try {
      const isValid = timingSafeEqual(
        Buffer.from(mySignature),
        Buffer.from(signature)
      );
      
      if (isValid) {
        console.log('[SLACK_VERIFY] Request signature verified successfully');
        return NextResponse.json({ verified: true });
      } else {
        console.error('[SLACK_VERIFY] Invalid signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    } catch (e) {
      console.error('[SLACK_VERIFY] Error during signature verification:', e);
      return NextResponse.json({ error: 'Verification error' }, { status: 500 });
    }
  } catch (error) {
    console.error('[SLACK_VERIFY] Error:', error);
    return NextResponse.json({ error: 'Verification error' }, { status: 500 });
  }
} 