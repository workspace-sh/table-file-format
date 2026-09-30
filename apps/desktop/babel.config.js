const dev = process.env.NODE_ENV !== "production";

module.exports = {
  presets: [
    "module:@react-native/babel-preset",
    [
      "react-strict-dom/babel-preset",
      {
        debug: dev,
        dev,
        rootDir: __dirname,
        platform: "native",
      },
    ],
  ],
  // FormatJS's Intl polyfills (intl.ts) use static class blocks, which
  // the React Native preset doesn't transform.
  plugins: ["@babel/plugin-transform-class-static-block"],
};
