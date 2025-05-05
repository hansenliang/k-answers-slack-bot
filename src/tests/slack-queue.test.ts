import { enqueueSlackMessage, SlackMessageJob } from '@/lib/jobQueue';

// Mock the dependencies
jest.mock('@upstash/redis', () => {
  const redisMock = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue('OK'),
    llen: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue(['{"channelId":"C123","userId":"U123","questionText":"test?","eventTs":"1234.5678","threadTs":"1234.5678"}']),
    lrem: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
  };
  return {
    Redis: jest.fn(() => redisMock)
  };
});

jest.mock('@upstash/queue', () => {
  return {
    Queue: jest.fn(() => ({
      sendMessage: jest.fn().mockResolvedValue(true),
      receiveMessage: jest.fn().mockResolvedValue({
        streamId: 'test-stream-id',
        body: {
          channelId: 'C123',
          userId: 'U123',
          questionText: 'test?',
          eventTs: '1234.5678',
          threadTs: '1234.5678',
          useStreaming: false
        }
      }),
      verifyMessage: jest.fn().mockResolvedValue(true)
    }))
  };
});

jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn(() => ({
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ts: '1234.5678' }),
        update: jest.fn().mockResolvedValue({ ok: true })
      },
      auth: {
        test: jest.fn().mockResolvedValue({ user_id: 'B123' })
      }
    }))
  };
});

// Mock fetch for worker trigger
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ status: 'success' })
});

describe('Slack Message Queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should successfully enqueue a Slack message job', async () => {
    const job: SlackMessageJob = {
      channelId: 'C123',
      userId: 'U123',
      questionText: 'test question',
      threadTs: '1234.5678',
      eventTs: '1234.5678',
      useStreaming: false
    };

    const result = await enqueueSlackMessage(job);
    expect(result).toBe(true);
    
    // Import dynamically to avoid hoisting issues with mocks
    const { slackMessageQueue } = require('@/lib/jobQueue');
    
    // Verify the job was sent to the queue
    expect(slackMessageQueue.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'C123',
      userId: 'U123',
      questionText: 'test question'
    }));
  });
}); 