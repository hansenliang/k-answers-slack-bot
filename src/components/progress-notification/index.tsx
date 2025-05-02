"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle2, Loader2, Clock, Terminal } from "lucide-react"

// Types
export interface Document {
  id: string
  name: string
  synced: boolean
  error?: string
  currentStep?: string
  steps?: Array<{step: string, timestamp: Date}>
}

export interface ActivityLogEntry {
  message: string
  timestamp: Date
  type: 'info' | 'debug' | 'error' | 'success'
}

export interface ProgressNotificationProps {
  isLoading: boolean
  documents: Document[]
  onComplete?: () => void
  onDismiss?: () => void
  position?: "top-right" | "top-center" | "top-left" | "bottom-right" | "bottom-center" | "bottom-left"
  currentStep?: string
  currentDocumentName?: string
  elapsedTimeMs?: number
  activityLog?: ActivityLogEntry[]
}

export function ProgressNotification({
  isLoading,
  documents,
  onComplete,
  onDismiss,
  position = "top-right",
  currentStep,
  currentDocumentName,
  elapsedTimeMs = 0,
  activityLog = [],
}: ProgressNotificationProps) {
  const [visible, setVisible] = useState(false)
  const [recentlySynced, setRecentlySynced] = useState<string[]>([])
  const historyRef = useRef<HTMLDivElement>(null)
  const dismissTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [internalElapsed, setInternalElapsed] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [showActivityLog, setShowActivityLog] = useState(false)
  const timerStartRef = useRef<number | null>(null)
  const visibleRef = useRef<boolean>(true) // Track page visibility
  
  // Calculate completion percentage
  const totalDocs = documents.length
  const syncedDocs = documents.filter((doc) => doc.synced).length
  const completionPercentage = totalDocs > 0 ? Math.round((syncedDocs / totalDocs) * 100) : 0
  const isComplete = completionPercentage === 100
  
  // Debug logs to track state
  useEffect(() => {
    console.log("Elapsed time from props:", elapsedTimeMs);
    console.log("Activity log length:", activityLog.length);
    if (currentStep) console.log("Current step:", currentStep);
  }, [elapsedTimeMs, activityLog, currentStep]);
  
  // Set up visibility change listener
  useEffect(() => {
    // Function to handle visibility change
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      console.log("Page visibility changed to:", isVisible ? "visible" : "hidden");
      visibleRef.current = isVisible;
      
      // If becoming visible and timer should be running, ensure it's running
      if (isVisible && isLoading && !isComplete && !timerRef.current) {
        console.log("Page became visible - restarting timer");
        startTimer();
      }
    };
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Clean up
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoading, isComplete]);
  
  // Function to start the timer
  const startTimer = useCallback(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Set start time if not already set
    if (!timerStartRef.current) {
      timerStartRef.current = Date.now() - (elapsedTimeMs || 0);
      console.log("Setting timer start reference to:", timerStartRef.current);
    }
    
    // Start a new timer that updates every second
    timerRef.current = setInterval(() => {
      if (timerStartRef.current && visibleRef.current) {
        const elapsed = Date.now() - timerStartRef.current;
        console.log("Timer tick - updating elapsed time to:", elapsed);
        setInternalElapsed(elapsed);
      }
    }, 1000);
    
    return timerRef.current;
  }, [elapsedTimeMs]);
  
  // Start internal timer when loading begins
  useEffect(() => {
    if (isLoading && !isComplete) {
      console.log("Starting timer");
      startTimer();
    } else if (isComplete && timerRef.current) {
      // Stop timer when complete
      console.log("Stopping timer due to completion");
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Cleanup timer on unmount
    return () => {
      if (timerRef.current) {
        console.log("Cleaning up timer on unmount/deps change");
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, isComplete, startTimer]);

  // Format elapsed time in a human-readable way
  const formatElapsedTime = (ms: number) => {
    if (ms < 1000) return "0s";
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    
    return `${seconds}s`;
  };

  // Position classes
  const positionClasses = {
    "top-right": "top-4 right-4",
    "top-center": "top-4 left-1/2 -translate-x-1/2",
    "top-left": "top-4 left-4",
    "bottom-right": "bottom-4 right-4",
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
    "bottom-left": "bottom-4 left-4",
  }

  // Show notification when loading starts
  useEffect(() => {
    if (isLoading) {
      setVisible(true)

      // Clear any existing timeout when loading starts again
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
        dismissTimeoutRef.current = null
      }
    }
  }, [isLoading])

  // Handle completion and auto-dismiss
  useEffect(() => {
    if (isComplete && visible) {
      if (!dismissTimeoutRef.current) {
        dismissTimeoutRef.current = setTimeout(() => {
          setVisible(false)
          onComplete?.()
        }, 5000)
      }
    } else {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
        dismissTimeoutRef.current = null
      }
    }
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
        dismissTimeoutRef.current = null
      }
    }
  }, [isComplete, visible, onComplete])

  // Track newly synced documents
  useEffect(() => {
    if (!isLoading) return

    // Check for newly synced documents
    const newlySynced = documents.filter((doc) => doc.synced && !recentlySynced.includes(doc.id)).map((doc) => doc.id)

    if (newlySynced.length > 0) {
      // Add to recently synced list
      setRecentlySynced((prev) => [...prev, ...newlySynced])

      // Scroll to the bottom of the history list
      setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight
        }
      }, 100)
    }
  }, [documents, isLoading, recentlySynced])

  // If not visible or no documents, don't show anything
  if (!visible || documents.length === 0) {
    return null
  }

  const handleDismiss = () => {
    setVisible(false)
    onDismiss?.()
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{
            type: "spring",
            damping: 30,
            stiffness: 350,
            exit: { duration: 0.3, ease: "easeOut" },
          }}
          className={`fixed z-50 ${positionClasses[position]}`}
          style={{ 
            width: "100%", 
            maxWidth: "450px",
            left: position === "top-center" ? "50%" : undefined,
            transform: position === "top-center" ? "translateX(-50%)" : undefined,
          }}
        >
          <motion.div
            className="backdrop-blur-md bg-zinc-900 border border-zinc-800 shadow-lg rounded-lg overflow-hidden dark"
            style={{
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35)",
              width: "100%"
            }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ exit: { duration: 0.3 } }}
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
          >
            <div className="px-5 py-4">
              {/* Header with progress and dismiss button */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 pr-2">
                  <motion.div 
                    className="relative"
                    animate={isComplete ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ duration: 0.5 }}
                  >
                    <svg className="w-10 h-10">
                      <circle 
                        cx="20" 
                        cy="20" 
                        r="18" 
                        fill="none" 
                        className="stroke-zinc-700" 
                        strokeWidth="2.5" 
                      />
                      <motion.circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        className={isComplete ? "stroke-green-400" : "stroke-blue-400"}
                        strokeWidth="2.5"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 * (1 - completionPercentage / 100)}
                        strokeLinecap="round"
                        initial={{ strokeDashoffset: 2 * Math.PI * 18 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 18 * (1 - completionPercentage / 100) }}
                        transition={{ duration: 0.8, ease: "easeInOut" }}
                        transform="rotate(-90 20 20)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.span 
                        className={`text-xs font-medium ${isComplete ? "text-green-400" : "text-blue-400"}`}
                        key={completionPercentage}
                        initial={{ scale: 0.8, opacity: 0.8 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        {completionPercentage}%
                      </motion.span>
                    </div>
                  </motion.div>
                  <div>
                    <h3 className="font-medium text-white">
                      {isComplete ? "Sync Complete" : "Syncing Documents"}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {isComplete 
                        ? "All documents have been processed"
                        : `${syncedDocs} of ${totalDocs} documents synced`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {/* Activity log toggle button */}
                  <button
                    onClick={() => {
                      console.log("Toggling activity log from header button");
                      setShowActivityLog(prev => !prev);
                    }}
                    className={`text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors p-1.5 rounded ${showActivityLog ? 'bg-zinc-700/50 text-zinc-200' : ''}`}
                    aria-label="Toggle activity log"
                  >
                    <Terminal className="w-4 h-4" />
                  </button>
                  
                  {/* Dismiss button */}
                  <button
                    onClick={handleDismiss}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors p-1.5 rounded"
                    aria-label="Dismiss notification"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Current status summary */}
              {!isComplete && currentStep && (
                <div className="mb-3 p-2 bg-zinc-800/50 rounded-md">
                  <div className="flex items-start space-x-2">
                    <div className="mt-0.5">
                      <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">
                        {currentDocumentName || 'Processing document'}
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {currentStep}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Elapsed time indicator */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center text-xs text-zinc-500">
                  <Clock className="h-3 w-3 mr-1" />
                  <span>Elapsed time: {formatElapsedTime(internalElapsed)}</span>
                </div>
                {activityLog.length > 0 && (
                  <div>
                    <button 
                      onClick={() => {
                        console.log("Toggle activity log from details button");
                        setShowActivityLog(prev => !prev);
                      }}
                      className={`text-xs flex items-center px-2 py-1 rounded transition-colors ${
                        showActivityLog 
                          ? 'bg-zinc-700 text-zinc-200' 
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                      }`}
                    >
                      <Terminal className="h-3 w-3 mr-1 text-blue-400" />
                      <span>{showActivityLog ? 'Hide details' : 'Show details'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Activity log */}
              <AnimatePresence>
                {showActivityLog && activityLog.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mb-3 overflow-hidden"
                  >
                    <div className="bg-zinc-800/60 rounded-md p-2 max-h-[120px] overflow-y-auto text-xs scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                      <ul className="space-y-1.5">
                        {activityLog.map((entry, idx) => (
                          <li 
                            key={idx}
                            className="leading-tight"
                          >
                            <span className={`${
                              entry.type === 'error' ? 'text-red-400' :
                              entry.type === 'success' ? 'text-green-400' :
                              entry.type === 'debug' ? 'text-purple-400' :
                              'text-blue-400'
                            } font-mono`}>
                              {entry.type === 'error' ? '✗' : 
                               entry.type === 'success' ? '✓' : 
                               entry.type === 'debug' ? '◆' : '•'} 
                            </span>
                            <span className="text-zinc-300 ml-1">
                              {entry.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Document history list */}
              <div
                ref={historyRef}
                className="max-h-[180px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
              >
                {documents.map((doc) => (
                  <DocumentItem key={doc.id} document={doc} isNew={doc.synced && recentlySynced.includes(doc.id)} />
                ))}
              </div>
            
              {/* Always visible current step indicator at the bottom */}
              {!isComplete && (
                <div className="py-2 px-4 mt-2 border-t border-zinc-800 bg-zinc-800/30">
                  <div className="flex items-center text-xs">
                    <div className="flex-shrink-0 mr-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                    </div>
                    <div className="truncate">
                      {currentStep ? (
                        <div className="text-zinc-300">
                          {currentDocumentName && (
                            <span className="font-medium text-zinc-200">{currentDocumentName}: </span>
                          )}
                          <span>{currentStep}</span>
                        </div>
                      ) : (
                        <div className="text-zinc-300">
                          {currentDocumentName ? (
                            <>
                              <span className="font-medium text-zinc-200">{currentDocumentName}: </span>
                              <span>
                                {activityLog.length > 0 
                                  ? extractOperationFromLog(activityLog[0]?.message) 
                                  : 'Processing...'}
                              </span>
                            </>
                          ) : (
                            <span>
                              {activityLog.length > 0 
                                ? extractOperationFromLog(activityLog[0]?.message) 
                                : 'Processing documents...'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar at bottom */}
            <motion.div
              className={`h-1 ${isComplete ? "bg-green-400" : "bg-blue-400"}`}
              initial={{ width: "0%" }}
              animate={{ width: `${completionPercentage}%` }}
              transition={{ duration: 0.5 }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface DocumentItemProps {
  document: Document
  isNew: boolean
}

function DocumentItem({ document, isNew }: DocumentItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasSteps = document.steps && document.steps.length > 0;
  
  const hasError = document.error || (!document.synced && (
    document.name.toLowerCase().includes('failed') || 
    document.name.toLowerCase().includes('error') || 
    document.name.toLowerCase().includes('permission') ||
    document.name.toLowerCase().includes('not found') ||
    document.name.toLowerCase().includes('invalid') ||
    document.name.toLowerCase().includes('403') ||
    document.name.toLowerCase().includes('401') ||
    document.name.toLowerCase().includes('500') ||
    document.name.toLowerCase().includes('404')
  ));

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, y: -10 } : { opacity: 1 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 20 }}
      className="rounded-md overflow-hidden"
    >
      <div 
        className={`flex items-center gap-2 p-2 ${expanded ? "bg-zinc-800/80" : "hover:bg-zinc-800/50"} 
        hover-transition rounded-md cursor-pointer`}
        onClick={() => hasSteps && setExpanded(prev => !prev)}
      >
        <div className="flex-shrink-0">
          {document.synced ? (
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/80"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            </motion.div>
          ) : hasError ? (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.3 }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/80"
            >
              <svg 
                className="h-3.5 w-3.5 text-red-400" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24" 
                xmlns="http://www.w3.org/2000/svg"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </motion.div>
          ) : (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/80"
            >
              <Loader2 className="h-3.5 w-3.5 text-blue-400" />
            </motion.div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className={`text-sm truncate ${
              hasError 
                ? "text-red-400" 
                : "text-white"
            }`}>
              {document.name}
            </p>
            {hasSteps && (
              <svg 
                className={`h-4 w-4 text-zinc-500 transform transition-transform ${expanded ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
          
          {!expanded && document.currentStep && !document.synced && !hasError && (
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {document.currentStep}
            </p>
          )}
          
          {document.error && !expanded && (
            <p className="text-xs text-red-400 mt-0.5">
              {document.error}
            </p>
          )}
        </div>
      </div>
      
      {/* Expanded view with steps */}
      {expanded && hasSteps && (
        <div className="bg-zinc-800/30 px-2 py-1.5 text-xs border-t border-zinc-800/50 rounded-b-md">
          <ul className="space-y-1 pl-7">
            {document.steps?.map((step, idx) => (
              <li key={idx} className="relative">
                <div className="absolute -left-5 top-1.5 w-2 h-2 bg-zinc-700 rounded-full"></div>
                <p className="text-zinc-300">{step.step}</p>
                <p className="text-zinc-500 text-[10px]">
                  {new Date(step.timestamp).toLocaleTimeString()}
                </p>
              </li>
            ))}
            {document.error && (
              <li className="relative">
                <div className="absolute -left-5 top-1.5 w-2 h-2 bg-red-500 rounded-full"></div>
                <p className="text-red-400">{document.error}</p>
              </li>
            )}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

// Helper function to extract the operation from a log message
function extractOperationFromLog(message?: string): string {
  if (!message) return 'Processing...';
  
  // Common operations to extract
  const operations = [
    'Fetching document',
    'Downloading',
    'Parsing',
    'Extracting',
    'Processing',
    'Converting',
    'Indexing',
    'Analyzing',
    'Validating',
    'Storing'
  ];
  
  // Check if the message contains any of the operations
  for (const op of operations) {
    if (message.includes(op)) {
      return `${op}...`;
    }
  }
  
  // Default fallback
  return 'Processing documents...';
}
