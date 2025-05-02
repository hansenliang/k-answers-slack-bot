import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthServerSession } from '@/lib/auth';
import { getUserIndex } from '@/lib/pinecone';
import { queryAllIndices } from '@/lib/shared-pinecone';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      return NextResponse.json(
        { error: 'You must be logged in to ask questions' },
        { status: 401 }
      );
    }

    // Format username for Pinecone
    const formattedUsername = authSession.user.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Parse request body
    const body = await request.json();
    const question = body.question;

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    console.log(`[DEBUG] Processing question: "${question}"`);

    try {
      // Generate embedding for the question
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question,
      });

      const queryEmbedding = embeddingResponse.data[0].embedding;
      console.log(`[DEBUG] Generated embedding for question`);

      // Query across all indices using the shared index
      const queryResults = await queryAllIndices(queryEmbedding, 5);
      
      console.log(`[DEBUG] Retrieved ${queryResults.matches?.length || 0} matches from shared index`);
      
      // Log match scores to debug retrieval quality
      if (queryResults.matches && queryResults.matches.length > 0) {
        queryResults.matches.forEach((match, i) => {
          const userId = match.metadata?.userId || 'unknown';
          console.log(`[DEBUG] Match ${i+1} score: ${match.score}, has metadata: ${!!match.metadata}, from user: ${userId}`);
        });
      } else {
        console.log(`[DEBUG] No matches found in shared index`);
      }

      // Extract content from matches
      const contexts = queryResults.matches
        ?.filter(match => match.score && match.score > 0.5) // Lower threshold from 0.7 to 0.5
        .map(match => match.metadata?.text as string)
        .filter(Boolean) || [];

      if (contexts.length === 0) {
        console.log(`[DEBUG] No relevant contexts found`);
        return NextResponse.json({
          answer: "I couldn't find any relevant information about that in your documents. Please try rephrasing your question or sync more documents."
        });
      }

      // Combine the contexts 
      const combinedContext = contexts.join('\n\n');
      console.log(`[DEBUG] Using ${contexts.length} context chunks for answer generation`);

      // Generate an answer using OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant that answers questions based on the provided context.
            
            Your goal is to provide accurate, helpful responses using ONLY the information in the context below.
            
            If the answer is clearly contained in the context, provide it directly and confidently.
            If the answer is partially contained, provide what you can determine from the context.
            Remember that users can phrase things differently, and imply things. Be flexible in interpreting their question and finding the relevant answers. For exmaple, "How do I get access" often implies "How can I get beta access". Be flexible on wording and matching it to available information in your context. 
            If the question cannot be answered from the context, politely explain that you don't have enough information, tell them "Hansen didn't make me smart enough.", and refer them to use Slack or contact the Product Manager for the relevant team at Klaviyo.
            
            Never make up information that isn't supported by the context.
            Never mention the existence of the context in your response - just answer naturally.
            Try to be concise while being thorough and comprehensive.
            
            Context:
            ${combinedContext}`
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const answer = completion.choices[0].message.content || "I couldn't generate an answer. Please try again.";
      console.log(`[DEBUG] Generated answer successfully`);

      return NextResponse.json({ answer });
    } catch (error: any) {
      console.error('[ERROR] Failed to process question:', error);

      let errorMessage = 'Failed to process your question';
      
      if (error.message && error.message.includes('OpenAI')) {
        console.error('[ERROR] OpenAI API error:', error.message);
        errorMessage = 'There was an issue with the AI service. Please try again later.';
      } else if (error.message && error.message.includes('Pinecone')) {
        console.error('[ERROR] Pinecone API error:', error.message);
        errorMessage = 'There was an issue retrieving data. Please try again later.';
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ERROR] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
} 