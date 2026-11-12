import "server-only";
import { MAX_PHOTO_BYTES } from "@/contract";

// PB-30: a shopper photo on Messenger or Telegram, fetched only after the
// message passed the dedupe (a redelivered message never downloads again).
export type PhotoSource = () => Promise<Uint8Array>;

const DOWNLOAD_TIMEOUT_MS = 10_000;

// Reads at most MAX_PHOTO_BYTES + 1 bytes: one byte more is enough for the
// size check to refuse it, and a huge file is never read whole.
async function fetchCapped(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok || !response.body) throw new Error(`photo download answered ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_PHOTO_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(total, MAX_PHOTO_BYTES + 1));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

// Messenger attachment URL (a CDN URL that expires; never stored).
export function messengerPhoto(url: string, fetchImpl: typeof fetch = fetch): PhotoSource {
  return () => withTimeout((signal) => fetchCapped(url, fetchImpl, signal));
}

// Telegram: getFile, then the file URL (it carries the bot token; never stored).
export function telegramPhoto(botToken: string, fileId: string, fetchImpl: typeof fetch = fetch): PhotoSource {
  return () =>
    withTimeout(async (signal) => {
      const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string } } | null;
      const filePath = body?.ok ? body.result?.file_path : undefined;
      if (!res.ok || !filePath) throw new Error(`telegram getFile failed (${res.status})`);
      return fetchCapped(`https://api.telegram.org/file/bot${botToken}/${filePath}`, fetchImpl, signal);
    });
}
