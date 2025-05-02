'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SyncForm from '@/components/SyncForm';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';

interface SyncedDocument {
  id: string;         // Document ID (from Google Docs)
  syncId: string;     // Unique identifier for this specific sync instance
  name: string;
  syncedAt: Date;
  url?: string;
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

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      
      // Only send localStorage data to the server on initial load, not after removal
      if (syncedDocs.length === 0) {
        await sendStoredDocumentsToServer();
      }
      
      // Then fetch the document list
      const response = await fetch('/api/synced-documents');
      if (response.ok) {
        const data = await response.json();
        
        // Ensure we have the correct data structure
        const documents = data.documents || [];
        
        // Apply client-side deduplication by ID to ensure unique documents in UI
        const uniqueDocs = deduplicate(documents);
        
        setSyncedDocs(uniqueDocs);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

    try {
      const response = await fetch('/api/sync-all-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('Error syncing all documents:', result.error);
        setSyncError(result.error || 'Failed to sync documents');
        return;
      }

      // Update localStorage with new timestamps for synced documents
      if (typeof window !== 'undefined' && result.syncedDocuments?.length > 0) {
        const storedPrds = localStorage.getItem('prds');
        if (storedPrds) {
          const parsedPrds = JSON.parse(storedPrds);
          
          // Create a map of successfully synced document IDs for quick lookup
          const syncedIds = new Set(result.syncedDocuments.map((doc: any) => doc.id));
          
          // Update timestamps for synced documents
          const updatedPrds = parsedPrds.map((doc: any) => {
            if (syncedIds.has(doc.id)) {
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

      // Update UI with new sync times for successful syncs
      if (result.syncedDocuments?.length > 0) {
        setSyncedDocs(prevDocs => {
          // Create a map of successfully synced documents with their new sync times
          const syncedDocsMap = new Map<string, { syncedAt: Date }>(
            result.syncedDocuments.map((doc: { id: string; syncedAt?: string }) => [
              doc.id, 
              { syncedAt: new Date(doc.syncedAt || new Date().toISOString()) }
            ])
          );
          
          // Update each document in the UI
          return prevDocs.map(doc => {
            const syncedDoc = syncedDocsMap.get(doc.id);
            if (syncedDoc) {
              return { ...doc, syncedAt: syncedDoc.syncedAt };
            }
            return doc;
          });
        });
      }

      // If there were failures, show a message
      if (result.failedCount > 0) {
        const failedNames = result.failedDocuments
          .map((doc: any) => doc.name)
          .join(', ');
        
        setSyncError(`Failed to sync ${result.failedCount} document(s): ${failedNames}`);
      }
    } catch (error) {
      console.error('Error syncing all documents:', error);
      setSyncError('Failed to sync documents: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Fetch synced documents on page load
  useEffect(() => {
    if (session) {
      fetchDocuments();
    }
  }, [session]);

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
          <h2 className="text-lg font-medium mb-4">Sync a Document</h2>
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
      </div>
    </div>
  );
} 