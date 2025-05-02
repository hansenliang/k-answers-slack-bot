'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function Sidebar() {
  const pathname = usePathname();
  const [prdCount, setPrdCount] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('savedPRD');
      if (stored) {
        setPrdCount(JSON.parse(stored).length);
      } else {
        setPrdCount(0);
      }

      // Add event listener for PRD count updates
      const handlePrdCountUpdate = (event: CustomEvent) => {
        setPrdCount(event.detail.count);
      };

      window.addEventListener('prdCountUpdated', handlePrdCountUpdate as EventListener);

      // Cleanup
      return () => {
        window.removeEventListener('prdCountUpdated', handlePrdCountUpdate as EventListener);
      };
    }
  }, []);

  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <div className={`fixed left-0 top-0 h-screen bg-notion-light-card dark:bg-notion-dark-card border-r border-notion-light-border dark:border-notion-dark-border pt-16 transition-all duration-200 animate-slide z-10 ${collapsed ? 'w-20' : 'w-64'}`}>
      <div className="flex flex-col items-center mb-6 select-none">
        <div
          className="flex items-center justify-center cursor-pointer"
          onClick={() => setCollapsed((c) => !c)}
          tabIndex={0}
          role="button"
          aria-label="Toggle sidebar"
        >
          <img
            src="/klaviyo-logo.svg"
            alt="Logo"
            className={`w-5 h-5 transition-all duration-200 ${collapsed ? 'mx-auto' : ''}`}
          />
          <span
            className={`
              transition-all duration-300 ease-in-out
              ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
              overflow-hidden whitespace-nowrap
              text-base font-medium
              text-notion-light-text dark:text-notion-dark-text
            `}
          >
            K:Answers bot
          </span>
        </div>
      </div>
      <nav className="p-4 h-full flex flex-col">
        <ul className="space-y-2">
          <li>
            <Link
              href="/"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 3.487a2.25 2.25 0 1 1 3.182 3.182L7.5 19.213l-4.5 1.318 1.318-4.5 12.544-12.544z" /></svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Draft PRD
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/prds"
              className={`flex items-center px-4 py-2 rounded-lg cursor-pointer hover-transition ${
                isActive('/prds')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="12" cy="6" rx="8" ry="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                PRDs
              </span>
              {!isActive('/prds') && prdCount > 0 && !collapsed && (
                <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-full bg-notion-light-accent dark:bg-notion-dark-accent text-white">
                  {prdCount}
                </span>
              )}
            </Link>
          </li>
          <li>
            <Link
              href="/setup"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/setup')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Tune K:Answers bot
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/ask"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/ask')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Ask a Question
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/sync"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/sync')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0 1 13.5-4.5m0 0V3.75m0 3.75h-3.75m9 4.5a7.5 7.5 0 0 1-13.5 4.5m0 0v3.75m0-3.75h3.75" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Sync Documents
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/brand-messaging"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/brand-messaging')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Brand Messaging
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/instructions"
              className={`flex items-center px-4 py-2 rounded-lg hover-transition ${
                isActive('/instructions')
                  ? 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-accent dark:text-notion-dark-accent'
                  : 'text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover'
              }`}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                How to Use It
              </span>
            </Link>
          </li>
          <li className="mt-4">
            <div className="flex items-center px-4 py-2 ">
              <ThemeToggle />
              <span
                className={`
                  transition-all duration-300 ease-in-out ml-3
                  ${collapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-[200px]'}
                  overflow-hidden whitespace-nowrap
                  text-notion-light-lightText dark:text-notion-dark-lightText
                `}
              >
                Toggle theme
              </span>
            </div>
          </li>
          <li className="mt-auto">
            <Link
              href="/"
              onClick={() => signOut({ callbackUrl: '/' })}
              className={`flex items-center px-4 py-2 rounded-lg hover-transition
                text-notion-light-text dark:text-notion-dark-text hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover
              `}
            >
              <svg className="w-5 h-5 mr-2 min-w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 15.75L21 12m0 0l-3.75-3.75M21 12H9m6.75 6.75v-13.5A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25z" /></svg>
              <span
                className={`
                  transition-all duration-300 ease-in-out
                  ${collapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-[200px] ml-2'}
                  overflow-hidden whitespace-nowrap
                `}
              >
                Sign Out
              </span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
} 