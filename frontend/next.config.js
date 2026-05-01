/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disabled for BlockNote compatibility
  output: 'export',
  images: {
    unoptimized: true,
  },
  basePath: '',
  assetPrefix: '/',

  // BlockNote 0.49+ ships CJS dist files that `require()` packages whose
  // package.json `exports` field declares only an `import` (ESM) entry.
  // Both webpack and Turbopack need help resolving these.
  transpilePackages: [
    "@blocknote/core",
    "@blocknote/react",
    "@blocknote/shadcn",
    "@handlewithcare/prosemirror-inputrules",
  ],

  // We're locked to webpack until BlockNote ships ESM-only dist files.
  // BlockNote 0.49 has a CJS bundle that `require()`s packages whose
  // package.json `exports` field declares only `import` (e.g.
  // @handlewithcare/prosemirror-inputrules). Webpack's `conditionNames`
  // option loosely accepts the `import` entry from a CJS caller; Turbopack's
  // resolver is stricter and refuses, with no clean workaround that doesn't
  // require pnpm-patching the upstream package's exports field.
  // Build scripts pin `--webpack`. Revisit when BlockNote drops the CJS bundle.
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
      // Strip the `node:` prefix so the fallback above matches bare names.
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
    }
    // Force webpack to honour the `import` exports condition even from CJS callers.
    config.resolve.conditionNames = ["import", "require", "node", "default"];
    return config;
  },
};

module.exports = nextConfig;
