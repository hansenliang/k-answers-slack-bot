/**
 * Manual integration test script for the Slack message queue
 * 
 * This script simulates multiple rapid-fire Slack messages to test
 * the queue's ability to handle them reliably.
 * 
 * Usage:
 * 1. Start the local Next.js server with `npm run dev`
 * 2. Run this script with `npx ts-node src/scripts/test-slack-integration.ts`
 */

import { SlackMessageJob, enqueueSlackMessage } from '../lib/jobQueue';
import fetch from 'node-fetch';

// Configuration
const NUM_MESSAGES = 10;
const DELAY_BETWEEN_MS = 200; // 200ms between messages (very rapid)
const BASE_URL = 'http://localhost:3000';

// Helper to wait
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Simulate a Slack event
async function simulateSlackMessage(index: number) {
  const timestamp = (Date.now() / 1000).toString();
  const job: SlackMessageJob = {
    channelId: 'C123TEST',
    userId: 'U123TEST',
    questionText: `Test question ${index}: What is the capital of France?`,
    threadTs: timestamp,
    eventTs: timestamp,
    useStreaming: false
  };

  console.log(`[TEST] Enqueueing message ${index}: "${job.questionText}"`);
  
  try {
    // Enqueue directly using the library
    const enqueueResult = await enqueueSlackMessage(job);
    console.log(`[TEST] Message ${index} enqueued: ${enqueueResult}`);
    
    // Trigger the worker
    const workerUrl = `${BASE_URL}/api/slack/rag-worker?key=${process.env.WORKER_SECRET || 'test-worker-secret'}`;
    console.log(`[TEST] Triggering worker for message ${index}`);
    
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    console.log(`[TEST] Worker response for message ${index}:`, result);
    
    return true;
  } catch (error) {
    console.error(`[TEST] Error simulating message ${index}:`, error);
    return false;
  }
}

// Run the integration test
async function runTest() {
  console.log(`[TEST] Starting integration test with ${NUM_MESSAGES} rapid-fire messages`);
  
  const startTime = Date.now();
  const results = [];
  
  // Send messages with slight delay between them
  for (let i = 1; i <= NUM_MESSAGES; i++) {
    results.push(simulateSlackMessage(i));
    await sleep(DELAY_BETWEEN_MS);
  }
  
  // Wait for all messages to be processed
  await Promise.all(results);
  
  const duration = Date.now() - startTime;
  console.log(`[TEST] Test completed in ${duration}ms`);
  console.log('[TEST] Check server logs to verify all messages were processed correctly');
}

// Run the test
runTest().catch(error => {
  console.error('[TEST] Unhandled error:', error);
  process.exit(1);
}); 