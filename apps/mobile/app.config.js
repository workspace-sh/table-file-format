// The app's config is app.json, with which build this is added
// (docs/VERSIONING.md): the commit's date and its place in that day, from
// scripts/build-version.mjs. It becomes the version and build number the
// stores read, and `extra.build`, which Settings shows (buildInfo.ts).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function buildInfo() {
  try {
    const script = path.join(__dirname, "..", "..", "scripts", "build-version.mjs");
    return JSON.parse(execFileSync(process.execPath, [script, "--json"], { cwd: __dirname, encoding: "utf8" }));
  } catch {
    return null;
  }
}

module.exports = ({ config }) => {
  const build = buildInfo();
  // Not a git checkout: app.json's own version stands, and the app says "unnumbered build".
  if (!build || build.commit === "unknown") return config;
  const [year, month, day, nth] = build.version.replace("+dev", "").split(".");
  const two = (n) => n.padStart(2, "0");
  return {
    ...config,
    // Apple: a version of three numbers, and the build number beside it.
    version: `${year}.${month}.${day}`,
    ios: { ...config.ios, buildNumber: nth },
    // Android: one whole number that only rises.
    android: { ...config.android, versionCode: Number(`${year}${two(month)}${two(day)}${two(nth)}`) },
    extra: { ...config.extra, build },
  };
};
