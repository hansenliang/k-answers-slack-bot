import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';
import { 
  syncStatus, 
  initializeSyncStatus, 
  updateDocumentStatus, 
  markDocumentInProgress,
  resetSyncStatus,
  addLogEntry
} from '../sync-status/route';

export async function POST(request: Request) {
  try {
    // If already syncing, return the current status
    if (syncStatus.isSyncing) {
      addLogEntry('Sync already in progress, rejecting new request', 'info');
      return NextResponse.json({
        success: false,
        message: 'Sync operation already in progress',
        isSyncing: true,
        syncStatus: syncStatus,
      }, { status: 409 }); // Conflict status code
    }

    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      addLogEntry('Authentication failed for sync request', 'error');
      return NextResponse.json(
        { error: 'You must be logged in to sync documents' },
        { status: 401 }
      );
    }

    addLogEntry('Starting sync process, fetching document list', 'info');
    
    // Get the list of documents to sync
    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/synced-documents`, {
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    if (!response.ok) {
      addLogEntry('Failed to fetch document list from API', 'error');
      return NextResponse.json(
        { error: 'Failed to fetch document list' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const documents = data.documents || [];

    addLogEntry(`Found ${documents.length} documents to sync`, 'info');

    if (documents.length === 0) {
      addLogEntry('No documents to sync, ending process', 'info');
      return NextResponse.json({
        success: true,
        message: 'No documents to sync',
        syncedDocuments: [],
      });
    }

    // Initialize sync status
    interface DocumentData {
      id?: string;
      name?: string;
    }

    initializeSyncStatus(documents.map((doc: DocumentData) => ({
      id: doc.id || 'unknown',
      name: doc.name || `Document ${doc.id}` || 'Unknown document'
    })));

    // Sync each document and track results
    const syncResults = [];
    const failures = [];

    // For each document, attempt to sync and capture detailed results
    for (const doc of documents) {
      try {
        // Skip documents with missing IDs
        if (!doc.id) {
          console.error(`[ERROR] Document missing ID, skipping:`, doc);
          updateDocumentStatus(doc.id || 'unknown', {
            synced: false,
            error: 'Document ID missing or invalid'
          });
          failures.push({
            id: doc.id || 'unknown',
            syncId: doc.syncId || 'unknown',
            name: doc.name || 'Unknown document',
            error: 'Document ID missing or invalid'
          });
          continue;
        }

        // Mark document as in progress
        markDocumentInProgress(doc.id);
        
        // Update status for each major step
        updateDocumentStatus(doc.id, { 
          currentStep: 'Preparing to sync document' 
        });
        
        console.log(`[DEBUG] Syncing document: ${doc.id} (${doc.name || 'unnamed'})`);
        
        // Update status with more detailed steps
        updateDocumentStatus(doc.id, { 
          currentStep: 'Fetching document content from Google Docs' 
        });
        
        addLogEntry(`Fetching content from Google Docs for '${doc.name}'`, 'debug');
        
        const syncResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/sync-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: request.headers.get('cookie') || '',
          },
          body: JSON.stringify({ documentId: doc.id }),
        });

        // Update status for processing step
        updateDocumentStatus(doc.id, { 
          currentStep: 'Processing document response' 
        });

        // Parse response, handling potential JSON parsing errors
        let syncResult;
        try {
          syncResult = await syncResponse.json();
          addLogEntry(`Received response for '${doc.name}'`, 'debug');
        } catch (parseError) {
          console.error(`[ERROR] Failed to parse sync response for ${doc.id}:`, parseError);
          updateDocumentStatus(doc.id, {
            synced: false,
            error: 'Invalid response from sync API',
            currentStep: 'Failed to parse API response'
          });
          throw new Error('Invalid response from sync API');
        }

        if (syncResponse.ok) {
          // Update with indexing status
          updateDocumentStatus(doc.id, { 
            currentStep: 'Document successfully indexed in vector database' 
          });
          
          addLogEntry(`Successfully indexed '${doc.name}' in vector database`, 'success');
          
          // Add successfully synced document to results
          syncResults.push({
            id: doc.id,
            syncId: doc.syncId || `gdoc_${doc.id}`, // Fallback to consistent ID format
            name: syncResult.documentName || doc.name || `Document ${doc.id}`,
            syncedAt: syncResult.syncedAt || new Date().toISOString(),
            success: true,
          });
          
          // Mark as complete in status tracker
          updateDocumentStatus(doc.id, {
            synced: true,
            currentStep: 'Sync completed successfully'
          });
        } else {
          console.error(`[ERROR] Failed to sync document ${doc.id} (${doc.name || 'unnamed'}):`, syncResult.error);
          updateDocumentStatus(doc.id, {
            synced: false,
            error: syncResult.error || 'Unknown error during sync',
            currentStep: 'Sync failed'
          });
          failures.push({
            id: doc.id,
            syncId: doc.syncId || `gdoc_${doc.id}`,
            name: doc.name || `Document ${doc.id}`,
            error: syncResult.error || 'Unknown error during sync',
          });
        }
      } catch (error) {
        console.error(`[ERROR] Exception syncing document ${doc.id || 'unknown'} (${doc.name || 'unnamed'}):`, error);
        updateDocumentStatus(doc.id || 'unknown', {
          synced: false,
          error: error instanceof Error ? error.message : 'Unknown error during sync process',
          currentStep: 'Exception during sync process'
        });
        failures.push({
          id: doc.id || 'unknown',
          syncId: doc.syncId || (doc.id ? `gdoc_${doc.id}` : 'unknown'),
          name: doc.name || `Document ${doc.id || 'unknown'}`,
          error: error instanceof Error ? error.message : 'Unknown error during sync process',
        });
      }
    }

    // Mark sync process as complete
    addLogEntry(`Sync completed: ${syncResults.length} successful, ${failures.length} failed`, 'info');
    
    const finalStatus = { ...syncStatus };
    resetSyncStatus();

    // Return detailed results with both successes and failures
    return NextResponse.json({
      success: true,
      syncedCount: syncResults.length,
      failedCount: failures.length,
      totalCount: documents.length,
      completionPercentage: Math.round((syncResults.length / documents.length) * 100),
      syncedDocuments: syncResults,
      failedDocuments: failures,
      statusDetails: finalStatus
    });
  } catch (error: unknown) {
    console.error(`[ERROR] Error syncing documents:`, error);
    
    const errorDetail = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to sync documents: ${errorDetail}` },
      { status: 500 }
    );
  }
} 