'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getEnvironmentInfo } from '../env-debug';
import Link from 'next/link';

export default function AuthTestPage() {
  const { data: session, status } = useSession();
  const [sessionJSON, setSessionJSON] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [envInfo, setEnvInfo] = useState<string>('Loading...');
  const [signInClicked, setSignInClicked] = useState(false);

  useEffect(() => {
    try {
      setSessionJSON(JSON.stringify({ status, session }, null, 2));
      setEnvInfo(JSON.stringify(getEnvironmentInfo(), null, 2));
      
      // Debug info
      console.log('Auth Test Page - Session Status:', status);
      console.log('Auth Test Page - Session Data:', session);
    } catch (e) {
      setError(`Error stringifying data: ${e}`);
    }
  }, [session, status]);

  const handleSignIn = async () => {
    setSignInClicked(true);
    try {
      console.log('Initiating Google sign-in...');
      await signIn('google', { callbackUrl: '/auth-test' });
    } catch (e) {
      console.error('Sign-in error:', e);
      setError(`Sign-in error: ${e}`);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto bg-gray-100 dark:bg-gray-900 min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">Auth Debugging</h1>
      
      <div className="mb-8 p-6 border rounded bg-white dark:bg-gray-800 shadow-md">
        <h2 className="text-2xl mb-4 text-gray-800 dark:text-white">Status: <span className="font-bold">{status}</span></h2>
        
        {status === 'authenticated' && (
          <div className="mb-4">
            <p className="text-green-500 text-lg">✓ You are authenticated</p>
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900 rounded">
              <p className="font-medium">User: {session?.user?.name || 'No name found'}</p>
              <p>Email: {session?.user?.email || 'No email found'}</p>
              <p>Has Access Token: {session?.accessToken ? 'Yes' : 'No'}</p>
            </div>
            <button 
              onClick={() => signOut({ callbackUrl: '/auth-test' })}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Sign Out
            </button>
          </div>
        )}
        
        {status === 'unauthenticated' && (
          <div className="mb-4">
            <p className="text-red-500 text-lg">✗ You are not authenticated</p>
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900 rounded">
              <p>Sign-in button clicked: {signInClicked ? 'Yes' : 'No'}</p>
              <p>You need to sign in to access protected pages.</p>
            </div>
            <button 
              onClick={handleSignIn}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Sign in with Google
            </button>
          </div>
        )}
        
        {status === 'loading' && (
          <div className="animate-pulse p-4 bg-blue-50 dark:bg-blue-900 rounded">
            <p className="text-lg">Loading session information...</p>
          </div>
        )}
      </div>
      
      {error && (
        <div className="mb-8 p-6 border rounded bg-red-100 dark:bg-red-900 shadow-md">
          <h2 className="text-2xl mb-2 text-red-800 dark:text-red-200">Error:</h2>
          <p className="font-mono">{error}</p>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="p-6 border rounded bg-white dark:bg-gray-800 shadow-md">
          <h2 className="text-2xl mb-4 text-gray-800 dark:text-white">Session Data:</h2>
          <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded overflow-auto max-h-96 text-sm">
            {sessionJSON || 'No session data available'}
          </pre>
        </div>
        
        <div className="p-6 border rounded bg-white dark:bg-gray-800 shadow-md">
          <h2 className="text-2xl mb-4 text-gray-800 dark:text-white">Environment Info:</h2>
          <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded overflow-auto max-h-96 text-sm">
            {envInfo}
          </pre>
        </div>
      </div>

      <div className="mt-8 p-6 border rounded bg-white dark:bg-gray-800 shadow-md">
        <h2 className="text-2xl mb-4 text-gray-800 dark:text-white">Navigation & Actions:</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Link 
            href="/"
            className="px-4 py-2 bg-gray-600 text-white rounded text-center hover:bg-gray-700"
          >
            Home
          </Link>
          <Link 
            href="/chat"
            className="px-4 py-2 bg-gray-600 text-white rounded text-center hover:bg-gray-700"
          >
            Chat Page
          </Link>
          <Link 
            href="/auth/signin"
            className="px-4 py-2 bg-gray-600 text-white rounded text-center hover:bg-gray-700"
          >
            Sign-in Page
          </Link>
          <button 
            onClick={handleSignIn}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Sign in with Google
          </button>
          {status === 'authenticated' && (
            <button 
              onClick={() => signOut({ callbackUrl: '/auth-test' })}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Sign Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 