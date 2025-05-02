import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthServerSession } from '@/lib/auth';
import { queryAllIndices } from '@/lib/shared-pinecone';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
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

  try {
    // Parse request body
    const body = await request.json();
    const question = body.question;

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    console.log(`[DEBUG] Processing question via streaming API: "${question}"`);

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
    
    // Extract content from matches
    const contexts = queryResults.matches
      ?.filter(match => match.score && match.score > 0.5)
      .map(match => match.metadata?.text as string)
      .filter(Boolean) || [];

    // Prepare system prompt based on whether we have relevant contexts
    let systemPrompt = '';
    
    if (contexts.length === 0) {
      console.log(`[DEBUG] No relevant contexts found, using general knowledge prompt`);
      systemPrompt = `You are a helpful assistant that answers questions about Klaviyo and its products.
      
      The user is asking about Klaviyo's products, features, or services. If you know the answer, provide it helpfully and concisely.
      
      If you're unsure or the question requires very specific or technical information about Klaviyo that you don't have, explain that you don't have enough information and suggest they:
      1. Try rephrasing their question
      2. Reach out to Klaviyo's support team for more specific information
      3. Check Klaviyo's documentation or knowledge base for detailed answers
      
      Be honest about your limitations while being as helpful as possible with general knowledge you do have about Klaviyo and email marketing.`;
    } else {
      // Combine the contexts 
      const combinedContext = contexts.join('\n\n');
      console.log(`[DEBUG] Using ${contexts.length} context chunks for answer generation`);
      
      systemPrompt = `You are a helpful assistant that answers questions based on the provided context.
      
      Your goal is to provide accurate, helpful responses using ONLY the information in the context below.
      
      If the answer is clearly contained in the context, provide it directly and confidently.
      If the answer is partially contained, provide what you can determine from the context.
      Remember that users can phrase things differently, and imply things. Be flexible in interpreting their question and finding the relevant answers. For example, "How do I get access" often implies "How can I get beta access". Be flexible on wording and matching it to available information in your context. 
      If the question cannot be answered from the context, politely explain that you don't have enough information, and refer them to use Slack or contact the Product Manager for the relevant team at Klaviyo.
      
      Never make up information that isn't supported by the context.
      Never mention the existence of the context in your response - just answer naturally.
      Try to be concise while being thorough and comprehensive.
      
      Context:
      ${combinedContext}`;
    }

    // Set up streaming with OpenAI
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: systemPrompt
              },
              {
                role: 'user',
                content: question
              }
            ],
            temperature: 0.3,
            max_tokens: 1000,
            stream: true // Enable streaming
          });

          // Process each chunk as it arrives
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              // Send the content chunk to the client
              controller.enqueue(encoder.encode(content));
            }
          }
          
          controller.close();
        } catch (error) {
          console.error('[ERROR] Streaming error:', error);
          controller.error(error);
        }
      }
    });

    // Return the stream response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error in streaming API:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
