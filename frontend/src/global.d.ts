// Module declarations for non-code imports.
//
// TypeScript 6 tightened type checking for side-effect imports — without
// these, `import './foo.css'` (and similar bare imports of style/asset files)
// fails with TS2882 even though the bundler handles them just fine.

declare module '*.css';
declare module '*.scss';
declare module '*.module.css';
declare module '*.module.scss';
