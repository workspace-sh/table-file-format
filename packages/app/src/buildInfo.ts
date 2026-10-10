// Which build of an app this is (docs/VERSIONING.md), for showing where a
// person testing it can see it. Each app's bundler puts it in as
// `__TABLE_BUILD__` (scripts/build-version.mjs); an app whose bundler can't
// passes its own to `buildLabel`.

export interface BuildInfo {
  /** `2026.10.10.3`: the commit's date and which commit of that day; `+dev` after it when built from uncommitted changes. */
  version: string;
  /** The commit it was built from, short. */
  commit: string;
  /** The commit's date, `2026-10-10`. */
  date: string;
  dirty: boolean;
}

declare const __TABLE_BUILD__: BuildInfo | undefined;

/** This bundle's build, or null when its bundler didn't say. */
export function currentBuild(): BuildInfo | null {
  return typeof __TABLE_BUILD__ === "undefined" ? null : (__TABLE_BUILD__ ?? null);
}

/** A build as one line: `2026.10.10.3 · a7ebcce`. */
export function buildLabel(build: BuildInfo | null = currentBuild()): string {
  return build ? `${build.version} · ${build.commit}` : "unnumbered build";
}
