import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';
import { getUserIndex } from '@/lib/pinecone';
import { getSharedIndex } from '@/lib/shared-pinecone';

// Interface for the document data stored in localStorage
interface StoredDocument {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  syncId?: string; // Unique identifier for each sync operation
}

// Interface for the document data we return
interface SyncedDocument {
  id: string;
  name: string;
  syncedAt: Date;
  url?: string;
  syncId?: string; // Add syncId to UI representation
}

// Interface for delete request
interface DeleteDocumentRequest {
  syncId: string;
  documentId: string;
}

// Store document data that comes from clients (in memory storage)
let storedDocuments: StoredDocument[] = [];

export async function GET() {
  try {
    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      return NextResponse.json(
        { error: 'You must be logged in to view synced documents' },
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
      // Get the user's Pinecone index
      const index = await getUserIndex(formattedUsername);
      
      // Get stats to check if documents exist
      const stats = await index.describeIndexStats();
      
      // We're reading the document data from our in-memory store
      // In a real implementation, this would come from a database
      const serverData = {
        documents: storedDocuments.length > 0 ? storedDocuments : [
          {
            id: 'sample1',
            title: 'Sample Document (Add real documents by syncing)',
            url: 'https://docs.google.com/document/',
            createdAt: new Date().toISOString()
          }
        ]
      };
      
      if (!serverData || !serverData.documents || serverData.documents.length === 0) {
        return NextResponse.json({ 
          documents: [],
          stats: {
            recordCount: stats.totalRecordCount || 0,
            namespaces: Object.keys(stats.namespaces || {})
          }
        });
      }
      
      // Convert the stored document format to the format needed for the UI
      const documents: SyncedDocument[] = serverData.documents.map((doc: StoredDocument) => ({
        id: doc.id || Math.random().toString(36).substring(2),
        name: doc.title || 'Untitled Document',
        syncedAt: new Date(doc.createdAt || Date.now()),
        url: doc.url,
        syncId: doc.syncId || `legacy_${doc.id}` // Generate a stable syncId for legacy entries
      }));
      
      // Deduplicate documents by ID before returning them
      // This ensures we only show one entry per document, keeping the most recent one
      const documentMap = new Map<string, SyncedDocument>();
      for (const doc of documents) {
        // Only add or replace if the document is more recent
        const existingDoc = documentMap.get(doc.id);
        if (!existingDoc || new Date(doc.syncedAt) > new Date(existingDoc.syncedAt)) {
          documentMap.set(doc.id, doc);
        }
      }
      
      // Convert map back to array
      const deduplicatedDocuments = Array.from(documentMap.values());
      
      return NextResponse.json({ 
        documents: deduplicatedDocuments,
        stats: {
          recordCount: stats.totalRecordCount || 0,
          namespaces: Object.keys(stats.namespaces || {})
        }
      });
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch synced documents:', error);
      
      if (error.message && error.message.includes('index not found')) {
        // No documents synced yet
        return NextResponse.json({ documents: [] });
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch synced documents', details: error.message },
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

// API endpoint to get data from client-side localStorage
export async function POST(request: Request) {
  try {
    const { documents } = await request.json();
    
    // Store the documents in memory
    // (In a real app, you would save to a database)
    if (Array.isArray(documents)) {
      // Make sure all documents have a syncId
      const processedDocuments = documents.map(doc => {
        if (!doc.syncId) {
          // Create a stable syncId for legacy documents based on document ID
          const syncId = `legacy_${doc.id}`;
          console.log(`Adding syncId ${syncId} to legacy document: ${doc.title}`);
          return { ...doc, syncId };
        }
        return doc;
      });

      // Deduplicate documents by their ID, not their syncId
      // This ensures we don't have multiple entries for the same Google Doc
      const existingDocIds = new Set(storedDocuments.map(doc => doc.id));
      
      // Only add documents that don't already exist in the stored documents by ID
      const newDocuments = processedDocuments.filter(doc => !existingDocIds.has(doc.id));
      
      if (newDocuments.length > 0) {
        storedDocuments = [...storedDocuments, ...newDocuments];
        console.log(`Added ${newDocuments.length} new documents from client`);
        
        // Log the first few document IDs for debugging
        if (newDocuments.length > 0) {
          const sampleDocs = newDocuments.slice(0, Math.min(3, newDocuments.length));
          console.log('Sample new documents:');
          sampleDocs.forEach(doc => {
            console.log(`- Title: ${doc.title}, ID: ${doc.id}, syncId: ${doc.syncId}`);
          });
        }
      } else {
        console.log('No new documents to add, all documents already exist in server storage');
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving document data:', error);
    return NextResponse.json({ error: 'Failed to save document data' }, { status: 500 });
  }
}

// API endpoint to delete a document and its vectors
export async function DELETE(request: Request) {
  try {
    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      return NextResponse.json(
        { error: 'You must be logged in to delete documents' },
        { status: 401 }
      );
    }

    // Parse the request body
    const data: DeleteDocumentRequest = await request.json();
    const { syncId, documentId } = data;
    
    console.log(`[DEBUG] Attempting to delete document - syncId: ${syncId}, documentId: ${documentId}`);
    
    if (!syncId || !documentId) {
      return NextResponse.json(
        { error: 'Both syncId and documentId are required' },
        { status: 400 }
      );
    }

    // Format username for Pinecone
    const formattedUsername = authSession.user.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    try {
      // 1. Remove document from in-memory storage
      const initialCount = storedDocuments.length;
      storedDocuments = storedDocuments.filter(doc => doc.syncId !== syncId);
      const removedCount = initialCount - storedDocuments.length;
      
      console.log(`[DEBUG] Removed ${removedCount} document(s) from server storage`);
      
      // 2. Delete vectors from Pinecone
      try {
        const index = await getUserIndex(formattedUsername);
        const namespaceName = 'ns1';
        
        // Create a filter to find vectors for this document
        const filter = {
          documentId: { $eq: documentId }
        };
        
        console.log(`[DEBUG] Deleting vectors for document ${documentId} from Pinecone index: ${formattedUsername}, namespace: ${namespaceName}`);
        
        // First query to check if there are any vectors
        // We need a sample vector to query with - here we use a dummy vector
        const sampleVector = new Array(1536).fill(0);
        sampleVector[0] = 1; // Just to make it non-zero
        
        const countResponse = await index.namespace(namespaceName).query({
          vector: sampleVector,
          topK: 10,
          filter: filter,
          includeMetadata: true,
        });
        
        if (countResponse.matches && countResponse.matches.length > 0) {
          // Get the IDs of vectors to delete
          const idsToDelete = countResponse.matches.map(match => match.id);
          
          console.log(`[DEBUG] Found ${idsToDelete.length} vectors to delete for document ${documentId}`);
          
          if (idsToDelete.length > 0) {
            await index.namespace(namespaceName).deleteMany(idsToDelete);
            console.log(`[DEBUG] Successfully deleted ${idsToDelete.length} vectors from Pinecone`);
          }
        } else {
          console.log(`[DEBUG] No vectors found for document ${documentId} in Pinecone`);
        }
        
        // Also delete from shared index
        try {
          const sharedIndex = await getSharedIndex();
          console.log(`[DEBUG] Checking for vectors in shared index for document ${documentId}`);
          
          const sharedResponse = await sharedIndex.namespace(namespaceName).query({
            vector: sampleVector,
            topK: 50, // Get more matches to ensure we find all vectors
            filter: filter,
            includeMetadata: true,
          });
          
          if (sharedResponse.matches && sharedResponse.matches.length > 0) {
            const sharedIdsToDelete = sharedResponse.matches.map(match => match.id);
            
            console.log(`[DEBUG] Found ${sharedIdsToDelete.length} vectors to delete from shared index for document ${documentId}`);
            
            if (sharedIdsToDelete.length > 0) {
              await sharedIndex.namespace(namespaceName).deleteMany(sharedIdsToDelete);
              console.log(`[DEBUG] Successfully deleted ${sharedIdsToDelete.length} vectors from shared index`);
            }
          } else {
            console.log(`[DEBUG] No vectors found for document ${documentId} in shared index`);
          }
        } catch (sharedError) {
          console.error(`[ERROR] Failed to delete vectors from shared index:`, sharedError);
          // Continue even if shared index deletion fails
        }
      } catch (pineconeError) {
        console.error(`[ERROR] Failed to delete vectors from Pinecone:`, pineconeError);
        // We'll continue even if Pinecone deletion fails, so the UI can be updated
      }
      
      return NextResponse.json({ 
        success: true,
        message: `Document with syncId ${syncId} removed successfully`,
        removedDocuments: removedCount
      });
    } catch (error: any) {
      console.error('[ERROR] Failed to delete document:', error);
      return NextResponse.json(
        { error: 'Failed to delete document', details: error.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ERROR] Unexpected error in DELETE handler:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
} 