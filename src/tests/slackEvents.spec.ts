import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { POST } from '../app/api/slack/events/route';

// Mock NextRequest and NextResponse
class MockNextRequest {
  constructor(url, options = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.body = options.body || '';
    this.headers = new Headers(options.headers || {});
  }

  text() {
    return Promise.resolve(this.body);
  }

  json() {
    return Promise.resolve(JSON.parse(this.body));
  }
}

const mockNextResponse = {
  json: jest.fn().mockImplementation((body, options = {}) => ({
    body,
    status: options.status || 200
  }))
};

// Mock dependencies
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((body, options = {}) => ({
      body,
      status: options.status || 200
    }))
  }
}));

jest.mock('@slack/web-api', () => ({
  WebClient: class MockWebClient {
    auth = {
      test: jest.fn().mockResolvedValue({ user_id: 'U123456' })
    };
    chat = {
      postMessage: jest.fn().mockResolvedValue({ ts: '1234.5678' })
    };
  }
}));

jest.mock('crypto', () => ({
  timingSafeEqual: jest.fn().mockReturnValue(true),
  createHmac: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('valid-signature')
  })
}));

jest.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    constructor() {
      this.data = new Map();
    }
    incr = jest.fn().mockResolvedValue(1);
    expire = jest.fn().mockResolvedValue(true);
    setnx = jest.fn().mockResolvedValue(1);
    ping = jest.fn().mockResolvedValue('PONG');
  }
}));

jest.mock('@/lib/jobQueue', () => ({
  enqueueSlackMessage: jest.fn().mockResolvedValue(true)
}));

jest.mock('@/lib/env', () => ({
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  validateSlackEnvironment: jest.fn().mockReturnValue({ valid: true, missing: [] }),
  logEnvironmentStatus: jest.fn()
}));

// Mock global fetch
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve('OK')
  })
);

describe('Slack Events API Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should return challenge for url_verification', async () => {
    // Setup
    const mockRequest = new MockNextRequest(
      'https://example.com/api/slack/events',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'url_verification',
          challenge: 'test-challenge-token'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Execute
    const response = await POST(mockRequest);
    
    // Verify
    expect(mockNextResponse.json).toHaveBeenCalledWith({ challenge: 'test-challenge-token' });
    expect(response).toBeDefined();
  });

  it('should acknowledge app_mention events within 3 seconds', async () => {
    // Setup
    const mockRequest = new MockNextRequest(
      'https://example.com/api/slack/events',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'event_callback',
          event: {
            type: 'app_mention',
            user: 'U123USER',
            channel: 'C123CHAN',
            text: '<@U123456> help me with this question',
            ts: '1234.5678'
          }
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
        }
      }
    );

    // Start timer
    const startTime = Date.now();
    
    // Execute
    const response = await POST(mockRequest);
    
    // End timer
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Verify
    expect(mockNextResponse.json).toHaveBeenCalledWith({ ok: true });
    expect(response).toBeDefined();
    
    // Verify it returns within 3 seconds (should be much faster in tests)
    expect(duration).toBeLessThan(3000);
  });

  it('should deduplicate events with the same timestamp', async () => {
    // Setup - Mock Redis setnx to return 1 for first call and 0 for second (already exists)
    const { enqueueSlackMessage } = require('@/lib/jobQueue');
    
    // First setup mock Redis
    const redisModule = require('@upstash/redis');
    const mockRedisInstance = {
      setnx: jest.fn()
        .mockResolvedValueOnce(1) // First call returns 1 (key set)
        .mockResolvedValueOnce(0), // Second call returns 0 (key already exists)
      expire: jest.fn().mockResolvedValue(true),
      ping: jest.fn().mockResolvedValue('PONG')
    };
    
    // Replace the Redis constructor with a function that returns our mock
    redisModule.Redis = jest.fn().mockImplementation(() => mockRedisInstance);
    
    const mockEvent = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        user: 'U123USER',
        channel: 'C123CHAN',
        text: '<@U123456> duplicate question',
        ts: '1234.5678'
      }
    };
    
    // Create first request
    const mockRequest1 = new MockNextRequest(
      'https://example.com/api/slack/events',
      {
        method: 'POST',
        body: JSON.stringify(mockEvent),
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
        }
      }
    );
    
    // Create second request (same event)
    const mockRequest2 = new MockNextRequest(
      'https://example.com/api/slack/events',
      {
        method: 'POST',
        body: JSON.stringify(mockEvent),
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
        }
      }
    );
    
    // Execute - Process both requests
    await POST(mockRequest1);
    await POST(mockRequest2);
    
    // Verify Redis setnx was called twice with same event key
    expect(mockRedisInstance.setnx).toHaveBeenCalledTimes(2);
    expect(mockRedisInstance.setnx.mock.calls[0][0]).toBe('event:1234.5678');
    expect(mockRedisInstance.setnx.mock.calls[1][0]).toBe('event:1234.5678');
    
    // Verify enqueueSlackMessage was called only once
    expect(enqueueSlackMessage).toHaveBeenCalledTimes(1);
  });
}); 