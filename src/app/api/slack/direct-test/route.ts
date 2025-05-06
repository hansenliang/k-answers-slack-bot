import { NextResponse } from 'next/server';
import { queryRag } from '@/lib/rag';

// Define the runtime as nodejs
export const runtime = 'nodejs';

/**
 * Simple endpoint to test RAG responses directly
 * Usage: /api/slack/direct-test?question=your+question+here
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const question = url.searchParams.get('question');
    
    if (!question) {
      return NextResponse.json({ 
        error: 'Missing question parameter', 
        usage: 'Add ?question=your+question+here to the URL' 
      }, { status: 400 });
    }
    
    console.log(`[DIRECT_TEST] Processing question: "${question.substring(0, 30)}..."`);
    
    // Process the query directly
    const startTime = Date.now();
    const answer = await queryRag(question);
    const processingTime = Date.now() - startTime;
    
    console.log(`[DIRECT_TEST] Generated answer in ${processingTime}ms`);
    
    // Return the response with timing information
    return NextResponse.json({
      question,
      answer,
      processingTime,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[DIRECT_TEST] Error processing question:', error);
    
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 