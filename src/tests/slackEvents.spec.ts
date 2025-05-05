import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../app/api/slack/events/route';

// Mock dependencies
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
    NextResponse: {
      json: vi.fn().mockImplementation((body, options) => ({ body, options }))
    }
  };
});

vi.mock('@slack/web-api', () => ({
  WebClient: class MockWebClient {
    auth = {
      test: vi.fn().mockResolvedValue({ user_id: 'U123456' })
    };
    chat = {
      postMessage: vi.fn().mockResolvedValue({ ts: '1234.5678' })
    };
  }
}));

vi.mock('crypto', () => ({
  timingSafeEqual: vi.fn().mockReturnValue(true),
  createHmac: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('valid-signature')
  })
}));

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    incr = vi.fn().mockResolvedValue(1);
    expire = vi.fn().mockResolvedValue(true);
    setnx = vi.fn().mockResolvedValue(1);
    ping = vi.fn().mockResolvedValue('PONG');
  }
}));

vi.mock('@/lib/jobQueue', () => ({
  enqueueSlackMessage: vi.fn().mockResolvedValue(true)
}));

vi.mock('@/lib/env', () => ({
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  validateSlackEnvironment: vi.fn().mockReturnValue({ valid: true, missing: [] }),
  logEnvironmentStatus: vi.fn()
}));

// Mock global fetch
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: vi.fn().mockResolvedValue('OK')
});

describe('Slack Events API Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return challenge for url_verification', async () => {
    const mockRequest = new NextRequest(
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

    const response = await POST(mockRequest);
    
    expect(NextResponse.json).toHaveBeenCalledWith({ challenge: 'test-challenge-token' });
    expect(response).toBeDefined();
  });

  it('should acknowledge app_mention events within 3 seconds', async () => {
    const mockRequest = new NextRequest(
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
    
    const response = await POST(mockRequest);
    
    // End timer
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Check that response is sent
    expect(NextResponse.json).toHaveBeenCalledWith({ ok: true });
    expect(response).toBeDefined();
    
    // Verify it returns within 3 seconds (should be much faster in tests)
    expect(duration).toBeLessThan(3000);
  });

  it('should deduplicate events with the same timestamp', async () => {
    // Mock Redis setnx to return 1 for first call and 0 for second (already exists)
    const mockRedis = vi.mocked(require('@upstash/redis').Redis);
    const mockSetnx = vi.fn()
      .mockResolvedValueOnce(1) // First call returns 1 (key set)
      .mockResolvedValueOnce(0); // Second call returns 0 (key already exists)
    
    mockRedis.prototype.setnx = mockSetnx;
    
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
    const mockRequest1 = new NextRequest(
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
    const mockRequest2 = new NextRequest(
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
    
    // Process both requests
    await POST(mockRequest1);
    await POST(mockRequest2);
    
    // Verify Redis setnx was called twice with same event key
    expect(mockSetnx).toHaveBeenCalledTimes(2);
    expect(mockSetnx.mock.calls[0][0]).toBe('event:1234.5678');
    expect(mockSetnx.mock.calls[1][0]).toBe('event:1234.5678');
    
    // Verify enqueueSlackMessage was called only once
    const { enqueueSlackMessage } = require('@/lib/jobQueue');
    expect(enqueueSlackMessage).toHaveBeenCalledTimes(1);
  });
}); 