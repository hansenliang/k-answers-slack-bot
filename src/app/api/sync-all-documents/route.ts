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

    // For each document, attempt to sync and capture detailed results
    for (const doc of documents) {
      try {
        // Skip documents with missing IDs
        if (!doc.id) {
          console.error(`[ERROR] Document missing ID, skipping:`, doc);
          failures.push({
            id: doc.id || 'unknown',
            syncId: doc.syncId || 'unknown',
            name: doc.name || 'Unknown document',
            error: 'Document ID missing or invalid'
          });
          continue;
        }

        console.log(`[DEBUG] Syncing document: ${doc.id} (${doc.name || 'unnamed'})`);
        
        const syncResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/sync-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: request.headers.get('cookie') || '',
          },
          body: JSON.stringify({ documentId: doc.id }),
        });

        // Parse response, handling potential JSON parsing errors
        let syncResult;
        try {
          syncResult = await syncResponse.json();
        } catch (parseError) {
          console.error(`[ERROR] Failed to parse sync response for ${doc.id}:`, parseError);
          throw new Error('Invalid response from sync API');
        }

        if (syncResponse.ok) {
          // Add successfully synced document to results
          syncResults.push({
            id: doc.id,
            syncId: doc.syncId || `gdoc_${doc.id}`, // Fallback to consistent ID format
            name: syncResult.documentName || doc.name || `Document ${doc.id}`,
            syncedAt: syncResult.syncedAt || new Date().toISOString(),
            success: true,
          });
        } else {
          console.error(`[ERROR] Failed to sync document ${doc.id} (${doc.name || 'unnamed'}):`, syncResult.error);
          failures.push({
            id: doc.id,
            syncId: doc.syncId || `gdoc_${doc.id}`,
            name: doc.name || `Document ${doc.id}`,
            error: syncResult.error || 'Unknown error during sync',
          });
        }
      } catch (error) {
        console.error(`[ERROR] Exception syncing document ${doc.id || 'unknown'} (${doc.name || 'unnamed'}):`, error);
        failures.push({
          id: doc.id || 'unknown',
          syncId: doc.syncId || (doc.id ? `gdoc_${doc.id}` : 'unknown'),
          name: doc.name || `Document ${doc.id || 'unknown'}`,
          error: error instanceof Error ? error.message : 'Unknown error during sync process',
        });
      }
    }

    // Return detailed results with both successes and failures
    return NextResponse.json({
      success: true,
      syncedCount: syncResults.length,
      failedCount: failures.length,
      totalCount: documents.length,
      completionPercentage: Math.round((syncResults.length / documents.length) * 100),
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