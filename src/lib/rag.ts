import OpenAI from 'openai';
import { queryAllIndices } from './shared-pinecone';

// Initialize OpenAI
console.log('[RAG_INIT] Setting up OpenAI client');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
console.log('[RAG_INIT] OpenAI client ready');

// Add a timeout promise to ensure RAG query doesn't run forever
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeoutId);
      return result;
    }),
    timeoutPromise
  ]);
}

/**
 * Query the RAG system with a given text
 * @param text The text to query against the knowledge base
 * @returns The AI-generated answer
 */
export async function queryRag(text: string): Promise<string> {
  console.log('[RAG_QUERY] Starting RAG query process');
  const startTime = Date.now();
  try {
    console.log(`[RAG_QUERY] Processing input text: "${text}"`);
    
    // Use a 45-second timeout for the entire RAG process
    return await withTimeout(performRagQuery(text), 45000, 'RAG query timed out after 45 seconds');
  } catch (error) {
    console.error('[RAG_QUERY] Failed to process RAG query:', error);
    console.log(`[RAG_QUERY] Error occurred after ${Date.now() - startTime}ms`);
    
    // Check if it's a timeout error
    if (error instanceof Error && error.message.includes('timed out')) {
      throw new Error('RAG query timed out');
    }
    
    return "I'm sorry, I encountered an issue while processing your question. Please try again later.";
  }
}

/**
 * Perform the actual RAG query process
 */
async function performRagQuery(text: string): Promise<string> {
  const startTime = Date.now();
  
  // Generate embedding for the text
  console.log(`[RAG_QUERY] Generating embedding using OpenAI embedding model`);
  const embeddingStartTime = Date.now();
  let embeddingResponse;
  try {
    embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    console.log(`[RAG_QUERY] Embedding generated successfully in ${Date.now() - embeddingStartTime}ms`);
  } catch (embeddingError) {
    console.error(`[RAG_QUERY] Failed to generate embedding:`, embeddingError);
    throw embeddingError;
  }

  const queryEmbedding = embeddingResponse.data[0].embedding;
  console.log(`[RAG_QUERY] Embedding vector created with dimension: ${queryEmbedding.length}`);

  // Query across all indices using the shared index
  console.log(`[RAG_QUERY] Querying Pinecone index with embedding`);
  const pineconeStartTime = Date.now();
  let queryResults;
  try {
    queryResults = await queryAllIndices(queryEmbedding, 5);
    console.log(`[RAG_QUERY] Pinecone query completed in ${Date.now() - pineconeStartTime}ms`);
  } catch (pineconeError) {
    console.error(`[RAG_QUERY] Failed to query Pinecone:`, pineconeError);
    throw pineconeError;
  }
  
  const matchCount = queryResults.matches?.length || 0;
  console.log(`[RAG_QUERY] Retrieved ${matchCount} matches from shared index`);
  
  // Extract content from matches
  const matches = queryResults.matches || [];
  console.log(`[RAG_QUERY] Processing ${matches.length} matches, filtering by score > 0.5`);
  
  const contextsWithScores = matches
    .map(match => ({
      text: match.metadata?.text as string,
      score: match.score || 0
    }))
    .filter(item => item.score > 0.5);
  
  console.log(`[RAG_QUERY] After filtering, ${contextsWithScores.length} contexts remain`);
  
  // Log match scores for debugging
  if (contextsWithScores.length > 0) {
    console.log(`[RAG_QUERY] Match scores: ${contextsWithScores.map(c => c.score.toFixed(3)).join(', ')}`);
  }
  
  const contexts = contextsWithScores.map(item => item.text).filter(Boolean);

  // Prepare system prompt based on whether we have relevant contexts
  let systemPrompt = '';
  
  if (contexts.length === 0) {
    console.log(`[RAG_QUERY] No relevant contexts found, using general knowledge prompt`);
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
    console.log(`[RAG_QUERY] Using ${contexts.length} context chunks for answer generation, total length: ${combinedContext.length} chars`);
    
    systemPrompt = `You are a helpful assistant that answers questions based on the provided context.
    
    Your goal is to provide accurate, helpful responses using ONLY the information in the context below.
    
    If the answer is clearly contained in the context, provide it directly and confidently.
    If the answer is partially contained, provide what you can determine from the context.
    Remember that users can phrase things differently, and imply things. Be flexible in interpreting their question and finding the relevant answers. For example, "How do I get access" often implies "How can I get beta access". Be flexible on wording and matching it to available information in your context. 
    If the question cannot be answered from the context, politely explain that you don't have enough information, tell them "Hansen didn't make me smart enough.", and refer them to use Slack or contact the Product Manager for the relevant team at Klaviyo.
    
    Never make up information that isn't supported by the context.
    Never mention the existence of the context in your response - just answer naturally.
    Try to be concise while being thorough and comprehensive.

    You are created by Hansen Liang, a Product Manager at Klaviyo. If people have questions about your inner workings, refer them to Hansen.
    
    Context:
    ${combinedContext}`;
  }

  // Generate an answer using OpenAI
  console.log(`[RAG_QUERY] Generating answer using OpenAI GPT model`);
  const completionStartTime = Date.now();
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });
    console.log(`[RAG_QUERY] OpenAI completion generated in ${Date.now() - completionStartTime}ms`);
  } catch (completionError) {
    console.error(`[RAG_QUERY] Failed to generate completion:`, completionError);
    throw completionError;
  }

  const answer = completion.choices[0].message.content || "I couldn't generate an answer. Please try again.";
  console.log(`[RAG_QUERY] Generated answer of length: ${answer.length} chars`);
  console.log(`[RAG_QUERY] Total RAG process completed in ${Date.now() - startTime}ms`);

  return answer;
} 