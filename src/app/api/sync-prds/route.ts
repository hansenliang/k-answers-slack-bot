import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAuthServerSession } from '@/lib/auth';
import { chunkTextByMultiParagraphs } from '@/app/chunk';
import { buildPineconeRecords } from '@/app/embed';
import { getUserIndex } from '@/lib/pinecone';

interface DocumentContent {
  name: string;
  content: string;
}

export async function POST(request: Request) {
  // Wrap the entire function body in a try-catch to ensure we always return JSON
  try {
    // Check for required environment variables right at the start
    const missingEnvVars = [];
    if (!process.env.PINECONE_API_KEY) missingEnvVars.push('PINECONE_API_KEY');
    if (!process.env.OPENAI_API_KEY) missingEnvVars.push('OPENAI_API_KEY');
    if (!process.env.GOOGLE_CLIENT_ID) missingEnvVars.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET) missingEnvVars.push('GOOGLE_CLIENT_SECRET');
    if (!process.env.GOOGLE_REDIRECT_URI) missingEnvVars.push('GOOGLE_REDIRECT_URI');
    
    if (missingEnvVars.length > 0) {
      console.error(`[CRITICAL] Missing environment variables: ${missingEnvVars.join(', ')}`);
      return new Response(
        JSON.stringify({ 
          error: 'Missing required environment variables',
          details: `The following environment variables are missing: ${missingEnvVars.join(', ')}`
        }),
        { 
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    // Add request debugging
    const requestUrl = request.url;
    const requestMethod = request.method;
    console.log(`[DEBUG] API Request: ${requestMethod} ${requestUrl}`);

    try {
      // Safely parse the JSON body with error handling
      let body;
      try {
        body = await request.json();
        console.log(`[DEBUG] Request body:`, JSON.stringify(body));
      } catch (parseError) {
        console.error(`[ERROR] Failed to parse request body:`, parseError);
        return NextResponse.json(
          { error: 'Invalid request body. Could not parse JSON.' },
          { status: 400 }
        );
      }

      const authSession = await getAuthServerSession();
      console.log(`[DEBUG] Auth session:`, authSession ? 'exists' : 'missing');
      
      // Log auth session details without sensitive info
      if (authSession) {
        console.log(`[DEBUG] User:`, authSession.user?.name || 'No name');
        console.log(`[DEBUG] Access token exists:`, !!authSession.accessToken);
        
        // Check token expiration
        if (authSession.expiresAt) {
          const now = Math.floor(Date.now() / 1000);
          const expiresIn = authSession.expiresAt - now;
          console.log(`[DEBUG] Token expires in: ${expiresIn} seconds`);
          
          if (expiresIn <= 0) {
            console.error('[ERROR] Access token is expired!');
            return NextResponse.json(
              { error: 'Your Google authentication has expired. Please sign in again.', details: 'Token expired' },
              { status: 401 }
            );
          } else if (expiresIn < 300) { // Less than 5 minutes remaining
            console.warn('[WARN] Access token is about to expire soon');
          }
        } else {
          console.warn('[WARN] Token expiration time is not available');
        }
        
        // Check if refresh token exists
        console.log(`[DEBUG] Refresh token exists:`, !!authSession.refreshToken);
      }

      if (!authSession?.user?.name) {
        return NextResponse.json({ error: 'You must be logged in to sync documents' }, { status: 401 });
      }

      // Format username to comply with Pinecone naming requirements
      const formattedUsername = authSession.user.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-') // Replace multiple consecutive hyphens with a single one
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

      const indexName = `${formattedUsername}`;
      console.log(`[DEBUG] Using Pinecone index: ${indexName}`);
      
      // Try to validate the pinecone connection before proceeding
      try {
        console.log(`[DEBUG] Attempting to connect to Pinecone...`);
        const index = await getUserIndex(indexName);
        // Just store the index for later use
        console.log(`[DEBUG] Pinecone connection successful`);
      } catch (pineconeError) {
        console.error(`[ERROR] Pinecone connection failed:`, pineconeError);
        return NextResponse.json(
          { error: 'Failed to connect to Pinecone database', details: pineconeError instanceof Error ? pineconeError.message : 'Unknown error' },
          { status: 500 }
        );
      }
      
      const index = await getUserIndex(indexName);
      
      const documentId = body.documentId;

      if (!documentId) {
        return NextResponse.json(
          { error: 'Document ID is required' },
          { status: 400 }
        );
      }

      // Validate the document ID format for Google Docs
      if (!/^[a-zA-Z0-9_-]+$/.test(documentId)) {
        return NextResponse.json(
          { error: 'Invalid document ID format' },
          { status: 400 }
        );
      }

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

      console.log('[DEBUG] Setting Google OAuth credentials');
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
          
          // Check if the error has a response object (typical for Google API errors)
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
          
          // Check if the error has a response object (typical for Google API errors)
          if (exportError.response) {
            console.error('[ERROR] Response status:', exportError.response.status);
            console.error('[ERROR] Response data:', JSON.stringify(exportError.response.data || {}));
          }
          
          return NextResponse.json(
            { error: 'Failed to access document content. You may not have permission to view this document.' },
            { status: 403 }
          );
        }

        // Create document content object
        const documentContent: DocumentContent = {
          name: doc.name,
          content: content,
        };

        // Process and store the document
        console.log(`[DEBUG] Chunking document content`);
        const chunks = chunkTextByMultiParagraphs(documentContent.content);
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
          
          // Upsert the embeddings in a try-catch to handle any Pinecone errors
          try {
            await index.namespace(namespaceName).upsert(formattedEmbeddings);
            console.log(`[DEBUG] Successfully stored embeddings in Pinecone`);
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
        } catch (embeddingError: any) {
          console.error('[ERROR] Error creating or storing embeddings:', embeddingError);
          // If it's an OpenAI error, it might have more details in a nested structure
          if (embeddingError.response) {
            console.error('[ERROR] OpenAI response status:', embeddingError.response.status);
            console.error('[ERROR] OpenAI response data:', JSON.stringify(embeddingError.response.data || {}));
          }
          return NextResponse.json(
            { error: 'Failed to process document content: ' + (embeddingError instanceof Error ? embeddingError.message : 'Unknown error') },
            { status: 500 }
          );
        }
        
        return NextResponse.json({
          message: 'Document synced successfully',
          documentName: documentContent.name,
        });
        
      } catch (docError) {
        console.error('Error accessing document:', docError);
        
        // Handle specific Google API errors
        const errorMessage = docError instanceof Error ? docError.message : 'Unknown error';
        
        if (errorMessage.includes('not found')) {
          return NextResponse.json(
            { error: 'Document not found or you do not have access to it' },
            { status: 404 }
          );
        } else if (errorMessage.includes('permission') || errorMessage.includes('access')) {
          return NextResponse.json(
            { error: 'You do not have permission to access this document' },
            { status: 403 }
          );
        } else {
          return NextResponse.json(
            { error: 'Failed to access the document: ' + errorMessage },
            { status: 500 }
          );
        }
      }
    } catch (error) {
      console.error('Error syncing document:', error);
      return NextResponse.json(
        { error: 'Internal Server Error', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  } catch (finalError) {
    // This is the absolute fallback - if anything goes wrong in the entire handler, we still return JSON
    console.error('Critical error in API route:', finalError);
    
    // Ensure we always return a JSON response, even if there's a critical error
    return new Response(
      JSON.stringify({ 
        error: 'A critical error occurred on the server', 
        details: finalError instanceof Error ? finalError.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
} 