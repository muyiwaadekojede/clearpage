import crypto from 'crypto';

import type { ImageMode } from './types';

export type ExtractSnapshot = {
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  sourceUrl: string;
  textContent: string;
  contentVariants: Record<ImageMode, string>;
};

type CacheEntry = {
  expiresAt: number;
  snapshot: ExtractSnapshot;
};

declare global {
  // eslint-disable-next-line no-var
  var __clearpageExtractCache: Map<string, CacheEntry> | undefined;
}

const CACHE_TTL_MS = 1000 * 60 * 30;
const CACHE_MAX_ENTRIES = 400;

function getCache(): Map<string, CacheEntry> {
  if (!global.__clearpageExtractCache) {
    global.__clearpageExtractCache = new Map<string, CacheEntry>();
  }

  return global.__clearpageExtractCache;
}

function pruneCache(cache: Map<string, CacheEntry>): void {
  const now = Date.now();

  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) {
      cache.delete(key);
    }
  }

  if (cache.size <= CACHE_MAX_ENTRIES) {
    return;
  }

  const sortedByExpiry = Array.from(cache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const removeCount = cache.size - CACHE_MAX_ENTRIES;
  for (let index = 0; index < removeCount; index += 1) {
    cache.delete(sortedByExpiry[index][0]);
  }
}

export function storeExtractSnapshot(snapshot: ExtractSnapshot): string {
  const cache = getCache();
  pruneCache(cache);

  const extractionId = crypto.randomUUID();
  cache.set(extractionId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot,
  });

  return extractionId;
}

export function getExtractSnapshot(extractionId: string | null | undefined): ExtractSnapshot | null {
  if (!extractionId) return null;

  const cache = getCache();
  const entry = cache.get(extractionId);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(extractionId);
    return null;
  }

  return entry.snapshot;
}
