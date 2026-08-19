/**
 * Present only to stop Next walking up the directory tree and adopting
 * ~/postcss.config.js, a stray Tailwind config belonging to another project.
 * This app uses plain CSS and needs no PostCSS plugins.
 */
const config = {
  plugins: {},
};

export default config;
