'use client';

import { useSession } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import SyncForm from '@/components/SyncForm';
import { useEffect, useState } from 'react';

interface PRD {
  title: string;
  url: string;
  query?: string;
  createdAt?: string;
  id?: string;
}

export default function SyncPage() {
  const { data: session, status } = useSession();
  const [syncedPrds, setSyncedPrds] = useState<PRD[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const refreshSyncedPrds = () => {
    const stored = localStorage.getItem('prds');
    if (stored) {
      try {
        const parsedPrds = JSON.parse(stored);
        // Filter out any invalid PRD objects

        setSyncedPrds(parsedPrds);
      } catch (error) {
        console.error('Error parsing PRDs from localStorage:', error);
        setSyncedPrds([]);
      }
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      refreshSyncedPrds();
    }
  }, []);

  const totalPages = Math.ceil(syncedPrds.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPrds = syncedPrds.slice(startIndex, endIndex);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#FFFAF3] flex items-center justify-center">
        <div className="text-[#232426] animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#FFFAF3]">
      <Sidebar />
      <div className={`ml-64 flex items-center justify-center min-h-screen bg-[#FFFAF3]`}>
        <div className="max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8 flex justify-center">
            <div className="w-full max-w-4xl space-y-8">
            <SyncForm onSyncComplete={refreshSyncedPrds} />
            {/* Synced PRDs Table - match width with other cards */}
            <div className="bg-notion-light-card dark:bg-notion-dark-card rounded-xl shadow-lg border border-notion-light-border dark:border-notion-dark-border overflow-x-auto animate-fade-in">
              <h2 className="text-2xl font-bold text-notion-light-text dark:text-notion-dark-text px-6 pt-6">Synced Documents</h2>
                      <h3 className="text-sm text-notion-light-lightText dark:text-notion-dark-lightText mb-6 px-6 pt-6">
                        Whenever you write a PRD, we&apos;ll query these documents to find relevant information to provide K:Answers bot
                      </h3>
              <table className="min-w-full divide-y divide-notion-light-border dark:divide-notion-dark-border">
                <thead>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-notion-light-text dark:text-notion-dark-text">Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-notion-light-border dark:divide-notion-dark-border">
                  {syncedPrds.length === 0 ? (
                    <tr>
                      <td className="px-6 py-4 text-notion-light-accent dark:text-notion-dark-accent text-center font-semibold">No synced PRDs found.</td>
                    </tr>
                  ) : (
                    currentPrds.map((prd, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-4">
                          <a
                            href={prd.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-notion-light-text dark:text-notion-dark-text font-semibold hover:text-notion-light-accent dark:hover:text-notion-dark-accent hover-transition"
                          >
                            {prd.title || 'Untitled PRD'}
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-notion-light-border dark:border-notion-dark-border">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors
                        ${currentPage === 1 
                          ? 'text-notion-light-border cursor-not-allowed' 
                          : 'text-notion-light-text hover:text-notion-light-accent'}`}
                    >
                      Previous
                    </button>
                    <span className="text-sm text-notion-light-text">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors
                        ${currentPage === totalPages 
                          ? 'text-notion-light-border cursor-not-allowed' 
                          : 'text-notion-light-text hover:text-notion-light-accent'}`}
                    >
                      Next
                    </button>
                </div>
                  <div className="text-sm text-notion-light-text">
                    Showing {startIndex + 1}-{Math.min(endIndex, syncedPrds.length)} of {syncedPrds.length} PRDs
              </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 