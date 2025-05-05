# Deployment Checklist

## Pre-deployment Steps

1. **Verify Environment Variables in Vercel**
   - [ ] `SLACK_BOT_TOKEN`
   - [ ] `SLACK_SIGNING_SECRET`
   - [ ] `UPSTASH_REDIS_URL`
   - [ ] `UPSTASH_REDIS_TOKEN`
   - [ ] `WORKER_SECRET_KEY` (critical - this must match in all environments)
   - [ ] `OPENAI_API_KEY`

2. **Run Tests**
   - [ ] `npm test`
   - [ ] Fix any failing tests before deployment

3. **Local Test**
   - [ ] Test the bot with a local development server: `npm run dev`
   - [ ] Ensure Redis connection is working
   - [ ] Verify queue functionality
   - [ ] Test with ngrok if needed for local Slack testing

## Deployment Steps

1. **Deploy to Vercel**
   - [ ] `git add .`
   - [ ] `git commit -m "Your commit message"`
   - [ ] `git push`
   - [ ] Wait for Vercel to complete the deployment

2. **Verify Deployment**
   - [ ] Check Vercel logs after deployment
   - [ ] Ensure there are no environment-related errors
   - [ ] Confirm Redis connection is successful in logs

## Post-deployment Verification

1. **Test Bot Functionality**
   - [ ] Send a direct message to the bot
   - [ ] Send a mention to the bot in a channel
   - [ ] Verify messages are being enqueued (check Upstash logs)
   - [ ] Verify worker is processing messages
   - [ ] Confirm responses are being sent back to Slack

2. **Troubleshooting (if needed)**
   - [ ] Check Vercel logs for errors
   - [ ] Verify environment variables are correctly set
   - [ ] Try manual worker trigger if messages are stuck in queue:
     ```
     curl -X POST "https://your-app.vercel.app/api/slack/rag-worker?key=your-worker-secret-key"
     ```
   - [ ] Refer to `docs/troubleshooting.md` for more detailed steps

## Rollback Plan (if necessary)

1. **Revert to Previous Version**
   - [ ] `git revert HEAD`
   - [ ] `git push`
   - [ ] Wait for Vercel to deploy the reverted code

2. **Monitor After Rollback**
   - [ ] Verify the previous version is functioning correctly
   - [ ] Document issues found for future fixes 