import OpenAI from "openai";
import { enhanceChunks } from "./chunk";
import { nanoid } from "nanoid"; 

/** Alias the SDK's item type */
type OpenAIEmbedding = OpenAI.Embeddings.Embedding;

export const maxDuration = 60;   
/**
 * Call OpenAI and return the array of embedding objects.
 */
export async function embedChunks(
  chunks: string[]
): Promise<OpenAIEmbedding[]> {
  // Validate that we have an API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not defined in environment variables');
    throw new Error('OpenAI API key is missing. Please check your environment variables.');
  }

  // Validate chunks
  if (!chunks || chunks.length === 0) {
    console.error('No chunks provided for embedding');
    throw new Error('No text chunks provided for embedding');
  }

  if (chunks.some(chunk => !chunk || chunk.trim() === '')) {
    console.warn('Some chunks are empty and will be filtered out');
    chunks = chunks.filter(chunk => chunk && chunk.trim() !== '');
  }

  // Create OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    organization: "org-4sVYvNZQTa4dYOT8bAgyz8gu",
  });

  try {
    console.log(`[DEBUG] Embedding ${chunks.length} chunks with OpenAI`);
    
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks,
    });
    
    console.log(`[DEBUG] Successfully generated ${res.data.length} embeddings`);
    
    // res.data is OpenAIEmbedding[]
    return res.data;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error("Error embedding text with OpenAI:", errorMessage);
    
    if (errorMessage.includes('API key')) {
      throw new Error('Invalid OpenAI API key. Please check your environment variables.');
    } else if (errorMessage.includes('rate limit')) {
      throw new Error('OpenAI rate limit exceeded. Please try again later.');
    } else if (errorMessage.includes('billing')) {
      throw new Error('OpenAI billing issue. Please check your OpenAI account.');
    }
    
    throw new Error(`OpenAI embedding failed: ${errorMessage}`);
  }
}

/** Helper for Pinecone's expected shape */
export interface PineconeVector {
  id: string;
  values: number[];
  metadata: { text: string };
}

export async function formatEmbeddings(
  embeddings: OpenAIEmbedding[]
): Promise<PineconeVector[]> {
  return embeddings.map((e) => ({
    id: nanoid(),
    values: e.embedding, // float32[]
    metadata: { text: "" }, // fill later if needed
  }));
}

/**
 * Enhance → embed → package for Pinecone (id, values, metadata).
 */
export async function buildPineconeRecords(
  rawChunks: string[]
): Promise<PineconeVector[]> {
  try {
    console.log(`[DEBUG] Processing ${rawChunks.length} raw chunks for Pinecone`);
    
    const enhanced = await enhanceChunks(rawChunks);     // string[]
    console.log(`[DEBUG] Enhanced chunks (count: ${enhanced.length})`);
    
    const vectors = await embedChunks(enhanced);        // OpenAIEmbedding[]
    console.log(`[DEBUG] Generated embeddings (count: ${vectors.length})`);

    // Verify we have equal numbers of chunks and vectors
    if (enhanced.length !== vectors.length) {
      console.error(`Mismatch between chunks (${enhanced.length}) and vectors (${vectors.length})`);
      throw new Error('Embedding process resulted in mismatched data. Please try again.');
    }

    return enhanced.map((chunk, i) => ({
      id: nanoid(),
      values: vectors[i].embedding,
      metadata: { text: chunk },
    }));
  } catch (error) {
    console.error('Error building Pinecone records:', error);
    throw new Error(`Failed to prepare data for Pinecone: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}