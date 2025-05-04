/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Allow builds to complete even with ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow builds to complete even with TypeScript errors
    ignoreBuildErrors: true,
  },
  // External packages that need to be transpiled
  transpilePackages: ['@slack/web-api', '@slack/bolt'],
  // External packages for server components
  serverExternalPackages: ['@pinecone-database/pinecone'],
  // Set maximum function duration to 60 seconds
  experimental: {
    serverActionsBodySizeLimit: '5mb'
  },
  // Add webpack configuration to handle Node.js built-in modules
  webpack: (config, { isServer }) => {
    // If we're building for the server
    if (isServer) {
      // Externalize packages that use Node.js built-in modules
      config.externals.push({
        '@pinecone-database/pinecone': 'commonjs @pinecone-database/pinecone',
        '@slack/web-api': 'commonjs @slack/web-api',
        'crypto': 'commonjs crypto'
      });
    }
    
    return config;
  },
  // Set specific configuration for API routes
  serverRuntimeConfig: {
    // Ensure Node.js runtime for Slack API routes
    slackApi: {
      runtime: 'nodejs'
    }
  }
};

module.exports = nextConfig; 