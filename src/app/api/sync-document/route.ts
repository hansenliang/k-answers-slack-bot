import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAuthServerSession } from '@/lib/auth';
import { chunkTextByMultiParagraphs } from '@/app/chunk';
import { buildPineconeRecords } from '@/app/embed';
import { getUserIndex } from '@/lib/pinecone';
import { getSharedIndex } from '@/lib/shared-pinecone';

interface SyncDocumentRequest {
  documentId: string;
}

export async function POST(request: Request) {
  try {
    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      return NextResponse.json(
        { error: 'You must be logged in to sync documents' },
        { status: 401 }
      );
    }

    // Parse the request body
    const data: SyncDocumentRequest = await request.json();
    const { documentId } = data;
    
    console.log(`[DEBUG] Attempting to sync document: ${documentId}`);
    
    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }

    // Format username for Pinecone
    const formattedUsername = authSession.user.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Initialize the OAuth2 client
    const auth = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    // Set the access token from the session
    if (!authSession.accessToken) {
      return NextResponse.json(
        { error: 'Google authentication token is missing. Please sign in again.' },
        { status: 401 }
      );
    }

    auth.setCredentials({
      access_token: authSession.accessToken,
    });

    // Initialize the Drive API
    console.log('[DEBUG] Initializing Google Drive API');
    const drive = google.drive({ version: 'v3', auth });
    console.log('[DEBUG] Google Drive API initialized successfully');

    // Get document details
    try {
      // First, check if the document exists and is accessible
      let docResponse;
      console.log(`[DEBUG] Attempting to access Google document with ID: ${documentId}`);
      try {
        docResponse = await drive.files.get({
          fileId: documentId,
          fields: 'id, name, mimeType',
        });
        console.log(`[DEBUG] Successfully retrieved document metadata`);
      } catch (error: any) {
        console.error('[ERROR] Error getting document:', error);
        
        if (error.response) {
          console.error('[ERROR] Response status:', error.response.status);
          console.error('[ERROR] Response data:', JSON.stringify(error.response.data || {}));
        }
        
        if (error.message && error.message.includes('not found')) {
          return NextResponse.json(
            { error: 'Document not found. Please check the document ID or URL.' },
            { status: 404 }
          );
        } else if (error.message && (error.message.includes('permission') || error.message.includes('access'))) {
          return NextResponse.json(
            { error: 'You do not have permission to access this document. Make sure it is shared with your Google account.' },
            { status: 403 }
          );
        } else {
          return NextResponse.json(
            { error: 'Error accessing Google document: ' + (error.message || 'Unknown error') },
            { status: 500 }
          );
        }
      }

      const doc = docResponse.data;
      if (!doc.name) {
        return NextResponse.json(
          { error: 'Document has no name or could not be accessed' },
          { status: 404 }
        );
      }

      // Check if the file is a Google Doc
      const mimeType = doc.mimeType;
      if (mimeType !== 'application/vnd.google-apps.document') {
        return NextResponse.json(
          { error: 'The file is not a Google Document. Only Google Docs are supported.' },
          { status: 400 }
        );
      }

      // Fetch document content with error handling for permission issues
      let content: string;
      try {
        console.log(`[DEBUG] Attempting to export document content as plain text`);
        const contentResponse = await drive.files.export({
          fileId: documentId,
          mimeType: 'text/plain',
        });
        
        content = contentResponse.data as string;
        console.log(`[DEBUG] Successfully exported document content (length: ${content?.length || 0} characters)`);
        
        // Check if we actually got content
        if (!content || content.length === 0) {
          console.error('[ERROR] Document content is empty');
          return NextResponse.json(
            { error: 'Document is empty. Please add content to the document before syncing.' },
            { status: 400 }
          );
        }
        
        // Check if content is too small
        if (content.length < 50) {
          console.error('[ERROR] Document content is too short:', content.length);
          return NextResponse.json(
            { error: 'Document content is too short. Please add more content before syncing.' },
            { status: 400 }
          );
        }
      } catch (exportError: any) {
        console.error('[ERROR] Error exporting document content:', exportError);
        
        if (exportError.response) {
          console.error('[ERROR] Response status:', exportError.response.status);
          console.error('[ERROR] Response data:', JSON.stringify(exportError.response.data || {}));
        }
        
        return NextResponse.json(
          { error: 'Failed to access document content. You may not have permission to view this document.' },
          { status: 403 }
        );
      }

      // We've successfully validated the document and retrieved content
      // Now process and store it in Pinecone
      
      // Get the user index
      const indexName = formattedUsername;
      let index;
      try {
        index = await getUserIndex(indexName);
        console.log(`[DEBUG] Successfully got Pinecone index for user: ${indexName}`);
      } catch (indexError) {
        console.error('[ERROR] Error getting Pinecone index:', indexError);
        return NextResponse.json(
          { error: 'Failed to access vector database. Please try again later.' },
          { status: 500 }
        );
      }

      // Document content is ready to be processed
      console.log(`[DEBUG] Chunking document content`);
      const chunks = chunkTextByMultiParagraphs(content);
      console.log(`[DEBUG] Generated ${chunks.length} chunks from document`);
      
      if (chunks.length === 0) {
        console.error('[ERROR] No chunks generated from document content');
        return NextResponse.json(
          { error: 'Document content could not be processed. Make sure it contains paragraphs of text.' },
          { status: 400 }
        );
      }
      
      try {
        // Build Pinecone records with chunked content
        console.log(`[DEBUG] Building embeddings for ${chunks.length} chunks`);
        const formattedEmbeddings = await buildPineconeRecords(chunks);
        console.log(`[DEBUG] Successfully created ${formattedEmbeddings.length} embeddings`);
        
        // Use the namespace
        const namespaceName = 'ns1';
        console.log(`[DEBUG] Preparing to upsert embeddings to Pinecone index: ${indexName}, namespace: ${namespaceName}`);
        
        // First, delete existing vectors for this document
        try {
          console.log(`[DEBUG] Checking for existing vectors for document ${documentId}`);
          
          // Create a metadata filter
          const filter = {
            documentId: { $eq: documentId }
          };
          
          // We need a sample vector to query with - here we use a dummy vector
          const sampleVector = new Array(1536).fill(0);
          sampleVector[0] = 1; // Just to make it non-zero
          
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
              console.log(`[DEBUG] Successfully deleted ${idsToDelete.length} old vectors for document ${documentId}`);
            }
          } else {
            console.log(`[DEBUG] No existing vectors found for document ${documentId}`);
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
        } catch (filterError) {
          console.error('[ERROR] Error checking for existing vectors:', filterError);
          // Continue with upsert anyway
        }

        // Add documentId to each vector's metadata
        const embeddingsWithDocId = formattedEmbeddings.map(item => ({
          ...item,
          metadata: {
            ...item.metadata,
            documentId: documentId,
          }
        }));

        // Upsert the new embeddings
        try {
          await index.namespace(namespaceName).upsert(embeddingsWithDocId);
          console.log(`[DEBUG] Successfully stored embeddings in Pinecone`);
          
          // Also store in the shared index for cross-user search
          try {
            // Get the shared index
            const sharedIndex = await getSharedIndex();
            
            // Add userId to each vector's metadata to track ownership
            const embeddingsWithUserInfo = embeddingsWithDocId.map(item => ({
              ...item,
              metadata: {
                ...item.metadata,
                userId: formattedUsername, // Add the user ID to track who owns this document
              }
            }));
            
            // Upsert to the shared index
            await sharedIndex.namespace('ns1').upsert(embeddingsWithUserInfo);
            console.log(`[DEBUG] Successfully stored embeddings in shared index`);
          } catch (sharedIndexError) {
            console.error('[ERROR] Failed to store embeddings in shared index:', sharedIndexError);
            // Continue even if shared index fails - user's index was already updated
          }

          // Update the document timestamp in localStorage via client-side code
          // The client will handle this after getting a successful response

          return NextResponse.json({
            success: true,
            documentName: doc.name,
            syncedAt: new Date().toISOString(),
          });
        } catch (pineconeError) {
          console.error('[ERROR] Failed to upsert embeddings to Pinecone:', pineconeError);
          
          let errorMessage = 'Failed to store document embeddings in the database';
          let errorDetails = '';
          
          if (pineconeError instanceof Error) {
            errorMessage = `Pinecone error: ${pineconeError.message}`;
            // Check for common Pinecone error patterns
            if (pineconeError.message.includes('404')) {
              errorDetails = 'The index or namespace might not exist. Try again after the system creates the index.';
            } else if (pineconeError.message.includes('401') || pineconeError.message.includes('403')) {
              errorDetails = 'Authentication error with Pinecone. Check your API key.';
            } else if (pineconeError.message.includes('429')) {
              errorDetails = 'Pinecone rate limit exceeded. Please try again later.';
            } else if (pineconeError.message.includes('timeout')) {
              errorDetails = 'Connection to Pinecone timed out. Please try again.';
            }
          }
          
          return NextResponse.json(
            { 
              error: errorMessage, 
              details: errorDetails || 'See server logs for more information' 
            },
            { status: 500 }
          );
        }
      } catch (error) {
        console.error('[ERROR] Error processing document:', error);
        return NextResponse.json(
          { error: 'Failed to process document: ' + (error instanceof Error ? error.message : 'Unknown error') },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error('[ERROR] Error syncing document:', error);
      return NextResponse.json(
        { error: 'Failed to sync document: ' + (error instanceof Error ? error.message : 'Unknown error') },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ERROR] Error processing request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 