import { Pinecone } from '@pinecone-database/pinecone';

// Define the shared index name
const SHARED_INDEX_NAME = 'rag-shared-knowledge-base';
console.log(`[PINECONE_INIT] Using shared index name: ${SHARED_INDEX_NAME}`);

// Initialize Pinecone client
console.log('[PINECONE_INIT] Initializing Pinecone client');
let pc: Pinecone;
try {
  pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
  console.log('[PINECONE_INIT] Pinecone client initialized successfully');
} catch (error) {
  console.error('[PINECONE_INIT] Failed to initialize Pinecone client:', error);
  pc = new Proxy({} as Pinecone, {
    get: () => {
      return () => {
        throw new Error('Pinecone client failed to initialize. Check your API key and connection.');
      };
    }
  });
  console.error('[PINECONE_INIT] Created proxy client due to initialization failure');
}

// Create or get the shared index
export async function getSharedIndex() {
  const startTime = Date.now();
  console.log(`[PINECONE_INDEX] Getting shared index: ${SHARED_INDEX_NAME}`);
  try {
    console.log(`[PINECONE_INDEX] Checking if shared index exists`);
    
    // Check if index exists
    const indexList = await pc.listIndexes();
    console.log(`[PINECONE_INDEX] Retrieved list of indices: ${indexList.indexes?.length || 0} total indices`);
    
    const indexExists = indexList.indexes?.some((index) => index.name === SHARED_INDEX_NAME) || false;
    console.log(`[PINECONE_INDEX] Index existence check: ${indexExists ? 'exists' : 'does not exist'}`);
    
    if (!indexExists) {
      console.log(`[PINECONE_INDEX] Creating new shared Pinecone index: ${SHARED_INDEX_NAME}`);
      try {
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
        console.log(`[PINECONE_INDEX] Shared index created successfully`);
      } catch (createError) {
        console.error(`[PINECONE_INDEX] Error creating index:`, createError);
        throw createError;
      }
      
      // Wait for index to be ready
      console.log(`[PINECONE_INDEX] Waiting for index to be ready (5s delay)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log(`[PINECONE_INDEX] Delay completed, proceeding to use index`);
    }
    
    console.log(`[PINECONE_INDEX] Returning index reference for: ${SHARED_INDEX_NAME}`);
    const index = pc.index(SHARED_INDEX_NAME);
    console.log(`[PINECONE_INDEX] Index reference obtained in ${Date.now() - startTime}ms`);
    return index;
  } catch (error) {
    console.error('[PINECONE_INDEX] Error accessing shared Pinecone index:', error);
    console.log(`[PINECONE_INDEX] Error occurred after ${Date.now() - startTime}ms`);
    throw new Error(`Failed to access shared index: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Function to query across all user indices
export async function queryAllIndices(vector: number[], topK: number = 5) {
  const startTime = Date.now();
  console.log(`[PINECONE_QUERY] Starting vector query with topK=${topK}`);
  try {
    // Get the shared index
    console.log(`[PINECONE_QUERY] Getting shared index reference`);
    const sharedIndexStart = Date.now();
    let sharedIndex;
    try {
      sharedIndex = await getSharedIndex();
      console.log(`[PINECONE_QUERY] Obtained shared index reference in ${Date.now() - sharedIndexStart}ms`);
    } catch (indexError) {
      console.error(`[PINECONE_QUERY] Failed to get shared index:`, indexError);
      throw indexError;
    }
    
    // Query the shared index
    console.log(`[PINECONE_QUERY] Querying shared index namespace 'ns1'`);
    const queryStart = Date.now();
    let queryResults;
    try {
      queryResults = await sharedIndex.namespace('ns1').query({
        topK,
        vector,
        includeMetadata: true,
      });
      console.log(`[PINECONE_QUERY] Query completed in ${Date.now() - queryStart}ms`);
    } catch (queryError) {
      console.error(`[PINECONE_QUERY] Error during query:`, queryError);
      throw queryError;
    }
    
    console.log(`[PINECONE_QUERY] Retrieved ${queryResults.matches?.length || 0} matches from shared index`);
    console.log(`[PINECONE_QUERY] Total query process took ${Date.now() - startTime}ms`);
    
    return queryResults;
  } catch (error) {
    console.error('[PINECONE_QUERY] Error querying all indices:', error);
    console.log(`[PINECONE_QUERY] Error occurred after ${Date.now() - startTime}ms`);
    throw new Error(`Failed to query all indices: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 