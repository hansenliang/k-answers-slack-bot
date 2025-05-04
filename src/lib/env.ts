// Environment variables with TypeScript for better type safety and validation

// Slack API credentials
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// OpenAI API credentials
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Pinecone credentials
export const PINECONE_API_KEY = process.env.PINECONE_API_KEY || '';

// Check if essential environment variables are set
export function validateSlackEnvironment(): { valid: boolean; missing: string[] } {
  const missingVars = [];
  
  if (!SLACK_BOT_TOKEN) missingVars.push('SLACK_BOT_TOKEN');
  if (!SLACK_SIGNING_SECRET) missingVars.push('SLACK_SIGNING_SECRET');
  
  return { 
    valid: missingVars.length === 0,
    missing: missingVars
  };
}

// Check if RAG environment variables are set
export function validateRagEnvironment(): { valid: boolean; missing: string[] } {
  const missingVars = [];
  
  if (!OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');
  if (!PINECONE_API_KEY) missingVars.push('PINECONE_API_KEY');
  
  return { 
    valid: missingVars.length === 0,
    missing: missingVars
  };
}

// Verify all environment variables are set
export function validateAllEnvironment(): { valid: boolean; missing: string[] } {
  const slackValidation = validateSlackEnvironment();
  const ragValidation = validateRagEnvironment();
  
  return {
    valid: slackValidation.valid && ragValidation.valid,
    missing: [...slackValidation.missing, ...ragValidation.missing]
  };
}

// Log environment variable status at startup
export function logEnvironmentStatus(): void {
  const validation = validateAllEnvironment();
  
  if (validation.valid) {
    console.log('[ENV] All required environment variables are set');
  } else {
    console.error(`[ENV] Missing required environment variables: ${validation.missing.join(', ')}`);
  }
  
  // Log status of individual components
  const slackValidation = validateSlackEnvironment();
  const ragValidation = validateRagEnvironment();
  
  console.log(`[ENV] Slack configuration: ${slackValidation.valid ? 'Valid' : 'Invalid'}`);
  console.log(`[ENV] RAG configuration: ${ragValidation.valid ? 'Valid' : 'Invalid'}`);
} 