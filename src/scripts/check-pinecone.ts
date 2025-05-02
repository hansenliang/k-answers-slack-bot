import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`Loaded environment from: ${envPath}`);
} else {
  console.warn(`Environment file not found: ${envPath}`);
  dotenv.config(); // Try default .env
}

async function checkPinecone() {
  if (!process.env.PINECONE_API_KEY) {
    console.error('PINECONE_API_KEY not found in environment variables');
    return;
  }

  try {
    console.log('Initializing Pinecone client...');
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    console.log('Listing available indices...');
    const indices = await pc.listIndexes();
    
    if (!indices.indexes || indices.indexes.length === 0) {
      console.log('No indices found in your Pinecone account');
      return;
    }
    
    console.log(`Found ${indices.indexes.length} indices:`);
    indices.indexes.forEach(index => {
      console.log(`- ${index.name} (Status: ${index.status})`);
    });
    
    // Ask the user which index to check
    const indexName = process.argv[2] || indices.indexes[0].name;
    console.log(`\nChecking index: ${indexName}`);
    
    const index = pc.index(indexName);
    
    // Get stats
    const stats = await index.describeIndexStats();
    console.log(`\nIndex stats:`);
    console.log(`- Total record count: ${stats.totalRecordCount}`);
    console.log(`- Dimensions: ${stats.dimension}`);
    
    if (stats.namespaces) {
      console.log(`\nNamespaces:`);
      Object.keys(stats.namespaces).forEach(ns => {
        console.log(`- ${ns}: ${stats.namespaces?.[ns]?.recordCount || 0} records`);
      });
    }
    
    // If records exist, get some sample records
    if (stats.totalRecordCount && stats.totalRecordCount > 0) {
      const namespace = Object.keys(stats.namespaces || {})[0] || 'ns1';
      console.log(`\nFetching sample records from namespace '${namespace}'...`);
      
      const queryResult = await index.namespace(namespace).query({
        topK: 2,
        vector: Array(stats.dimension).fill(0).map(() => Math.random() - 0.5), // Random vector
        includeMetadata: true,
      });
      
      if (queryResult.matches?.length) {
        console.log(`\nFound ${queryResult.matches.length} sample records:`);
        queryResult.matches.forEach((match, i) => {
          console.log(`\nSample ${i+1}:`);
          console.log(`- ID: ${match.id}`);
          console.log(`- Score: ${match.score}`);
          if (match.metadata?.text) {
            const text = match.metadata.text as string;
            const textPreview = text.length > 200 
              ? text.substring(0, 200) + '...' 
              : text;
            console.log(`- Text preview: "${textPreview}"`);
          }
        });
      } else {
        console.log('No records found in the query result');
      }
    }
    
  } catch (error) {
    console.error('Error checking Pinecone:', error);
  }
}

checkPinecone().catch(console.error); 