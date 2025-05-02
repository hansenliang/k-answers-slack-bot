'use client';

import React, { useState } from 'react';
import { ProgressNotification, type Document } from '@/components/progress-notification';

interface SyncFormProps {
  onSyncComplete?: () => void;
}

interface GoogleDoc {
  id: string;
  name: string;
}

export default function SyncForm({ onSyncComplete }: SyncFormProps) {
  const [inputValue, setInputValue] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [inputType, setInputType] = useState<'folder' | 'document'>('folder');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Function to extract Document ID from Google Docs URL
  const extractDocumentId = (url: string): string | null => {
    // Pattern for Google Docs URLs
    const docPattern = /\/document\/d\/([a-zA-Z0-9_-]+)/;
    const match = url.match(docPattern);
    return match ? match[1] : null;
  };

  // Determine if input is a folder ID or a document URL
  const detectInputType = (value: string): 'folder' | 'document' => {
    if (value.includes('docs.google.com/document')) {
      return 'document';
    }
    return 'folder';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setInputType(detectInputType(value));
    // Clear any previous errors when input changes
    setSyncStatus('');
    setErrorDetails(null);
    setRetryCount(0);
  };

  const handleRetry = () => {
    // Increment retry count and attempt sync again
    setRetryCount(prev => prev + 1);
    setErrorDetails(null);
    setSyncStatus('');
    handleSyncPRDs(new Event('submit') as any);
  };

  const handleSyncPRDs = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setSyncStatus(''); // Clear any previous error messages
    setErrorDetails(null);
    
    try {
      if (inputType === 'document') {
        // Handle direct document URL
        const documentId = extractDocumentId(inputValue);
        
        if (!documentId) {
          setSyncStatus('Invalid Google Docs URL. Please check the format.');
          setIsSyncing(false);
          return;
        }

        // Setup initial document state
        const initialDoc: Document = {
          id: documentId,
          name: 'Loading document...',
          synced: false,
        };
        setDocuments([initialDoc]);

        // Sync the single document
        let response;
        let data;

        try {
          console.log(`Attempting to sync document with ID: ${documentId} (Retry: ${retryCount})`);
          response = await fetch('/api/sync-prds', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ documentId }),
          });

          // Check if the response is JSON
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            // Instead of throwing directly, log the error and try to handle it
            const responseText = await response.text();
            console.error('Server returned non-JSON response:', responseText);
            
            // Show a more helpful error to the user
            const statusCode = response.status;
            let errorMessage = 'Server returned non-JSON response.';
            
            if (statusCode === 500) {
              errorMessage = 'Server error (500). The server might be experiencing issues with this document.';
              // Store the raw response for debugging
              setErrorDetails(responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
            } else if (statusCode === 401 || statusCode === 403) {
              errorMessage = `Authentication error (${statusCode}). You may need to log in again.`;
            } else if (statusCode === 404) {
              errorMessage = 'Resource not found (404). The document or API endpoint could not be found.';
            }
            
            throw new Error(errorMessage);
          }

          // Get the response data whether it was successful or not
          data = await response.json();
          
          // If details are available in the response, save them
          if (data.details) {
            setErrorDetails(data.details);
          }
        } catch (networkError) {
          // Handle network errors (e.g., server not responding)
          const errorMessage = networkError instanceof Error
            ? `Network error: ${networkError.message}`
            : 'Network error: Could not connect to server';
          console.error(errorMessage, networkError);
          setSyncStatus(errorMessage);
          setDocuments(prevDocs => 
            prevDocs.map(d => 
              d.id === documentId ? { ...d, name: errorMessage, synced: false } : d
            )
          );
          return;
        }

        if (!response.ok) {
          const errorMessage = data.error || 'Failed to sync document';
          console.error(`Sync error: ${errorMessage}`);
          if (data.details) {
            console.error(`Error details: ${data.details}`);
            setErrorDetails(data.details);
          }
          setSyncStatus(errorMessage);
          setDocuments(prevDocs => 
            prevDocs.map(d => 
              d.id === documentId ? { ...d, name: errorMessage, synced: false } : d
            )
          );
          return;
        }
        
        // Update the document status
        setDocuments(prevDocs => 
          prevDocs.map(d => 
            d.id === documentId ? { ...d, name: data.documentName, synced: true } : d
          )
        );

        // Store the document metadata in localStorage with a unique sync ID
        const storedPrds = localStorage.getItem('prds');
        const prds = storedPrds ? JSON.parse(storedPrds) : [];

        // Generate a unique sync ID for this operation
        const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Check if document with same ID already exists
        const existingDocIndex = prds.findIndex((existingDoc: any) => existingDoc.id === documentId);

        if (existingDocIndex >= 0) {
          // Update the existing document with new metadata and syncId
          prds[existingDocIndex] = {
            ...prds[existingDocIndex],
            title: data.documentName,
            url: `https://docs.google.com/document/d/${documentId}`,
            createdAt: new Date().toISOString(),
            syncId: syncId,
            id: documentId
          };
          console.log(`Updated existing document "${data.documentName}" in localStorage`);
        } else {
          // Add new document
          prds.push({
            title: data.documentName,
            url: `https://docs.google.com/document/d/${documentId}`,
            createdAt: new Date().toISOString(),
            syncId: syncId,
            id: documentId
          });
          console.log(`Added document "${data.documentName}" to localStorage`);
        }

        localStorage.setItem('prds', JSON.stringify(prds));

        if (onSyncComplete) {
          onSyncComplete();
        }
      } else {
        // Handle folder ID (original behavior)
        const folderId = inputValue;
        
        // First, fetch all documents from the folder
        let docsResponse;
        let fetchedDocs;

        try {
          docsResponse = await fetch('/api/fetch-docs', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ folderId }),
          });

          if (!docsResponse.ok) {
            const errorData = await docsResponse.json();
            const errorMessage = errorData.error || 'Failed to fetch documents from folder';
            setSyncStatus(errorMessage);
            throw new Error(errorMessage);
          }

          const responseData = await docsResponse.json();
          fetchedDocs = responseData.documents;
        } catch (networkError) {
          const errorMessage = networkError instanceof Error 
            ? networkError.message 
            : 'Network error: Could not connect to fetch documents';
          console.error(errorMessage, networkError);
          setSyncStatus(errorMessage);
          setIsSyncing(false);
          return;
        }
        
        // Initialize documents state with all documents marked as not synced
        const initialDocs: Document[] = fetchedDocs.map((doc: GoogleDoc) => ({
          id: doc.id,
          name: doc.name,
          synced: false,
        }));
        setDocuments(initialDocs);

        // Create an array of promises for each document sync
        const syncPromises = fetchedDocs.map(async (doc: GoogleDoc) => {
          try {
            let response;
            let data;
            
            try {
              response = await fetch('/api/sync-prds', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ documentId: doc.id }),
              });

              // Check if the response is JSON
              const contentType = response.headers.get('content-type');
              if (!contentType || !contentType.includes('application/json')) {
                // Log the error details for debugging
                console.error(`Server returned non-JSON response for document ${doc.name}:`, 
                  await response.text().catch(() => 'Could not get response text'));
                
                // Show a more helpful error based on status code
                const statusCode = response.status;
                let errorMessage = 'Server returned invalid response format';
                
                if (statusCode === 500) {
                  errorMessage = 'Server error (500)';
                } else if (statusCode === 401 || statusCode === 403) {
                  errorMessage = `Authentication error (${statusCode})`;
                } else if (statusCode === 404) {
                  errorMessage = 'Resource not found (404)';
                }
                
                throw new Error(errorMessage);
              }

              data = await response.json();
            } catch (networkError) {
              console.error(`Network error syncing document ${doc.name}:`, networkError);
              
              const errorMessage = networkError instanceof Error
                ? `Network error: ${networkError.message}`
                : 'Network error: Could not connect to server';
              
              // Update the document's error status
              setDocuments(prevDocs => 
                prevDocs.map(d => 
                  d.id === doc.id ? { ...d, name: `${doc.name} - ${errorMessage}`, synced: false } : d
                )
              );
              return null;
            }

            if (!response.ok) {
              const errorMessage = data.error || `Failed to sync document: ${doc.name}`;
              console.error(errorMessage);
              
              // Update the document's error status
              setDocuments(prevDocs => 
                prevDocs.map(d => 
                  d.id === doc.id ? { ...d, name: `${doc.name} - ${errorMessage}`, synced: false } : d
                )
              );
              return null;
            }

            // Update the document's sync status
            setDocuments(prevDocs => 
              prevDocs.map(d => 
                d.id === doc.id ? { ...d, synced: true } : d
              )
            );

            // Store the document name in prds localStorage
            const storedPrds = localStorage.getItem('prds');
            const prds = storedPrds ? JSON.parse(storedPrds) : [];

            // Generate a unique sync ID for this operation
            const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            // Check if document with same ID already exists
            const existingDocIndex = prds.findIndex((existingDoc: any) => existingDoc.id === doc.id);

            if (existingDocIndex >= 0) {
              // Update the existing document with new metadata and syncId
              prds[existingDocIndex] = {
                ...prds[existingDocIndex],
                title: data.documentName,
                url: `https://docs.google.com/document/d/${doc.id}`,
                createdAt: new Date().toISOString(),
                syncId: syncId,
                id: doc.id
              };
              console.log(`Updated existing document "${data.documentName}" in localStorage`);
            } else {
              // Add new document
              prds.push({
                title: data.documentName,
                url: `https://docs.google.com/document/d/${doc.id}`,
                createdAt: new Date().toISOString(),
                syncId: syncId,
                id: doc.id
              });
              console.log(`Added document "${data.documentName}" to localStorage`);
            }

            localStorage.setItem('prds', JSON.stringify(prds));

            return data.documentName;
          } catch (error) {
            console.error(`Error syncing document ${doc.name}:`, error);
            
            // Update the document's error status
            setDocuments(prevDocs => 
              prevDocs.map(d => 
                d.id === doc.id ? { ...d, name: `${doc.name} - Error syncing`, synced: false } : d
              )
            );
            return null;
          }
        });

        // Wait for all sync operations to complete
        const results = await Promise.all(syncPromises);
        
        // Filter out any failed syncs
        const successfulSyncs = results.filter((doc): doc is string => doc !== null);
        
        if (successfulSyncs.length > 0) {
          onSyncComplete?.();
        } else if (fetchedDocs.length > 0 && successfulSyncs.length === 0) {
          setSyncStatus('Failed to sync any documents from the folder');
        }
      }
    } catch (error) {
      console.error('Error in sync process:', error);
      setSyncStatus(error instanceof Error ? error.message : 'An error occurred during the sync process.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSyncPRDs} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            id="inputValue"
            value={inputValue}
            onChange={handleInputChange}
            className="flex-1 rounded-md border border-notion-light-border dark:border-notion-dark-border bg-notion-light-card dark:bg-notion-dark-card px-3 py-2 text-notion-light-text dark:text-notion-dark-text shadow-sm focus:border-notion-light-accent dark:focus:border-notion-dark-accent focus:outline-none focus:ring-1 focus:ring-notion-light-accent dark:focus:ring-notion-dark-accent"
            placeholder="Add Drive Folder ID or Google Docs link"
            required
            disabled={isSyncing}
          />
          <button
            type="submit"
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isSyncing 
                ? 'bg-notion-light-border dark:bg-notion-dark-border cursor-not-allowed' 
                : 'bg-notion-light-accent dark:bg-notion-dark-accent hover:bg-notion-light-accentHover dark:hover:bg-notion-dark-accentHover focus:ring-notion-light-accent dark:focus:ring-notion-dark-accent'
            }`}
            disabled={isSyncing}
          >
            <svg className="w-5 h-5 rotate-[-90deg]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div className="text-xs text-notion-light-lightText dark:text-notion-dark-lightText animate-fade">
          {inputType === 'document' 
            ? 'Google Docs URL detected - will sync this document only' 
            : 'Folder ID detected - will sync all documents in this folder'}
        </div>
      </form>

      {syncStatus && (
        <div className="text-sm text-notion-light-error dark:text-notion-dark-error space-y-2">
          <div className="font-medium">{syncStatus}</div>
          
          {errorDetails && (
            <div className="text-xs bg-notion-light-hover dark:bg-notion-dark-hover p-2 rounded-md max-h-[100px] overflow-y-auto">
              <code className="whitespace-pre-wrap">{errorDetails}</code>
            </div>
          )}
          
          {syncStatus.includes('error') && inputType === 'document' && (
            <button
              onClick={handleRetry}
              className="text-xs py-1 px-3 bg-notion-light-hover dark:bg-notion-dark-hover hover:bg-notion-light-selection dark:hover:bg-notion-dark-selection rounded-md transition-colors"
              disabled={isSyncing}
            >
              Retry Sync
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <ProgressNotification
          isLoading={isSyncing}
          documents={documents}
          onComplete={() => {
            setDocuments([]); // Clear documents after completion
            setSyncStatus(''); // Clear status message
            setIsSyncing(false); // Ensure syncing state is set to false
            setErrorDetails(null); // Clear error details
          }}
          position="top-center"
        />
      </div>
    </div>
  );
} 
