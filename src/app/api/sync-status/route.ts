import { NextResponse } from 'next/server';
import { getAuthServerSession } from '@/lib/auth';

// Maximum time a sync can be running before we assume it's stale (in ms)
// This helps prevent a sync from showing as "in progress" forever after a server restart
const MAX_SYNC_DURATION = 30 * 60 * 1000; // 30 minutes

// In a real app, this would be in a database or Redis
// For now we'll use a global object to track sync status across requests
const globalSyncStatus = {
  isSyncing: false,
  syncStart: null as Date | null,
  progress: {
    totalDocs: 0,
    syncedDocs: 0,
    failedDocs: 0,
    inProgressDocs: 0
  },
  currentDocumentName: null as string | null,
  currentStep: null as string | null,
  documents: [] as Array<{
    id: string,
    name: string,
    synced: boolean,
    error?: string,
    steps?: Array<{step: string, timestamp: Date}>
  }>,
  lastUpdated: null as Date | null,
  // Activity log to show what the backend is doing
  activityLog: [] as Array<{
    message: string,
    timestamp: Date,
    type: 'info' | 'debug' | 'error' | 'success'
  }>
};

// Maximum number of activity log entries to keep
const MAX_LOG_ENTRIES = 20;

// Export the sync status object so other API routes can update it
export const syncStatus = globalSyncStatus;

// Add a log entry with a timestamp
export function addLogEntry(message: string, type: 'info' | 'debug' | 'error' | 'success' = 'info') {
  // Add log to the beginning of the array (newest first)
  globalSyncStatus.activityLog.unshift({
    message,
    timestamp: new Date(),
    type
  });
  
  // Trim log to keep only the most recent entries
  if (globalSyncStatus.activityLog.length > MAX_LOG_ENTRIES) {
    globalSyncStatus.activityLog = globalSyncStatus.activityLog.slice(0, MAX_LOG_ENTRIES);
  }
  
  // Update the lastUpdated timestamp
  globalSyncStatus.lastUpdated = new Date();
}

// Reset the sync status when all done
export function resetSyncStatus() {
  // Keep the activity log but clear everything else
  const activityLog = globalSyncStatus.activityLog;
  
  globalSyncStatus.isSyncing = false;
  globalSyncStatus.syncStart = null;
  globalSyncStatus.progress = {
    totalDocs: 0,
    syncedDocs: 0,
    failedDocs: 0,
    inProgressDocs: 0
  };
  globalSyncStatus.currentDocumentName = null;
  globalSyncStatus.currentStep = null;
  globalSyncStatus.documents = [];
  globalSyncStatus.lastUpdated = new Date();
  // Keep the activity log
  globalSyncStatus.activityLog = activityLog;
  
  // Add log entry that sync was reset
  addLogEntry('Sync process complete', 'success');
}

// Initialize sync operation with document list
export function initializeSyncStatus(documents: Array<{id: string, name: string}>) {
  globalSyncStatus.isSyncing = true;
  globalSyncStatus.syncStart = new Date();
  globalSyncStatus.progress = {
    totalDocs: documents.length,
    syncedDocs: 0,
    failedDocs: 0,
    inProgressDocs: 0
  };
  globalSyncStatus.documents = documents.map(doc => ({
    id: doc.id,
    name: doc.name,
    synced: false
  }));
  globalSyncStatus.lastUpdated = new Date();
  
  // Add log entry about starting sync
  addLogEntry(`Starting sync for ${documents.length} documents`, 'info');
}

// Update status for a specific document
export function updateDocumentStatus(docId: string, status: {
  synced?: boolean,
  error?: string,
  currentStep?: string
}) {
  const docIndex = globalSyncStatus.documents.findIndex(d => d.id === docId);
  
  if (docIndex !== -1) {
    const doc = globalSyncStatus.documents[docIndex];
    
    // Update document status
    if (status.synced !== undefined) {
      doc.synced = status.synced;
      
      // Update counts
      if (status.synced) {
        globalSyncStatus.progress.syncedDocs++;
        globalSyncStatus.progress.inProgressDocs = Math.max(0, globalSyncStatus.progress.inProgressDocs - 1);
        addLogEntry(`Document '${doc.name}' synced successfully`, 'success');
      } else if (status.error) {
        globalSyncStatus.progress.failedDocs++;
        globalSyncStatus.progress.inProgressDocs = Math.max(0, globalSyncStatus.progress.inProgressDocs - 1);
        addLogEntry(`Error syncing '${doc.name}': ${status.error}`, 'error');
      }
    }
    
    if (status.error) {
      doc.error = status.error;
    }
    
    if (status.currentStep) {
      // Add step to document history
      if (!doc.steps) doc.steps = [];
      doc.steps.push({
        step: status.currentStep,
        timestamp: new Date()
      });
      
      // Update global current step
      globalSyncStatus.currentStep = status.currentStep;
      globalSyncStatus.currentDocumentName = doc.name;
      
      // Add log entry for this step
      addLogEntry(`${doc.name}: ${status.currentStep}`, 'debug');
    }
    
    // Update the document in the array
    globalSyncStatus.documents[docIndex] = doc;
    globalSyncStatus.lastUpdated = new Date();
  }
}

