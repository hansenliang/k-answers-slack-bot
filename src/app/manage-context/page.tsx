'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SyncForm from '@/components/SyncForm';
import { ArrowLeft } from 'lucide-react';
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

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      
      // First, send localStorage data to the server if available
      await sendStoredDocumentsToServer();
      
      // Then fetch the document list
      const response = await fetch('/api/synced-documents');
      if (response.ok) {
        const data = await response.json();
        setSyncedDocs(data.documents || []);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setIsLoading(false);
    }
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
  const handleRemoveDocument = async (syncId: string) => {
    if (typeof window !== 'undefined') {
      try {
        console.log(`Attempting to remove document with syncId: ${syncId}`);
        
        const storedPrds = localStorage.getItem('prds');
        if (storedPrds) {
          const parsedPrds = JSON.parse(storedPrds);
          console.log(`Found ${parsedPrds.length} documents in localStorage`);
          
          // Log document we're trying to remove
          const docToRemove = parsedPrds.find((doc: any) => doc.syncId === syncId);
          if (docToRemove) {
            console.log(`Found document to remove: ${docToRemove.title} (ID: ${docToRemove.id}, syncId: ${docToRemove.syncId})`);
          } else {
            console.warn(`No document found with syncId: ${syncId}`);
            // Try with legacy pattern where syncId might not exist
            const legacyDocToRemove = parsedPrds.find((doc: any) => doc.id === syncId);
            if (legacyDocToRemove) {
              console.log(`Found document using ID instead of syncId: ${legacyDocToRemove.title}`);
              // Update the filter to handle this case
              const updatedPrds = parsedPrds.filter((doc: any) => doc.id !== syncId);
              console.log(`Removed document by ID. Remaining docs: ${updatedPrds.length}`);
              localStorage.setItem('prds', JSON.stringify(updatedPrds));
              await fetchDocuments();
              return;
            }
          }
          
          // Remove only the specific document instance with this syncId
          const updatedPrds = parsedPrds.filter((doc: any) => doc.syncId !== syncId);
          console.log(`Filtered documents. Before: ${parsedPrds.length}, After: ${updatedPrds.length}`);
          
          if (parsedPrds.length === updatedPrds.length) {
            console.warn('No documents were removed - syncId might not match any documents');
          }
          
          localStorage.setItem('prds', JSON.stringify(updatedPrds));
          
          // Refresh the document list
          await fetchDocuments();
        } else {
          console.warn('No documents found in localStorage');
        }
      } catch (error) {
        console.error('Error removing document:', error);
      }
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
          <h2 className="text-lg font-medium mb-4">Synced Documents</h2>
          
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
                    <button 
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                      aria-label="Remove document"
                      onClick={() => handleRemoveDocument(doc.syncId)}
                    >
                      Remove
                    </button>
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