import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAuthServerSession } from '@/lib/auth';
import { chunkTextByMultiParagraphs } from '@/app/chunk';
import { buildPineconeRecords } from '@/app/embed';
import { getUserIndex } from '@/lib/pinecone';
import { getSharedIndex } from '@/lib/shared-pinecone';
import { addLogEntry } from '../sync-status/route';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { updateDocumentStatus } from '../sync-status/route';
import OpenAI from 'openai';
import { PineconeRecord } from '@pinecone-database/pinecone';
import { upsertDocumentToIndex } from '@/lib/pinecone';
import { extractTextFromGoogleDoc } from '@/lib/google-docs';
import { getGoogleDrive, getDocument } from '@/lib/google-drive';
import { addLogEntry, markDocumentInProgress, syncStatus } from '@/lib/sync-status';
