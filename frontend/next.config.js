/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disabled for BlockNote compatibility
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Add basePath configuration
  basePath: '',
  assetPrefix: '/',

  // BlockNote 0.49 ships ESM-only deps (e.g. @handlewithcare/prosemirror-inputrules)
  // whose `exports` field requires a real bundler step to resolve. Without this,
  // webpack chokes on `Module not found: Package path . is not exported`.
  transpilePackages: [
    "@blocknote/core",
    "@blocknote/react",
    "@blocknote/shadcn",
    "@handlewithcare/prosemirror-inputrules",
  ],

  // Add webpack configuration for Tauri
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // BlockNote 0.49+ pulls in unified/vfile/lib0 which conditionally
      // import node: scheme builtins. We're building for the Tauri webview
      // (browser context) so these can be stubbed.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        url: false,
        process: false,
      };
      // Strip the `node:` prefix from imports so webpack's fallback
      // mechanism can match the bare module names above.
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
    }
    // BlockNote 0.49+ depends on packages that only ship `import` in their
    // `exports` field. Force webpack to consider the ESM entry even when
    // resolving from a CJS context.
    config.resolve.conditionNames = ["import", "require", "node", "default"];
    return config;
  },
}

module.exports = nextConfig
