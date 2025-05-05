/**
 * Integration tests for Slack bot fixes
 */

// Import the actual functions to test
import { POST } from '../app/api/slack/events/route';
import { NextResponse } from 'next/server';

// Skip the signature verification
jest.mock('crypto', () => ({
  timingSafeEqual: jest.fn().mockReturnValue(true),
  createHmac: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('valid-signature')
  })
}));

// Mock Redis for event deduplication
const mockRedisInstance = {
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(true),
  setnx: jest.fn()
    .mockResolvedValueOnce(1) // First call returns 1 (key set)
    .mockResolvedValueOnce(0), // Second call returns 0 (key already exists)
  ping: jest.fn().mockResolvedValue('PONG'),
  llen: jest.fn().mockResolvedValue(1)
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => mockRedisInstance)
}));

// Mock job queue
const mockEnqueueSlackMessage = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/jobQueue', () => ({
  enqueueSlackMessage: jest.fn().mockImplementation((...args) => mockEnqueueSlackMessage(...args))
}));

// Mock NextResponse
jest.mock('next/server', () => {
  const originalModule = jest.requireActual('next/server');
  return {
    ...originalModule,
    NextResponse: {
      ...originalModule.NextResponse,
      json: jest.fn().mockImplementation((body, options) => ({ 
        body, 
        status: options?.status || 200
      }))
    }
  };
});

// Mock Slack WebClient
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    auth: {
      test: jest.fn().mockResolvedValue({ user_id: 'U123456' })
    },
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ts: '1234.5678' })
    }
  }))
}));

// Mock fetch
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve('OK')
  })
);

// Mock environment variables
jest.mock('@/lib/env', () => ({
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  validateSlackEnvironment: jest.fn().mockReturnValue({ valid: true, missing: [] }),
  logEnvironmentStatus: jest.fn()
}));

// Create a simple mock request
class MockRequest {
  private url: string;
  private requestBody: any;
  private headerMap = new Map<string, string>();

  constructor(url: string, body: any, headers: Record<string, string> = {}) {
    this.url = url;
    this.requestBody = body;
    
    // Add headers
    Object.entries(headers).forEach(([key, value]) => {
      this.headerMap.set(key.toLowerCase(), value);
    });
  }

  text() {
    return Promise.resolve(typeof this.requestBody === 'string' 
      ? this.requestBody 
      : JSON.stringify(this.requestBody));
  }

  json() {
    return Promise.resolve(typeof this.requestBody === 'string' 
      ? JSON.parse(this.requestBody) 
      : this.requestBody);
  }

  get method() {
    return 'POST';
  }

  get headers() {
    return {
      get: (key: string) => this.headerMap.get(key.toLowerCase())
    };
  }
}

describe('Slack Integration Tests - Focus on Fixed Issues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('Key Fix 1: Events route always returns a response', async () => {
    // Create a request for an app_mention event
    const mockRequest = new MockRequest(
      'https://example.com/api/slack/events',
      {
        type: 'event_callback',
        event: {
          type: 'app_mention',
          user: 'U123USER',
          channel: 'C123CHAN',
          text: '<@U123456> help me with this question',
          ts: '1234.5678'
        }
      },
      {
        'x-slack-signature': 'v0=valid',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
      }
    );

    // Execute the POST handler
    const response = await POST(mockRequest as any);
    
    // Verify we got a response back
    expect(response).toBeDefined();
    expect(response.body).toEqual({ ok: true });
    
    // Verify the response was created before async processing
    expect(mockEnqueueSlackMessage).not.toHaveBeenCalled();
  });
  
  test('Key Fix 2: Event deduplication prevents duplicate processing', async () => {
    // Create a request we'll send twice
    const mockEvent = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        user: 'U123USER',
        channel: 'C123CHAN',
        text: '<@U123456> help with duplicate event',
        ts: '1234.5678'
      }
    };

    const mockRequest = new MockRequest(
      'https://example.com/api/slack/events',
      mockEvent,
      {
        'x-slack-signature': 'v0=valid',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
      }
    );

    // Execute the POST handler twice with the same event
    await POST(mockRequest as any); 
    
    // Wait for async processing to complete
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Reset the original request to reuse it
    const secondRequest = new MockRequest(
      'https://example.com/api/slack/events',
      mockEvent,
      {
        'x-slack-signature': 'v0=valid',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
      }
    );
    
    await POST(secondRequest as any);
    
    // Wait for any async processing to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    // Check that Redis setnx was called twice with the same key
    expect(mockRedisInstance.setnx).toHaveBeenCalledTimes(2);
    expect(mockRedisInstance.setnx.mock.calls[0][0]).toBe('event:1234.5678');
    expect(mockRedisInstance.setnx.mock.calls[1][0]).toBe('event:1234.5678');
    
    // Check that the job was only enqueued once
    expect(mockEnqueueSlackMessage).toHaveBeenCalledTimes(1);
  });
}); 