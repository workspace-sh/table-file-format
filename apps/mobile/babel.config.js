module.exports = function (api) {
  api.cache(true);
  const dev = process.env.NODE_ENV !== "production";
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "react" }],
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
    // FormatJS's Intl polyfills (intl.ts) use static class blocks.
    plugins: ["@babel/plugin-transform-class-static-block"],
  };
};
