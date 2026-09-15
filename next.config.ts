import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  output: isGitHubPages ? 'export' : undefined,
  basePath: isGitHubPages ? '/nardubu-squish' : '',
  assetPrefix: isGitHubPages ? '/nardubu-squish/' : undefined,
};

export default nextConfig;
