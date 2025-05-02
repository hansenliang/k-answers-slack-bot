'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SyncForm from '@/components/SyncForm';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { ProgressNotification, type Document as SyncDocument } from '@/components/progress-notification';

interface SyncedDocument {
  id: string;         // Document ID (from Google Docs)
  syncId: string;     // Unique identifier for this specific sync instance
  name: string;
  syncedAt: Date;
  url?: string;
}

interface SyncResultDocument {
  id: string;
  syncId: string;
  name: string;
  syncedAt: string;
  success: boolean;
  error?: string;
}

// Add debounce utility
function debounce<T extends (...args: any[]) => any>(
  fn: T, 
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return function(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, ms);
  };
}

export default function ManageContextPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [syncedDocs, setSyncedDocs] = useState<SyncedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingDocId, setRemovingDocId] = useState<string | null>(null);
  const [syncingDocIds, setSyncingDocIds] = useState<string[]>([]);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Sync progress states
  const [syncProgressDocs, setSyncProgressDocs] = useState<SyncDocument[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [currentDocumentName, setCurrentDocumentName] = useState<string | null>(null); 
  const [elapsedTimeMs, setElapsedTimeMs] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<Array<{
    message: string,
    timestamp: Date,
    type: 'info' | 'debug' | 'error' | 'success'
  }>>([]);
  
  // Polling interval for sync status updates (in ms)
  const SYNC_STATUS_POLLING_INTERVAL = 2000; 
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Track document fetch state
  const fetchInProgressRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const MIN_FETCH_INTERVAL = 2000; // Minimum time between fetches in ms

  // Function declarations in the ManageContextPage component
  const fetchDocuments = useCallback(async (force = false) => {
    // Prevent multiple concurrent fetches
    if (fetchInProgressRef.current) {
      console.log("Fetch already in progress, skipping");
      return;
    }
    
    // Throttle fetches to prevent rapid repetition
    const now = Date.now();
    if (!force && now - lastFetchTimeRef.current < MIN_FETCH_INTERVAL) {
      console.log("Fetch called too soon, skipping");
      return;
    }
    
    try {
      console.log("Fetching documents...");
      fetchInProgressRef.current = true;
      lastFetchTimeRef.current = now;
      setIsLoading(true);
      
      // Only send localStorage data to the server on initial load, not after removal
      if (syncedDocs.length === 0) {
        await sendStoredDocumentsToServer();
      }
      
      // Then fetch the document list
      const response = await fetch('/api/synced-documents');
      
      // Handle 304 Not Modified as a success case - it means documents haven't changed
      if (response.status === 304) {
        console.log("Documents unchanged (304 Not Modified)");
        // Keep existing documents as they are
        setIsLoading(false);
        fetchInProgressRef.current = false;
        return;
      }
      
      if (response.ok) {
        const data = await response.json();
        
        // Ensure we have the correct data structure
        const documents = data.documents || [];
        
        // Apply client-side deduplication by ID to ensure unique documents in UI
        const uniqueDocs = deduplicate(documents);
        
        setSyncedDocs(uniqueDocs);
      } else {
        console.error("Error fetching documents:", response.status);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setIsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [syncedDocs.length]);
  
  // Create a debounced version of fetchDocuments for repeated calls
  const debouncedFetchDocuments = useCallback(
    debounce(() => fetchDocuments(), 500),
    [fetchDocuments]
  );

  // Function to check sync status from the API
  const checkSyncStatus = useCallback(async () => {
    try {
      console.log("Checking sync status...");
      const response = await fetch('/api/sync-status?_=' + new Date().getTime()); // Add cache buster
      
      // Handle 304 Not Modified as a success case - it means nothing has changed
      if (response.status === 304) {
        console.log("Sync status unchanged (304 Not Modified)");
        // Just continue with current state
        return isSyncingAll;
      }
      
      if (response.ok) {
        const status = await response.json();
        
        // If a stale sync was detected and reset by the API, refresh documents
        if (status.wasStale) {
          console.log("API detected and reset a stale sync, refreshing documents");
          setIsSyncingAll(false);
          return false;
        }
        
        if (status.isSyncing) {
          // Set sync in progress flag
          setIsSyncingAll(true);
          
          // Update document progress
          if (status.documents && status.documents.length > 0) {
            console.log("Setting sync progress docs:", status.documents.length);
            setSyncProgressDocs(status.documents.map((doc: any) => ({
              id: doc.id,
              name: doc.name,
              synced: doc.synced,
              error: doc.error,
              currentStep: doc.currentStep,
              steps: doc.steps
            })));
          }
          
          // Update current status details
          setCurrentStep(status.currentStep);
          setCurrentDocumentName(status.currentDocumentName);
          
          // Log elapsed time to help debug
          console.log("Elapsed time from API:", status.elapsedTimeMs);
          setElapsedTimeMs(status.elapsedTimeMs || 0);
          
          // Update activity log if available
          if (status.activityLog && status.activityLog.length > 0) {
            console.log("Setting activity log:", status.activityLog.length, "entries");
            setActivityLog(status.activityLog.map((entry: any) => ({
              message: entry.message,
              timestamp: new Date(entry.timestamp),
              type: entry.type
            })));
          }
          
          return true; // Still syncing
        } else {
          // Only fetch documents if we're transitioning from syncing -> not syncing
          const wasSyncing = isSyncingAll;
          setIsSyncingAll(false);
          
          if (wasSyncing) {
            console.log("Sync finished, scheduling document refresh");
            debouncedFetchDocuments();
          }
          
          return false; // Not syncing
        }
      } else {
        // Only log errors for status codes other than 304
        console.error("Error response from sync status API:", response.status);
      }
    } catch (error) {
      console.error('Error checking sync status:', error);
    }
    return false;
  }, [debouncedFetchDocuments, isSyncingAll]);

  // Set up polling for sync status
  const startSyncStatusPolling = useCallback(() => {
    console.log("Starting sync status polling");
    // Clear any existing polling
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    
    // Do an initial check
    checkSyncStatus();
    
    // Set up polling
    pollRef.current = setInterval(async () => {
      console.log("Polling sync status...");
      const isStillSyncing = await checkSyncStatus();
      
      if (!isStillSyncing && pollRef.current) {
        // If no longer syncing, stop polling
        console.log("Sync complete, stopping polling");
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000); // Reduced polling frequency to prevent too many requests
    
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [checkSyncStatus]);

  // Helper function to deduplicate documents by ID
  const deduplicate = (documents: SyncedDocument[]) => {
    // Create a map to store documents by ID, keeping only the most recent
    const documentMap = new Map<string, SyncedDocument>();
    
    for (const doc of documents) {
      const existingDoc = documentMap.get(doc.id);
      
      // Only replace if the doc is more recent or doesn't exist
      if (!existingDoc || new Date(doc.syncedAt) > new Date(existingDoc.syncedAt)) {
        documentMap.set(doc.id, doc);
      }
    }
    
    // Convert back to array
    return Array.from(documentMap.values());
  };

  // Send local storage PRD data to the server
  const sendStoredDocumentsToServer = async () => {
    if (typeof window !== 'undefined') {
      try {
        const storedPrds = localStorage.getItem('prds');
        if (storedPrds) {
          const parsedPrds = JSON.parse(storedPrds);
          
          // Send the data to the server
          await fetch('/api/synced-documents', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ documents: parsedPrds }),
          });
        }
      } catch (error) {
        console.error('Error sending stored documents to server:', error);
      }
    }
  };

  // Handle document removal
  const handleRemoveDocument = async (syncId: string, docId: string) => {
    if (typeof window !== 'undefined') {
      try {
        // Set the document as being removed to show loading state
        setRemovingDocId(docId);
        console.log(`Attempting to remove document with syncId: ${syncId}, docId: ${docId}`);
        
        // 1. First update localStorage
        const storedPrds = localStorage.getItem('prds');
        if (storedPrds) {
          const parsedPrds = JSON.parse(storedPrds);
          console.log(`Found ${parsedPrds.length} documents in localStorage`);
          
          // Remove the document
          const updatedPrds = parsedPrds.filter((doc: any) => doc.syncId !== syncId);
          console.log(`Filtered documents. Before: ${parsedPrds.length}, After: ${updatedPrds.length}`);
          
          // Update localStorage
          localStorage.setItem('prds', JSON.stringify(updatedPrds));
        }
        
        // 2. Call the DELETE API to remove from server and Pinecone
        try {
          const response = await fetch('/api/synced-documents', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              syncId: syncId,
              documentId: docId
            }),
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            console.error('Error from delete API:', result.error);
          } else {
            console.log('Delete API success:', result.message);
            
            // 3. Update the UI immediately without refetching
            setSyncedDocs(prevDocs => prevDocs.filter(doc => doc.syncId !== syncId));
          }
        } catch (apiError) {
          console.error('API error when deleting document:', apiError);
          // Continue to refresh UI anyway
          await fetchDocuments();
        }
      } catch (error) {
        console.error('Error removing document:', error);
        // Fallback to fetch if anything goes wrong
        await fetchDocuments();
      } finally {
        // Clear the removing state when done
        setRemovingDocId(null);
      }
    }
  };

  // Handle syncing a single document
  const handleSyncDocument = async (docId: string) => {
    if (syncingDocIds.includes(docId)) {
      return; // Already syncing
    }

    setSyncError(null);
    setSyncingDocIds(prev => [...prev, docId]);

    try {
      const response = await fetch('/api/sync-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentId: docId }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('Error syncing document:', result.error);
        setSyncError(result.error || 'Failed to sync document');
        return;
      }

      // Update document in localStorage with new timestamp
      if (typeof window !== 'undefined') {
        const storedPrds = localStorage.getItem('prds');
        if (storedPrds) {
          const parsedPrds = JSON.parse(storedPrds);
          
          // Find the document by ID
          const updatedPrds = parsedPrds.map((doc: any) => {
            if (doc.id === docId) {
              return {
                ...doc,
                createdAt: new Date().toISOString(), // Update timestamp
              };
            }
            return doc;
          });
          
          localStorage.setItem('prds', JSON.stringify(updatedPrds));
        }
      }

      // Update UI with new sync time
      setSyncedDocs(prevDocs => 
        prevDocs.map(doc => 
          doc.id === docId 
            ? { ...doc, syncedAt: new Date(result.syncedAt) } 
            : doc
        )
      );

    } catch (error) {
      console.error('Error syncing document:', error);
      setSyncError('Failed to sync document: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setSyncingDocIds(prev => prev.filter(id => id !== docId));
    }
  };

  // Handle syncing all documents
  const handleSyncAllDocuments = async () => {
    if (isSyncingAll) {
      return; // Already syncing
    }

    setSyncError(null);
    setIsSyncingAll(true);

    // Initialize progress tracking for all documents
    const docsToTrack = syncedDocs.map(doc => ({
      id: doc.id,
      name: doc.name,
      synced: false
    }));
    console.log("Setting initial docs to track:", docsToTrack.length);
    setSyncProgressDocs(docsToTrack);
    
    // Start the timer at 0
    setElapsedTimeMs(0);

    try {
      // Start polling for status updates immediately
      console.log("Starting sync status polling for Sync All");
      startSyncStatusPolling();
      
      // Request sync for all documents
      const response = await fetch('/api/sync-all-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        // Handle general error from the API
        const errorResult = await response.json();
        console.error('Error syncing all documents:', errorResult.error);
        setSyncError(errorResult.error || 'Failed to sync documents');
        
        // Mark all documents as failed in the progress tracker
        setSyncProgressDocs(prevDocs => 
          prevDocs.map(doc => ({ 
            ...doc, 
            synced: false, 
            error: 'Sync operation failed' 
          }))
        );
        
        // Stop polling on error
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        
        setIsSyncingAll(false);
        return;
      }

      // Process the response
      const result = await response.json();
      console.log("Sync all documents response:", result);

      // Let the polling handle the progress until it's done
      // Don't manually set isSyncingAll to false here, let the polling detect completion
    } catch (error) {
      console.error('Error syncing all documents:', error);
      setSyncError('Failed to sync documents: ' + (error instanceof Error ? error.message : 'Unknown error'));
      
      // Mark all as failed in the progress tracker
      setSyncProgressDocs(prevDocs => 
        prevDocs.map(doc => ({ 
          ...doc, 
          synced: false, 
          error: 'Sync operation failed' 
        }))
      );
      
      // Stop polling on error
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      
      // Make sure to reset syncing state on error
      setIsSyncingAll(false);
    }
  };

  // Check if there's an ongoing sync when the page loads
  useEffect(() => {
    if (session) {
      // Check if a sync is already in progress FIRST before fetching documents
      const checkForOngoingSync = async () => {
        try {
          const isSyncing = await checkSyncStatus();
          if (isSyncing) {
            console.log("Detected ongoing sync, starting polling");
            startSyncStatusPolling();
          } else {
            // Only fetch documents if we're not already syncing
            fetchDocuments(true); // Force initial fetch
          }
        } catch (error) {
          console.error("Error checking sync status:", error);
          // Fallback to fetching documents if status check fails
          fetchDocuments(true);
        }
      };

      checkForOngoingSync();
    }
    
    // Cleanup on unmount
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [session, checkSyncStatus, startSyncStatusPolling, fetchDocuments]);

  // Add an effect to handle page visibility changes
  useEffect(() => {
    // This handles when the user returns to the tab/window
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("Page became visible, checking sync status");
        checkSyncStatus().then(isSyncing => {
          if (isSyncing) {
            console.log("Found ongoing sync after returning to page");
            startSyncStatusPolling();
          }
        });
      }
    };

    // Listen for visibility changes (user switching tabs/windows)
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also check when the component mounts (might have been server-rendered)
    if (typeof window !== 'undefined' && document.visibilityState === 'visible') {
      console.log("Initial visibility check");
      checkSyncStatus().then(isSyncing => {
        if (isSyncing) {
          console.log("Found ongoing sync on initial mount");
          startSyncStatusPolling();
        }
      });
    }
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkSyncStatus, startSyncStatusPolling]);

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-[800px]">
        {/* Header with back button */}
        <div className="flex items-center mb-8">
          <button 
            onClick={() => router.push('/chat')}
            className="flex items-center text-zinc-400 hover:text-white transition-colors mr-4"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-5 w-5 mr-1" />
            <span>Back</span>
          </button>
          <h1 className="text-[1.25rem] font-medium">Manage Context</h1>
        </div>

        {/* Sync form section */}
        <div className="mb-10 bg-zinc-900 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Add a Document</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Add documents to provide context for your questions. The AI will search through 
            these documents to find the most relevant answers.
          </p>
          <SyncForm onSyncComplete={fetchDocuments} />
        </div>

        {/* Synced documents list */}
        <div className="bg-zinc-900 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">Synced Documents</h2>
            
            {syncedDocs.length > 0 && (
              <button
                className={`text-xs flex items-center px-2 py-1 rounded ${
                  isSyncingAll 
                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' 
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                } transition-colors`}
                onClick={handleSyncAllDocuments}
                disabled={isSyncingAll}
                aria-label="Sync all documents"
              >
                <RefreshCw
                  className={`h-3 w-3 mr-1 ${isSyncingAll ? 'animate-spin' : ''}`}
                />
                <span>{isSyncingAll ? 'Syncing...' : 'Sync All'}</span>
              </button>
            )}
          </div>
          
          {syncError && (
            <div className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-red-200 text-sm">
              {syncError}
            </div>
          )}
          
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-pulse text-zinc-500">Loading documents...</div>
            </div>
          ) : syncedDocs.length > 0 ? (
            <div className="space-y-2">
              {syncedDocs.map((doc) => (
                <div key={doc.syncId} className="border border-zinc-800 rounded-md p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-white font-medium">
                        {doc.url ? (
                          <a 
                            href={doc.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:text-blue-400 transition-colors"
                          >
                            {doc.name}
                          </a>
                        ) : (
                          doc.name
                        )}
                      </h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        Synced on {new Date(doc.syncedAt).toLocaleDateString()} at {new Date(doc.syncedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        className={`text-xs flex items-center ${
                          syncingDocIds.includes(doc.id) 
                            ? 'text-blue-400 cursor-not-allowed' 
                            : 'text-zinc-500 hover:text-blue-400'
                        } transition-colors`}
                        aria-label="Sync document"
                        onClick={() => handleSyncDocument(doc.id)}
                        disabled={syncingDocIds.includes(doc.id)}
                      >
                        <RefreshCw 
                          className={`h-3 w-3 mr-1 ${syncingDocIds.includes(doc.id) ? 'animate-spin' : ''}`} 
                        />
                        {syncingDocIds.includes(doc.id) ? 'Syncing...' : 'Sync'}
                      </button>
                      <button 
                        className={`text-xs ${
                          removingDocId === doc.id 
                            ? 'text-red-400 animate-pulse' 
                            : 'text-zinc-500 hover:text-red-400'
                        } transition-colors`}
                        aria-label="Remove document"
                        onClick={() => handleRemoveDocument(doc.syncId, doc.id)}
                        disabled={removingDocId === doc.id}
                      >
                        {removingDocId === doc.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500">
              <p>No documents synced yet.</p>
              <p className="text-sm mt-2">Use the form above to sync your first document.</p>
            </div>
          )}
        </div>

        {/* Progress notification */}
        <div className="fixed inset-0 z-50 pointer-events-none">
          <ProgressNotification
            isLoading={isSyncingAll}
            documents={syncProgressDocs}
            onComplete={() => {
              setSyncProgressDocs([]);
              setActivityLog([]);
            }}
            position="top-center"
            currentStep={currentStep || undefined}
            currentDocumentName={currentDocumentName || undefined}
            elapsedTimeMs={elapsedTimeMs}
            activityLog={activityLog}
          />
        </div>
      </div>
    </div>
  );
} 