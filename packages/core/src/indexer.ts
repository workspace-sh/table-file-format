import type { Row } from "./types";

const NOT_IMPLEMENTED = "indexer not yet implemented";

export async function buildIndex(_dirPath: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function queryIndex(_dirPath: string, _sql: string): Promise<Row[]> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function isIndexStale(_dirPath: string): Promise<boolean> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function dropIndex(_dirPath: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}
