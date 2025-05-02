'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import SyncForm from '@/components/SyncForm';

interface ManageContextModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ManageContextModal({ isOpen, onClose }: ManageContextModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-lg bg-gray-800 text-white border border-gray-700 p-0">
        <DialogHeader className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">Manage Context</DialogTitle>
            <DialogClose className="rounded-full p-1.5 hover:bg-gray-700" onClick={onClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="p-6 pt-2">
          <p className="mb-4 text-sm text-gray-400">
            Sync documents to provide context for your questions. The AI will use these 
            documents to generate answers.
          </p>
          <SyncForm />
        </div>
      </DialogContent>
    </Dialog>
  );
} 