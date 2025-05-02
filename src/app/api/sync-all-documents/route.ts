import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';

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

    // Get the list of documents to sync
    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/synced-documents`, {
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch document list' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const documents = data.documents || [];

    if (documents.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No documents to sync',
        syncedDocuments: [],
      });
    }

    // Sync each document and track results
    const syncResults = [];
    const failures = [];

    for (const doc of documents) {
      try {
        console.log(`[DEBUG] Syncing document: ${doc.id} (${doc.name})`);
        
        const syncResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/sync-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: request.headers.get('cookie') || '',
          },
          body: JSON.stringify({ documentId: doc.id }),
        });

        const syncResult = await syncResponse.json();

        if (syncResponse.ok) {
          syncResults.push({
            id: doc.id,
            syncId: doc.syncId,
            name: syncResult.documentName || doc.name,
            syncedAt: syncResult.syncedAt || new Date().toISOString(),
            success: true,
          });
        } else {
          console.error(`[ERROR] Failed to sync document ${doc.id} (${doc.name}):`, syncResult.error);
          failures.push({
            id: doc.id,
            syncId: doc.syncId,
            name: doc.name,
            error: syncResult.error || 'Unknown error',
          });
        }
      } catch (error) {
        console.error(`[ERROR] Exception syncing document ${doc.id} (${doc.name}):`, error);
        failures.push({
          id: doc.id,
          syncId: doc.syncId,
          name: doc.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      syncedCount: syncResults.length,
      failedCount: failures.length,
      syncedDocuments: syncResults,
      failedDocuments: failures,
    });
  } catch (error) {
    console.error('[ERROR] Error processing sync all request:', error);
    return NextResponse.json(
      { error: 'Failed to sync documents: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
} 