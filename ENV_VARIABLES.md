# Environment Variables

To deploy this application, you need to set the following environment variables:

## Slack Configuration
- `SLACK_BOT_TOKEN` - Your Slack Bot User OAuth Token (starts with xoxb-)
- `SLACK_SIGNING_SECRET` - Your Slack Signing Secret (found in Basic Information)

## Upstash QStash
- `QSTASH_TOKEN` - Your Upstash QStash token (used for message queue)
- `RAG_WORKER_URL` - The URL of your worker endpoint (e.g., https://your-domain.vercel.app/api/slack/worker)

## Upstash Redis (if needed for other parts of the system)
- `UPSTASH_REDIS_URL` - Your Upstash Redis URL
- `UPSTASH_REDIS_TOKEN` - Your Upstash Redis token

## OpenAI (for RAG)
- `OPENAI_API_KEY` - Your OpenAI API key

## Pinecone (for RAG vector database)
- `PINECONE_API_KEY` - Your Pinecone API key

## Feature Flags
- `ENABLE_STREAMING` - Set to "true" to enable streaming updates for long answers (default is "false")

## Deployment Environment
- `VERCEL_URL` - Your Vercel URL (automatically set by Vercel)

## Setup Instructions

1. Create a `.env.local` file in the project root
2. Copy the variables above into the file
3. Fill in your actual values for each variable
4. For production deployment, add these variables to your Vercel project settings 