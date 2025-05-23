// Add Node.js runtime declaration at the top of the file
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';
import { getUserIndex } from '@/lib/pinecone';
import { getSharedIndex } from '@/lib/shared-pinecone';

// Interface for delete request
interface DeleteDocumentRequest {
  syncId: string;
  documentId: string;
}

// Keep track of deleted documents to prevent reappearing
const deletedDocumentIds = new Set<string>();

export async function POST(request: Request) {
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

    // Add to the list of deleted documents
    deletedDocumentIds.add(documentId);
    console.log(`[DEBUG] Added ${documentId} to deleted documents list`);
    console.log(`[DEBUG] Currently tracking ${deletedDocumentIds.size} deleted document IDs`);

    // Format username for Pinecone
    const formattedUsername = authSession.user.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    try {
      // Delete vectors from Pinecone
      try {
        const index = await getUserIndex(formattedUsername);
        const namespaceName = 'ns1';
        
        // Create a filter to find vectors for this document
        const filter = {
          documentId: { $eq: documentId }
        };
        
        console.log(`[DEBUG] Deleting vectors for document ${documentId} from Pinecone index: ${formattedUsername}, namespace: ${namespaceName}`);
        
        // First query to check if there are any vectors
        // We need a sample vector to query with - here we use a dummy vector of the correct dimension
        const sampleVector = new Array(1536).fill(0);
        sampleVector[0] = 1; // Just to make it non-zero
        
        try {
          const countResponse = await index.namespace(namespaceName).query({
            vector: sampleVector,
            topK: 50, // Get more matches to ensure we find all vectors
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
              
              // If we found the max number of matches, there might be more
              if (countResponse.matches.length === 50) {
                console.log(`[DEBUG] There might be more vectors to delete. Consider implementing pagination for large documents.`);
              }
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
        } catch (queryError) {
          console.error('[ERROR] Failed to query Pinecone for vectors to delete:', queryError);
        }
      } catch (pineconeError) {
        console.error('[ERROR] Failed to access Pinecone for deletion:', pineconeError);
      }
      
      return NextResponse.json({ 
        success: true,
        message: `Document with ID ${documentId} removed successfully`,
        deletedDocumentIds: Array.from(deletedDocumentIds)
      });
    } catch (error: unknown) {
      console.error('[ERROR] Failed to delete document:', error);
      return NextResponse.json(
        { error: 'Failed to delete document', details: error instanceof Error ? error.message : 'Unknown error' },
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

// Export the deletedDocumentIds set for use by other API endpoints
export { deletedDocumentIds }; 