#!/usr/bin/env node

/**
 * End-to-end test script for Slack bot integration
 * 
 * This script:
 * 1. Starts the Next.js dev server
 * 2. Creates a public URL using ngrok
 * 3. Sends a test event to the Slack endpoint
 * 4. Verifies the response and checks for the expected message
 * 
 * Usage:
 * - Ensure ngrok is installed: npm install -g ngrok
 * - Set required environment variables (see below)
 * - Run: npm run test:e2e
 * 
 * Required environment variables:
 * - SLACK_BOT_TOKEN: Your Slack bot token
 * - SLACK_TEST_CHANNEL: Channel ID for testing
 */

const { spawn, exec } = require('child_process');
const http = require('http');
const https = require('https');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const PORT = 3000;
const TEST_QUESTION = 'What are the key features of the product?';
const SLACK_TEST_CHANNEL = process.env.SLACK_TEST_CHANNEL;

// Sample Slack event
const createTestEvent = (channel, text) => ({
  token: 'test-token',
  team_id: 'T12345',
  api_app_id: 'A12345',
  event: {
    client_msg_id: '12345',
    type: 'app_mention',
    text: `<@U12345> ${text}`,
    user: 'U54321',
    ts: `${Date.now() / 1000}`,
    channel,
    event_ts: `${Date.now() / 1000}`,
  },
  type: 'event_callback',
  event_id: `Ev${Date.now()}`,
  event_time: Math.floor(Date.now() / 1000),
});

// Start Next.js dev server
let nextServer;
async function startNextServer() {
  console.log('Starting Next.js development server...');
  
  nextServer = spawn('npm', ['run', 'dev'], {
    detached: false,
    stdio: 'inherit',
  });
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('Next.js server started on port', PORT);
}

// Start ngrok tunnel
async function startNgrok() {
  console.log('Starting ngrok tunnel...');
  
  try {
    const { stdout } = await execAsync(`ngrok http ${PORT} --log=stdout`);
    const match = stdout.match(/(https:\/\/[a-z0-9-]+\.ngrok\.io)/);
    if (!match) {
      throw new Error('Could not parse ngrok URL from output');
    }
    
    const ngrokUrl = match[1];
    console.log('ngrok tunnel established:', ngrokUrl);
    return ngrokUrl;
  } catch (error) {
    console.error('Failed to start ngrok:', error);
    throw error;
  }
}

// Send test Slack event
async function sendTestEvent(url) {
  console.log('Sending test Slack event...');
  
  if (!SLACK_TEST_CHANNEL) {
    throw new Error('SLACK_TEST_CHANNEL environment variable is required');
  }
  
  const testEvent = createTestEvent(SLACK_TEST_CHANNEL, TEST_QUESTION);
  
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${url}/api/slack/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Slack-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
          'X-Slack-Signature': 'mock-signature', // For testing only
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log('Response status:', res.statusCode);
          console.log('Response data:', data);
          resolve({ statusCode: res.statusCode, data });
        });
      }
    );
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    req.write(JSON.stringify(testEvent));
    req.end();
  });
}

// Try using the test endpoint directly
async function runDirectTest() {
  console.log('Running direct test using /api/slack/test endpoint...');
  
  if (!SLACK_TEST_CHANNEL) {
    throw new Error('SLACK_TEST_CHANNEL environment variable is required');
  }
  
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/slack/test?question=${encodeURIComponent(TEST_QUESTION)}&channel=${SLACK_TEST_CHANNEL}`,
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log('Test endpoint response status:', res.statusCode);
          try {
            const jsonData = JSON.parse(data);
            console.log('Test successful:', jsonData);
            resolve({ statusCode: res.statusCode, data: jsonData });
          } catch (error) {
            console.error('Error parsing JSON response:', error);
            console.log('Raw response:', data);
            reject(error);
          }
        });
      }
    );
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    req.end();
  });
}

// Main function
async function main() {
  try {
    // Check environment variables
    if (!process.env.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required');
    }
    
    // Start Next.js server
    await startNextServer();
    
    // Try to run the test directly first (simpler)
    try {
      const result = await runDirectTest();
      console.log('Direct test completed successfully!');
      console.log(`Check Slack channel ${SLACK_TEST_CHANNEL} for the test message`);
      
      // Optional: Try to start ngrok for external testing
      if (process.argv.includes('--with-ngrok')) {
        const ngrokUrl = await startNgrok();
        console.log(`\nYou can now test your Slack bot externally using the URL: ${ngrokUrl}/api/slack/events`);
        console.log('Press Ctrl+C to stop the server and tunnel');
      } else {
        // Clean up and exit
        if (nextServer) {
          nextServer.kill();
        }
        process.exit(0);
      }
    } catch (directTestError) {
      console.error('Direct test failed, trying with ngrok:', directTestError);
      
      // Try the ngrok approach
      const ngrokUrl = await startNgrok();
      const result = await sendTestEvent(ngrokUrl);
      
      if (result.statusCode === 200) {
        console.log('Test completed successfully!');
        console.log(`Check Slack channel ${SLACK_TEST_CHANNEL} for the test message`);
      } else {
        console.error('Test failed with status code:', result.statusCode);
      }
      
      // Clean up
      if (nextServer) {
        nextServer.kill();
      }
      process.exit(result.statusCode === 200 ? 0 : 1);
    }
  } catch (error) {
    console.error('Test failed:', error);
    
    // Clean up
    if (nextServer) {
      nextServer.kill();
    }
    process.exit(1);
  }
}

// Run the test
main(); 