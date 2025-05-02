"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle2, Loader2 } from "lucide-react"

// Types
export interface Document {
  id: string
  name: string
  synced: boolean
}

export interface ProgressNotificationProps {
  isLoading: boolean
  documents: Document[]
  onComplete?: () => void
  onDismiss?: () => void
  position?: "top-right" | "top-center" | "top-left" | "bottom-right" | "bottom-center" | "bottom-left"
}

export function ProgressNotification({
  isLoading,
  documents,
  onComplete,
  onDismiss,
  position = "top-right",
}: ProgressNotificationProps) {
  const [visible, setVisible] = useState(false)
  const [recentlySynced, setRecentlySynced] = useState<string[]>([])
  const historyRef = useRef<HTMLDivElement>(null)
  const dismissTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Calculate completion percentage
  const totalDocs = documents.length
  const syncedDocs = documents.filter((doc) => doc.synced).length
  const completionPercentage = totalDocs > 0 ? Math.round((syncedDocs / totalDocs) * 100) : 0
  const isComplete = completionPercentage === 100

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
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            exit: { duration: 0.3, ease: "easeOut" },
          }}
          className={`fixed z-50 ${positionClasses[position]}`}
        >
          <motion.div
            className="backdrop-blur-md bg-notion-light-card dark:bg-notion-dark-card border border-notion-light-border dark:border-notion-dark-border shadow-lg rounded-md overflow-hidden"
            style={{
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
            }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ exit: { duration: 0.3 } }}
          >
            <div className="px-5 py-4">
              {/* Header with progress and dismiss button */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 pr-2">
                  <div className="relative">
                    <svg className="w-10 h-10">
                      <circle 
                        cx="20" 
                        cy="20" 
                        r="18" 
                        fill="none" 
                        className="stroke-notion-light-border dark:stroke-notion-dark-border" 
                        strokeWidth="2" 
                      />
                      <motion.circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        className={isComplete ? "stroke-notion-light-accent dark:stroke-notion-dark-accent" : "stroke-notion-light-accent dark:stroke-notion-dark-accent opacity-80"}
                        strokeWidth="2"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 * (1 - completionPercentage / 100)}
                        strokeLinecap="round"
                        initial={{ strokeDashoffset: 2 * Math.PI * 18 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 18 * (1 - completionPercentage / 100) }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        transform="rotate(-90 20 20)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-medium text-notion-light-accent dark:text-notion-dark-accent">
                        {completionPercentage}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium text-notion-light-text dark:text-notion-dark-text">Syncing Documents</h3>
                    <p className="text-xs text-notion-light-lightText dark:text-notion-dark-lightText">
                      {syncedDocs} of {totalDocs} documents synced
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDismiss}
                  className="ml-2 text-notion-light-lightText dark:text-notion-dark-lightText hover:text-notion-light-accent dark:hover:text-notion-dark-accent transition-colors"
                  aria-label="Dismiss notification"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Document history list */}
              <div
                ref={historyRef}
                className="max-h-[180px] overflow-y-auto pr-1 space-y-2"
              >
                {documents.map((doc) => (
                  <DocumentItem key={doc.id} document={doc} isNew={doc.synced && recentlySynced.includes(doc.id)} />
                ))}
              </div>
            </div>

            {/* Progress bar at bottom */}
            <motion.div
              className="h-0.5 bg-notion-light-accent dark:bg-notion-dark-accent"
              initial={{ width: "0%" }}
              animate={{ width: `${completionPercentage}%` }}
              transition={{ duration: 0.3 }}
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
  // Improved error detection to catch more error cases and patterns
  const hasError = !document.synced && (
    document.name.toLowerCase().includes('failed') || 
    document.name.toLowerCase().includes('error') || 
    document.name.toLowerCase().includes('permission') ||
    document.name.toLowerCase().includes('not found') ||
    document.name.toLowerCase().includes('invalid') ||
    document.name.toLowerCase().includes('403') ||
    document.name.toLowerCase().includes('401') ||
    document.name.toLowerCase().includes('500') ||
    document.name.toLowerCase().includes('404')
  );

  // Split the document name to show original name and error separately if there's an error pattern
  let displayName = document.name;
  let errorMessage = '';
  
  if (hasError && document.name.includes(' - ')) {
    const parts = document.name.split(' - ');
    if (parts.length >= 2) {
      displayName = parts[0];
      errorMessage = parts.slice(1).join(' - ');
    }
  }

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, y: -10 } : { opacity: 1 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 20 }}
      className="flex items-center gap-2 rounded-md p-2 hover:bg-notion-light-hover dark:hover:bg-notion-dark-hover hover-transition"
    >
      <div className="flex-shrink-0">
        {document.synced ? (
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-notion-light-selection dark:bg-notion-dark-selection"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-notion-light-accent dark:text-notion-dark-accent" />
          </motion.div>
        ) : hasError ? (
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 0.3 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-notion-light-hover dark:bg-notion-dark-hover"
          >
            <svg 
              className="h-3.5 w-3.5 text-notion-light-error dark:text-notion-dark-error" 
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
            className="flex h-6 w-6 items-center justify-center rounded-full bg-notion-light-hover dark:bg-notion-dark-hover"
          >
            <Loader2 className="h-3.5 w-3.5 text-notion-light-lightText dark:text-notion-dark-lightText" />
          </motion.div>
        )}
      </div>

      <div className="flex-1 truncate">
        <p className={`text-sm truncate ${
          hasError 
            ? "text-notion-light-error dark:text-notion-dark-error" 
            : "text-notion-light-text dark:text-notion-dark-text"
        }`}>
          {hasError && errorMessage ? (
            <>
              <span className="font-medium">{displayName}</span>
              <span className="opacity-80"> - {errorMessage}</span>
            </>
          ) : (
            document.name
          )}
        </p>
      </div>
    </motion.div>
  )
}
