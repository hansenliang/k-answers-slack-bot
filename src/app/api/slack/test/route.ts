import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";

// Set runtime to nodejs for this testing endpoint
export const runtime = "nodejs";

// Initialize Slack client
const token = process.env.SLACK_BOT_TOKEN;
const webClient = token ? new WebClient(token) : null;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const question = url.searchParams.get('question');
    const channel = url.searchParams.get('channel');
    
    if (!question || !channel) {
      return NextResponse.json({
        error: 'Missing parameters',
        usage: 'GET /api/slack/test?question=YOUR_QUESTION&channel=CHANNEL_ID'
      }, { status: 400 });
    }
    
    if (!webClient) {
      return NextResponse.json({
        error: 'Slack client not initialized',
        message: 'Check SLACK_BOT_TOKEN environment variable'
      }, { status: 500 });
    }
    
    // Test direct message to Slack
    const thinkingMessage = await webClient.chat.postMessage({
      channel,
      text: "I'm searching the docs...",
    });
    
    // Test QStash connection
    let qstashStatus = "unknown";
    try {
      const res = await fetch("https://qstash.upstash.io/v1/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
          "Content-Type": "application/json",
          "Upstash-Forward-Url": process.env.RAG_WORKER_URL!,
        },
        body: JSON.stringify({
          questionText: question,
          channelId: channel,
          stub_ts: thinkingMessage.ts,
        }),
      });
      
      qstashStatus = res.ok ? "connected" : `error: ${await res.text()}`;
    } catch (qstashError) {
      qstashStatus = `error: ${qstashError instanceof Error ? qstashError.message : String(qstashError)}`;
    }
    
    return NextResponse.json({
      status: 'success',
      slackStatus: 'connected',
      qstashStatus,
      message: 'Test message sent to Slack',
      timestamp: thinkingMessage.ts,
      channel,
      question
    });
  } catch (error) {
    console.error('[TEST] Error testing Slack integration:', error);
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Process a test event directly without going through Slack
    const body = await request.json();
    const { question, channel } = body;
    
    if (!question || !channel) {
      return NextResponse.json({
        error: 'Missing parameters',
        usage: 'POST /api/slack/test with JSON: { "question": "YOUR_QUESTION", "channel": "CHANNEL_ID" }'
      }, { status: 400 });
    }
    
    if (!webClient) {
      return NextResponse.json({
        error: 'Slack client not initialized',
        message: 'Check SLACK_BOT_TOKEN environment variable'
      }, { status: 500 });
    }
    
    // Send thinking message
    const thinkingMessage = await webClient.chat.postMessage({
      channel,
      text: "I'm searching the docs...",
    });
    
    // Simulate the full pipeline by hitting the worker endpoint directly
    const workerResponse = await fetch(process.env.RAG_WORKER_URL || 'https://your-domain.vercel.app/api/slack/worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        questionText: question,
        channelId: channel,
        stub_ts: thinkingMessage.ts,
        useStreaming: process.env.ENABLE_STREAMING === "true"
      })
    });
    
    const workerData = await workerResponse.json();
    
    return NextResponse.json({
      status: 'success',
      message: 'Test pipeline executed',
      workerResponse: workerData
    });
  } catch (error) {
    console.error('[TEST] Error testing full pipeline:', error);
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 