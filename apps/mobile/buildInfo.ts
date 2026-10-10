// Which build this is (docs/VERSIONING.md), for Settings to show: the
// app's config carries it (app.config.js), since a phone's bundler has no
// `__TABLE_BUILD__` to define.
import Constants from "expo-constants";
import { buildLabel, type BuildInfo } from "@workspace.sh/table-app";

const build = (Constants.expoConfig?.extra as { build?: BuildInfo } | undefined)?.build ?? null;

/** This build as one line: `2026.10.10.3 · a7ebcce`, or "unnumbered build". */
export const BUILD_LABEL = buildLabel(build);