// Mark document as in progress
export function markDocumentInProgress(docId: string) {
  const docIndex = globalSyncStatus.documents.findIndex(d => d.id === docId);
  
  if (docIndex !== -1) {
    const doc = globalSyncStatus.documents[docIndex];
    globalSyncStatus.currentDocumentName = doc.name;
    globalSyncStatus.progress.inProgressDocs++;
    globalSyncStatus.lastUpdated = new Date();
    
    // Add log entry
    addLogEntry(`Started processing '${doc.name}'`, 'info');
  }
}

// Check if sync is stale (hasn't been updated in the max allowed time)
function isSyncStale() {
  if (!globalSyncStatus.isSyncing) return false;
  
  // If no last updated timestamp, use sync start time
  const lastActivity = globalSyncStatus.lastUpdated || globalSyncStatus.syncStart;
  
  // If no tracking at all, it's not stale (never started)
  if (!lastActivity) return false;
  
  const now = new Date();
  const elapsedMs = now.getTime() - lastActivity.getTime();
  
  // If sync has been running for longer than the max allowed time, consider it stale
  return elapsedMs > MAX_SYNC_DURATION;
}

// Check if sync needs to be reset due to stale state
function resetIfStale() {
  if (isSyncStale()) {
    console.log('[WARN] Detected stale sync state, resetting');
    addLogEntry('Detected stale sync process, resetting', 'error');
    resetSyncStatus();
    return true;
  }
  return false;
}

// Track the last time we sent a response for an unchanged sync status
let lastResponseTime: number = 0;
let lastResponseHash: string = '';

export async function GET() {
  try {
    // Check for stale sync and reset if needed
    const wasStale = resetIfStale();
    
    // Authenticate user
    const authSession = await getAuthServerSession();

    if (!authSession?.user?.name) {
      return NextResponse.json(
        { error: 'You must be logged in to check sync status' },
        { status: 401 }
      );
    }

    // Calculate elapsed time in a more accurate way
    const now = new Date();
    const elapsedTimeMs = globalSyncStatus.syncStart 
      ? now.getTime() - globalSyncStatus.syncStart.getTime() 
      : 0;
    
    // Log the elapsed time calculation for debugging
    console.log('[DEBUG] Current time:', now.toISOString());
    console.log('[DEBUG] Sync start time:', globalSyncStatus.syncStart?.toISOString());
    console.log('[DEBUG] Calculated elapsed time:', elapsedTimeMs, 'ms');

    // If we have activity logs but no current step, try to extract it from the most recent log
    if (globalSyncStatus.activityLog.length > 0 && !globalSyncStatus.currentStep) {
      const latestLog = globalSyncStatus.activityLog[0]; // First entry is the latest
      if (latestLog.type !== 'error') {
        globalSyncStatus.currentStep = latestLog.message;
      }
    }

    // Create response payload
    const responseData = {
      isSyncing: globalSyncStatus.isSyncing,
      syncStart: globalSyncStatus.syncStart,
      progress: globalSyncStatus.progress,
      currentDocumentName: globalSyncStatus.currentDocumentName,
      currentStep: globalSyncStatus.currentStep,
      documents: globalSyncStatus.documents,
      elapsedTimeMs: elapsedTimeMs,
      wasStale: wasStale,
      lastUpdated: globalSyncStatus.lastUpdated,
      activityLog: globalSyncStatus.activityLog,
      serverTime: now.toISOString() // Send server time for client-side verification
    };
    
    // Create a hash of the response to check if it's unchanged
    const responseHash = JSON.stringify({
      isSyncing: responseData.isSyncing,
      progress: responseData.progress,
      currentStep: responseData.currentStep,
      documents: responseData.documents.map(d => ({
        id: d.id,
        synced: d.synced,
        error: d.error
      })),
      activityLogLength: responseData.activityLog.length
    });
    
    // Check if we've sent the same response recently (within last 500ms)
    const currentTime = Date.now();
    if (
      responseHash === lastResponseHash && 
      currentTime - lastResponseTime < 500 &&
      !wasStale
    ) {
      // Return a 304 Not Modified with cache control headers
      return new Response(null, {
        status: 304,
        headers: {
          'Cache-Control': 'max-age=1',
          'ETag': `"${lastResponseHash.substring(0, 8)}"`,
        }
      });
    }
    
    // Update tracking variables for response caching
    lastResponseTime = currentTime;
    lastResponseHash = responseHash;
    
    // Return full response with cache control headers
    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'max-age=1',
        'ETag': `"${responseHash.substring(0, 8)}"`,
      }
    });
  } catch (error) {
    console.error('[ERROR] Error checking sync status:', error);
    return NextResponse.json(
      { error: 'Failed to check sync status: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
} 