import { Pinecone } from '@pinecone-database/pinecone';

// Define the shared index name
const SHARED_INDEX_NAME = 'rag-shared-knowledge-base';

// Initialize Pinecone client
let pc: Pinecone;
try {
  pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
} catch (error) {
  console.error('Failed to initialize Pinecone client:', error);
  pc = new Proxy({} as Pinecone, {
    get: () => {
      return () => {
        throw new Error('Pinecone client failed to initialize. Check your API key and connection.');
      };
    }
  });
}

// Create or get the shared index
export async function getSharedIndex() {
  try {
    console.log(`[DEBUG] Checking if shared index exists: ${SHARED_INDEX_NAME}`);
    
    // Check if index exists
    const indexList = await pc.listIndexes();
    const indexExists = indexList.indexes?.some((index) => index.name === SHARED_INDEX_NAME) || false;
    
    if (!indexExists) {
      console.log(`[DEBUG] Creating new shared Pinecone index: ${SHARED_INDEX_NAME}`);
      await pc.createIndex({
        name: SHARED_INDEX_NAME,
        dimension: 1536, // dimension for text-embedding-3-small
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1',
          },
        },
      });
      console.log(`[DEBUG] Shared index created successfully`);
      
      // Wait for index to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    return pc.index(SHARED_INDEX_NAME);
  } catch (error) {
    console.error('Error accessing shared Pinecone index:', error);
    throw new Error(`Failed to access shared index: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Function to query across all user indices
export async function queryAllIndices(vector: number[], topK: number = 5) {
  try {
    // Get the shared index
    const sharedIndex = await getSharedIndex();
    
    // Query the shared index
    const queryResults = await sharedIndex.namespace('ns1').query({
      topK,
      vector,
      includeMetadata: true,
    });
    
    console.log(`[DEBUG] Retrieved ${queryResults.matches?.length || 0} matches from shared index`);
    
    return queryResults;
  } catch (error) {
    console.error('Error querying all indices:', error);
    throw new Error(`Failed to query all indices: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 