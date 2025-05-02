"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle2, Loader2 } from "lucide-react"

// Types
export interface Document {
  id: string
  name: string
  synced: boolean
  error?: string
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
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{
            type: "spring",
            damping: 30,
            stiffness: 350,
            exit: { duration: 0.3, ease: "easeOut" },
          }}
          className={`fixed z-50 ${positionClasses[position]} pointer-events-auto`}
        >
          <motion.div
            className="backdrop-blur-md bg-zinc-900 border border-zinc-800 shadow-lg rounded-lg overflow-hidden dark"
            style={{
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35)",
              width: "min(440px, 90vw)",
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
                <button
                  onClick={handleDismiss}
                  className="ml-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label="Dismiss notification"
                >
                  <svg
                    className="w-5 h-5"
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
                className="max-h-[180px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
              >
                {documents.map((doc) => (
                  <DocumentItem key={doc.id} document={doc} isNew={doc.synced && recentlySynced.includes(doc.id)} />
                ))}
              </div>
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
      className="flex items-center gap-2 rounded-md p-2 hover:bg-zinc-800/50 hover-transition"
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
        <p className={`text-sm truncate ${
          hasError 
            ? "text-red-400" 
            : "text-white"
        }`}>
          {document.name}
        </p>
        {document.error && (
          <p className="text-xs text-red-400 mt-0.5">
            {document.error}
          </p>
        )}
      </div>
    </motion.div>
  )
}
