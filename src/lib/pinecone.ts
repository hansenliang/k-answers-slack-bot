import { Pinecone } from '@pinecone-database/pinecone';

// We need to ensure we have the API key
if (!process.env.PINECONE_API_KEY) {
  console.error('PINECONE_API_KEY is not defined in environment variables');
}

// Create the Pinecone client with error handling
let pc: Pinecone;
try {
  pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
} catch (error) {
  console.error('Failed to initialize Pinecone client:', error);
  // Create a dummy client that will throw clear errors when used
  pc = new Proxy({} as Pinecone, {
    get: (_target, prop) => {
      if (prop === 'index') {
        return () => {
          throw new Error('Pinecone client failed to initialize. Check your API key and connection.');
        };
      }
      return () => {
        throw new Error('Pinecone client failed to initialize. Check your API key and connection.');
      };
    }
  });
}

// Normalize the index name pattern to ensure consistency
function normalizeIndexName(username: string): string {
  // Format username to comply with Pinecone naming requirements
  return username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-') // Replace multiple consecutive hyphens with a single one
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

export async function createUserIndex(username: string) {
  try {
    const indexName = normalizeIndexName(username);
    console.log(`[DEBUG] Checking if index exists: ${indexName}`);
    
    // Check if index exists
    const indexList = await pc.listIndexes();
    const indexExists = indexList.indexes?.some((index) => index.name === indexName) || false;
    
    if (!indexExists) {
      console.log(`[DEBUG] Creating new Pinecone index: ${indexName}`);
      await pc.createIndex({
        name: indexName,
        dimension: 1536, // dimension for text-embedding-3-small
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1',
          },
        },
      });
      console.log(`[DEBUG] Index created successfully: ${indexName}`);
      
      // Wait a moment for the index to be fully created and available
      console.log(`[DEBUG] Waiting for index to be ready...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log(`[DEBUG] Index already exists: ${indexName}`);
    }
    
    return indexName;
  } catch (error) {
    console.error('Error creating Pinecone index:', error);
    throw error;
  }
}

export async function getUserIndex(username: string) {
  if (!username) {
    throw new Error('Username is required to access Pinecone index');
  }
  
  try {
    const indexName = normalizeIndexName(username);
    console.log(`[DEBUG] Accessing Pinecone index: ${indexName}`);
    
    // First, ensure the index exists
    try {
      // Check if index exists
      const indexList = await pc.listIndexes();
      console.log(`[DEBUG] Available indexes:`, indexList.indexes?.map(i => i.name) || []);
      
      const indexExists = indexList.indexes?.some((index) => index.name === indexName) || false;
      
      if (!indexExists) {
        console.log(`[DEBUG] Index ${indexName} doesn't exist, creating it now...`);
        await createUserIndex(username);
      }
    } catch (listError) {
      console.error(`[ERROR] Failed to list or create Pinecone indexes:`, listError);
      throw new Error(`Cannot access Pinecone indexes: ${listError instanceof Error ? listError.message : 'Unknown error'}`);
    }
    
    // Get the index - now it should exist
    const index = pc.index(indexName);
    
    return index;
  } catch (error) {
    console.error(`Error accessing Pinecone index for user ${username}:`, error);
    throw new Error(`Failed to access Pinecone index: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 