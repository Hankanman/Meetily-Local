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
};

export default nextConfig;
