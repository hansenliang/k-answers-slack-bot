import OpenAI from 'openai';

/**
 * Splits a given text into chunks of 1 to many paragraphs.
*
* @param text - The input text to be chunked.
* @param maxChunkSize - The maximum size (in characters) allowed for each chunk. Default is 1000.
* @param minChunkSize - The minimum size (in characters) required for each chunk. Default is 100.
* @returns An array of chunked text, where each chunk contains 1 or multiple "paragraphs"
*/
export function chunkTextByMultiParagraphs(
    text: string,
    maxChunkSize = 2000,
    minChunkSize = 1500
    ): string[] {
    const chunks: string[] = [];
    let currentChunk = "";
    
    let startIndex = 0;
    while (startIndex < text.length) {
        let endIndex = startIndex + maxChunkSize;
        if (endIndex >= text.length) {
        endIndex = text.length;
        } else {
        // Just using this to find the nearest paragraph boundary
        const paragraphBoundary = text.indexOf("\n\n", endIndex);
        if (paragraphBoundary !== -1) {
            endIndex = paragraphBoundary;
        }
        }
    
        const chunk = text.slice(startIndex, endIndex).trim();
        if (chunk.length >= minChunkSize) {
        chunks.push(chunk);
        currentChunk = "";
        } else {
        currentChunk += chunk + "\n\n";
        }
    
        startIndex = endIndex + 1;
    }
    
    if (currentChunk.length >= minChunkSize) {
        chunks.push(currentChunk.trim());
    } else if (chunks.length > 0) {
        chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
    } else {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
    }
    
    export async function enhanceChunks(chunks: string[]) {
        const enhancedChunks: string[] = [];
        for (const chunk of chunks) {
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
                organization: process.env.OPENAI_ORGANIZATION,
            });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: "You are a helpful assistant that is providing context for a Q&A AI agent. You are given a chunk of text from a knowledge base. Your job is to clean the formatting of the chunk to be human readable, and also return a summary of the text in a few sentences. When you see a question, think of how it might be phrased in multiple ways. Provide the summary of the text in a few sentences, including alternative ways to phrase each question or title. Please be concise and to the point. Here is the chunk: " + chunk,
                    },
                ],
            });  
            if (completion.choices[0].message.content) {
                enhancedChunks.push(completion.choices[0].message.content);
            }
        }
        return enhancedChunks;
    }