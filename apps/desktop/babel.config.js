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
};
