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
  // Add webpack configuration to handle Node.js built-in modules
  webpack: (config, { isServer }) => {
    // If we're building for the server
    if (isServer) {
      // Externalize packages that use Node.js built-in modules
      config.externals.push({
        '@pinecone-database/pinecone': 'commonjs @pinecone-database/pinecone',
        '@slack/web-api': 'commonjs @slack/web-api',
      });
    }
    
    return config;
  },
};

module.exports = nextConfig; 