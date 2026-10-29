import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { digest, type FileRef } from './result';

export const attachmentLimit = 9_500_000;
export async function evidenceBytes(root: string, path: string, expected?: Pick<FileRef, 'sha256' | 'bytes'>, limit = 150_000_000) {
  if (!/^(?:(?:scores|current-player|search-back)\/)?[a-z0-9-]+\.(?:png|mp4|json|md)$/.test(path)) throw new Error('Unsafe evidence path.');
  if (!(await lstat(root)).isDirectory()) throw new Error('Unsafe evidence root.');
  const base = await realpath(root);
  let file = base;
  for (const component of path.split('/')) {
    file = join(file, component);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Evidence symlinks are forbidden.');
  }
  const before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > limit) throw new Error('Unsafe evidence file.');
  const parent = await realpath(dirname(file));
  if (parent !== base && !parent.startsWith(base + sep)) throw new Error('Evidence escaped its root.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new Error('Evidence changed before read.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1 ||
      bytes.length !== before.size || (await lstat(file)).ino !== before.ino ||
      (expected && (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256))) throw new Error('Evidence hash or identity changed.');
    return bytes;
  } finally { await handle.close(); }
}

export function assetUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
    !/^\/user-attachments\/assets\/[a-f0-9-]{36}$/.test(url.pathname)) throw new Error('Not a stable GitHub attachment URL.');
  return url.href;
}

export async function publicBytes(value: string, limit: number, release = false, signal?: AbortSignal): Promise<Uint8Array> {
  let url = new URL(value);
  const deadline = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
  deadline.throwIfAborted();
  for (let redirects = 0; redirects <= 4; redirects++) {
    const hosts = release ? ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']
      : ['github.com', 'github-production-user-asset-6210df.s3.amazonaws.com', 'private-user-images.githubusercontent.com', 'user-images.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname) || url.port) throw new Error('Unsafe public download redirect.');
    const response = await fetch(url, { redirect: 'manual', signal: deadline, headers: { Accept: 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Missing public download redirect.');
      url = new URL(location, url); continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > limit) throw new Error('Public download failed or exceeded limit.');
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of response.body) {
      deadline.throwIfAborted();
      length += chunk.length;
      if (length > limit) { await response.body.cancel().catch(() => {}); throw new Error('Public download exceeded limit.'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Public download exceeded redirect limit.');
}
