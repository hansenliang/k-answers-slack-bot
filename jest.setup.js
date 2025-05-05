// Mock global fetch
global.fetch = jest.fn();

// Mock environment variables
process.env.UPSTASH_REDIS_URL = 'https://example.upstash.io';
process.env.UPSTASH_REDIS_TOKEN = 'test-token';
process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.WORKER_SECRET_KEY = 'test-worker-secret';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'; 