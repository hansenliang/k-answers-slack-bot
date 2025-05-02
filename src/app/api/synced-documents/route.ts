import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';
import { getUserIndex } from '@/lib/pinecone';

// Interface for the document data stored in localStorage
interface StoredDocument {
  id: string;
  title: string;
  url: string;
  createdAt: string;
}

// Interface for the document data we return
interface SyncedDocument {
  id: string;
  name: string;
  syncedAt: Date;
  url?: string;
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
        url: doc.url
      }));
      
      return NextResponse.json({ 
        documents,
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
      storedDocuments = documents;
      console.log(`Received and stored ${documents.length} documents from client`);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving document data:', error);
    return NextResponse.json({ error: 'Failed to save document data' }, { status: 500 });
  }
} 