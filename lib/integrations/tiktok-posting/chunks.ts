import { IntegrationError } from "@/lib/domain/contracts";

import { TIKTOK_POSTING_PROVIDER } from "./config";

/*
 * FILE_UPLOAD chunk plan, per TikTok's Media Transfer Guide:
 * - chunks are 5 MB..64 MB; the last one may be up to 128 MB (it absorbs
 *   the trailing bytes); total_chunk_count = floor(video_size / chunk_size);
 * - a file under 5 MB goes in one chunk with chunk_size = video_size;
 * - 1..1000 chunks, uploaded sequentially with
 *   Content-Range: bytes {first}-{last}/{total}; 206 = continue, 201 = done.
 *
 * We use 10 MB chunks so a streamed chunk stays small in function memory.
 */

export const MB = 1024 * 1024;
export const MIN_CHUNK = 5 * MB;
export const MAX_CHUNK = 64 * MB;
export const MAX_LAST_CHUNK = 128 * MB;
export const DEFAULT_CHUNK = 10 * MB;
export const MAX_CHUNKS = 1000;

export type ChunkRange = { index: number; first: number; last: number; size: number };
export type ChunkPlan = {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  chunks: ChunkRange[];
};

export function planChunks(videoSize: number, chunkSize = DEFAULT_CHUNK): ChunkPlan {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) {
    throw new IntegrationError(
      TIKTOK_POSTING_PROVIDER,
      "invalid_input",
      "Video size must be positive.",
    );
  }
  if (chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) {
    throw new IntegrationError(
      TIKTOK_POSTING_PROVIDER,
      "invalid_input",
      "Chunk size out of range.",
    );
  }

  // Under one chunk's worth: single chunk of the whole file.
  const size = videoSize < chunkSize ? videoSize : chunkSize;
  const total = Math.floor(videoSize / size);
  if (total > MAX_CHUNKS) {
    throw new IntegrationError(
      TIKTOK_POSTING_PROVIDER,
      "invalid_input",
      "Video too large to upload.",
    );
  }

  const chunks: ChunkRange[] = [];
  for (let i = 0; i < total; i++) {
    const first = i * size;
    const last = i === total - 1 ? videoSize - 1 : first + size - 1;
    chunks.push({ index: i, first, last, size: last - first + 1 });
  }
  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk.size > MAX_LAST_CHUNK) {
    throw new IntegrationError(TIKTOK_POSTING_PROVIDER, "invalid_input", "Final chunk too large.");
  }
  return { videoSize, chunkSize: size, totalChunkCount: total, chunks };
}

export function contentRange(chunk: ChunkRange, total: number): string {
  return `bytes ${chunk.first}-${chunk.last}/${total}`;
}
