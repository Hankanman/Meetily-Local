/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath: "",
  assetPrefix: "/",
  // Turbopack is the default in Next 16. With BlockNote out of the dep
  // tree, our build no longer needs the webpack-side ESM/node-protocol
  // workarounds — TipTap is pure ESM and Turbopack handles it natively.
  turbopack: {
    // Pin the workspace root so stray lockfiles elsewhere on the
    // machine (e.g. ~/package-lock.json) don't get picked as the root.
    root: import.meta.dirname,
  },
};

export default nextConfig;
