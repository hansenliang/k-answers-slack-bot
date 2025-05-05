/**
 * Simple script to manually trigger the RAG worker to process existing queue items
 * 
 * Usage:
 * npx ts-node src/scripts/trigger-worker.ts
 */

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

// Load environment variables from .env file if it exists
dotenv.config();

async function triggerWorker() {
  console.log('Attempting to trigger the RAG worker...');
  
  const baseUrl = process.env.VERCEL_ENV === 'production'
    ? 'https://k-answers-bot.vercel.app'
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
      
  const workerSecret = process.env.WORKER_SECRET_KEY || '';
  
  if (!workerSecret) {
    console.warn('⚠️ Warning: WORKER_SECRET_KEY environment variable is not set');
  }
  
  console.log(`Using base URL: ${baseUrl}`);

  try {
    const response = await fetch(`${baseUrl}/api/slack/rag-worker?key=${workerSecret}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trigger-Source': 'manual_trigger'
      }
    });
    
    const responseText = await response.text();
    
    if (response.ok) {
      console.log(`✅ Worker triggered successfully (${response.status})`);
      try {
        const json = JSON.parse(responseText);
        console.log('Response:', json);
      } catch (e) {
        console.log('Raw response:', responseText);
      }
    } else {
      console.error(`❌ Worker trigger failed with status ${response.status}`);
      console.error('Error response:', responseText);
    }
  } catch (error) {
    console.error('❌ Error triggering worker:', error);
  }
}

// Run the script
triggerWorker().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 