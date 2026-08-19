import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";
const basePath = githubPages ? "/texture-experiments" : "";

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath,
  trailingSlash: githubPages,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
