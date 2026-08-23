/**
 * Explicit, empty PostCSS config.
 *
 * Without a config here, PostCSS walks up the filesystem looking for one — past the repository, past the
 * directory holding it, all the way to the drive root. On a machine that happens to have a stray
 * `postcss.config.mjs` above the checkout, that unrelated config gets applied to this project and the
 * renderer build fails on `src/renderer/styles.css`. CI never sees it, because a fresh runner has nothing
 * above the workspace, which makes it look like a local-only problem when it is really a missing file here.
 *
 * Empty is correct: Tailwind is wired through the `@tailwindcss/vite` plugin (see packages/enterprise), not
 * through PostCSS, and nothing in this repo declares PostCSS plugins. If a package ever does need one, give
 * that package its own config rather than adding it here.
 *
 * @type {import('postcss-load-config').Config}
 */
export default { plugins: {} }
