// Development only: checks desktopFs against core's TableFs contract on the
// real disk, and round-trips a fixture bundle through core's writer and
// reader. Run from the dev hook (__tableDesktop.checkFs()); it resolves with
// one line per check.

import { Dirs } from "react-native-file-access";
import { joinPath, readBundle, writeBundleTo } from "@workspace.sh/table-core/io";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import { desktopFs as fs } from "./desktopFs";

export async function checkFs(): Promise<string[]> {
  const root = joinPath(Dirs.CacheDir, "table-fs-check");
  const results: string[] = [];
  const check = async (name: string, run: () => Promise<boolean | string>) => {
    try {
      const outcome = await run();
      results.push(`${outcome === true ? "ok  " : "FAIL"} ${name}${typeof outcome === "string" ? `: ${outcome}` : ""}`);
    } catch (error) {
      results.push(`FAIL ${name}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await fs.remove(root);
  await check("remove of a missing path doesn't throw", async () => {
    await fs.remove(joinPath(root, "never-there"));
    return true;
  });
  await check("a missing file reads as null", async () => (await fs.readText(joinPath(root, "missing.txt"))) === null);
  await check("a missing directory lists as null", async () => (await fs.list(joinPath(root, "missing"))) === null);
  await check("mkdir makes parents, and again is fine", async () => {
    await fs.mkdir(joinPath(root, "a/b/c"));
    await fs.mkdir(joinPath(root, "a/b/c"));
    return (await fs.list(joinPath(root, "a/b"))) !== null;
  });
  const text = "héllo · ☃ · 日本語\nsecond line";
  await check("UTF-8 text round-trips", async () => {
    await fs.writeText(joinPath(root, "a/t.txt"), text);
    return (await fs.readText(joinPath(root, "a/t.txt"))) === text;
  });
  await check("list gives names and which are directories", async () => {
    const entries = (await fs.list(joinPath(root, "a"))) ?? [];
    const got = entries.map((e) => `${e.name}:${e.directory}`).sort().join(",");
    return got === "b:true,t.txt:false" || got;
  });
  await check("rename replaces an existing file", async () => {
    await fs.writeText(joinPath(root, "a/target"), "old");
    await fs.writeText(joinPath(root, "a/target.tmp"), "new");
    await fs.rename(joinPath(root, "a/target.tmp"), joinPath(root, "a/target"));
    const now = await fs.readText(joinPath(root, "a/target"));
    const staged = await fs.readText(joinPath(root, "a/target.tmp"));
    return (now === "new" && staged === null) || `target ${now}, staged ${staged}`;
  });
  await check("remove takes a directory and everything in it", async () => {
    await fs.remove(joinPath(root, "a"));
    return (await fs.list(joinPath(root, "a"))) === null;
  });

  // Every fixture bundle, written by core's writer and read back by its reader.
  for (const [name, bundle] of Object.entries(fixtureBundles)) {
    await check(`${name}.table round-trips through core`, async () => {
      const path = joinPath(root, `${name}.table`);
      await writeBundleTo(fs, path, bundle);
      const back = await readBundle(fs, path);
      const want = Object.entries(bundle.tables).map(([t, v]) => `${t}:${v.rows.length}`).sort().join(",");
      const got = Object.entries(back.tables).map(([t, v]) => `${t}:${v.rows.length}`).sort().join(",");
      const leftovers = ((await fs.list(joinPath(path, "tables"))) ?? []).filter((e) => e.name.endsWith(".tmp"));
      if (got !== want) return `wrote ${want}, read ${got}`;
      // Everything but `path`, which says where a table was read from, and
      // regardless of key order (bodies are a map, read in listing order).
      const same = (t: object) => canonical({ ...t, path: undefined });
      const changed = Object.keys(bundle.tables).filter((t) => same(bundle.tables[t]!) !== same(back.tables[t] ?? {}));
      if (changed.length > 0) {
        const t = changed[0]!;
        return `tables differ after the round trip: ${changed.join(", ")}; first at ${firstDifference(
          { ...bundle.tables[t]!, path: undefined },
          { ...back.tables[t], path: undefined },
        )}`;
      }
      if (leftovers.length > 0) return `staged files left: ${leftovers.map((e) => e.name).join(", ")}`;
      return (back.diagnostics ?? []).length === 0 || `diagnostics: ${back.diagnostics!.map((d) => d.message).join("; ")}`;
    });
  }
  await fs.remove(root);
  return results;
}

/** Where two JSON values first differ, as a dotted path with both sides. */
function firstDifference(a: unknown, b: unknown, at = ""): string {
  if (JSON.stringify(a) === JSON.stringify(b)) return "";
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return `${at || "."}: ${JSON.stringify(a)?.slice(0, 120)} became ${JSON.stringify(b)?.slice(0, 120)}`;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`);
    if (found) return found;
  }
  return `${at}: key order`;
}

/** JSON with every object's keys sorted, so key order doesn't count. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
