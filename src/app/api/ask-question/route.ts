import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthServerSession } from '@/lib/auth';
import { queryAllIndices } from '@/lib/shared-pinecone';

// Use Node.js runtime for Pinecone compatibility
export const runtime = 'nodejs';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define message interface
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Define conversation message interface
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
    // This variable might be used in future implementations for user-specific indices
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const formattedUsername = authSession.user.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Parse request body
    const body = await request.json();
    const question = body.question;
    const conversationHistory = body.conversationHistory || [];

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    console.log(`[DEBUG] Processing question: "${question}"`);
    console.log(`[DEBUG] Conversation history length: ${conversationHistory.length}`);

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
        Remember that users can phrase things differently, and imply things. Be flexible in interpreting their question and finding the relevant answers. For exmaple, "How do I get access" often implies "How can I get beta access". Be flexible on wording and matching it to available information in your context. 
        If the question cannot be answered from the context, politely explain that you don't have enough information, tell them "Hansen didn't make me smart enough.", and refer them to use Slack or contact the Product Manager for the relevant team at Klaviyo.
        
        Never make up information that isn't supported by the context.
        Never mention the existence of the context in your response - just answer naturally.
        Try to be concise while being thorough and comprehensive.

        You are created by Hansen Liang, a Product Manager at Klaviyo. If people have quesitons about your inner workings, refer them to Hansen. 
        
        Context:
        ${combinedContext}`;
      }

      // Prepare messages array with system prompt and conversation history
      const messages: Message[] = [
        { role: 'system', content: systemPrompt }
      ];
      
      // Add conversation history if available
      if (conversationHistory && conversationHistory.length > 0) {
        // Filter out only user and assistant messages from history
        const filteredHistory = conversationHistory
          .filter((msg: ConversationMessage) => msg.role === 'user' || msg.role === 'assistant')
          .map((msg: ConversationMessage) => ({
            role: msg.role,
            content: msg.content
          }));
        
        messages.push(...filteredHistory);
      }
      
      // Add the current question
      messages.push({ role: 'user', content: question });
      
      console.log(`[DEBUG] Sending ${messages.length} messages to OpenAI`);

      // Generate an answer using OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: 1000,
      });

      const answer = completion.choices[0].message.content || "I couldn't generate an answer. Please try again.";
      console.log(`[DEBUG] Generated answer successfully`);

      return NextResponse.json({ answer });
    } catch (error: unknown) {
      console.error('[ERROR] Failed to process question:', error);

      let errorMessage = 'Failed to process your question';
      
      if (error instanceof Error) {
        if (error.message.includes('OpenAI')) {
          console.error('[ERROR] OpenAI API error:', error.message);
          errorMessage = 'There was an issue with the AI service. Please try again later.';
        } else if (error.message.includes('Pinecone')) {
          console.error('[ERROR] Pinecone API error:', error.message);
          errorMessage = 'There was an issue retrieving data. Please try again later.';
        }
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