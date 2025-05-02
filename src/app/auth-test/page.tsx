'use client';

import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getEnvironmentInfo } from '../env-debug';

export default function AuthTestPage() {
  const { data: session, status } = useSession();
  const [sessionJSON, setSessionJSON] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [envInfo, setEnvInfo] = useState<string>('Loading...');

  useEffect(() => {
    try {
      setSessionJSON(JSON.stringify({ status, session }, null, 2));
      setEnvInfo(JSON.stringify(getEnvironmentInfo(), null, 2));
    } catch (e) {
      setError(`Error stringifying data: ${e}`);
    }
  }, [session, status]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Auth Debugging</h1>
      
      <div className="mb-6 p-4 border rounded">
        <h2 className="text-xl mb-2">Session Status: <span className="font-bold">{status}</span></h2>
        
        {status === 'authenticated' && (
          <div className="mb-4">
            <p className="text-green-500">✓ You are authenticated</p>
            <p>User: {session?.user?.email || 'No email found'}</p>
          </div>
        )}
        
        {status === 'unauthenticated' && (
          <div className="mb-4">
            <p className="text-red-500">✗ You are not authenticated</p>
            <button 
              onClick={() => signIn('google')}
              className="px-4 py-2 bg-blue-600 text-white rounded mt-2"
            >
              Sign in with Google
            </button>
          </div>
        )}
        
        {status === 'loading' && (
          <p>Loading session information...</p>
        )}
      </div>
      
      {error && (
        <div className="mb-6 p-4 border rounded bg-red-100">
          <h2 className="text-xl mb-2 text-red-700">Error:</h2>
          <p>{error}</p>
        </div>
      )}
      
      <div className="mb-6">
        <h2 className="text-xl mb-2">Session Data:</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
          {sessionJSON || 'No session data available'}
        </pre>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl mb-2">Environment Info:</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
          {envInfo}
        </pre>
      </div>

      <div className="mb-6">
        <h2 className="text-xl mb-2">Actions:</h2>
        <div className="flex space-x-4">
          <button 
            onClick={() => signIn('google')}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Sign in with Google
          </button>
          <button 
            onClick={() => window.location.href = '/'}
            className="px-4 py-2 bg-gray-600 text-white rounded"
          >
            Go to Home
          </button>
          <button 
            onClick={() => window.location.href = '/auth/signin'}
            className="px-4 py-2 bg-gray-600 text-white rounded"
          >
            Go to Sign-in Page
          </button>
        </div>
      </div>
    </div>
  );
} 