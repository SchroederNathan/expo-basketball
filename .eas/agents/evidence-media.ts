import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { attachmentLimit, evidenceBytes } from './evidence-files';
import { command, safeEnvironment, succeeded } from './process';
import { evidencePhase, phaseBudget, type EvidencePhase } from './evidence-phase';
import { digest } from './result';

const streamSchema = z.object({ codec_name: z.string(), pix_fmt: z.string(), width: z.number(), height: z.number(), nb_read_frames: z.string() });
export const playbackTransform = 'h264-all-frames-normalized-15fps-v1';
export const playbackFilter = 'scale=604:-2:flags=lanczos,settb=1/15,setpts=N:strip_fps=1';
async function frameSync(directory: string, env: NodeJS.ProcessEnv, mode: 'passthrough' | 'cfr', phase: EvidencePhase) {
  const help = await command({ executable: { file: 'ffmpeg', args: [] }, args: ['-hide_banner', '-h', 'full'], cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 10_000) });
  if (!succeeded(help)) throw new Error('FFmpeg frame synchronization capability is unavailable.');
  if (help.stdout.includes('-fps_mode')) return ['-fps_mode', mode];
  if (help.stdout.includes('-vsync')) return ['-vsync', mode === 'cfr' ? '1' : '0'];
  throw new Error('FFmpeg cannot preserve decoded frame order.');
}
export async function probeMedia(file: string, directory: string, env: NodeJS.ProcessEnv, phase = evidencePhase()) {
  const run = async (executable: string, args: string[]) => {
    const result = await command({ executable: { file: executable, args: [] }, args, cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 180_000) });
    if (!succeeded(result) || result.stderr.trim()) throw new Error('Staged evidence media validation failed.', { cause: { args, termination: result.termination, stderr: result.stderr, observation: result.observation } });
    return result.stdout;
  };
  const value = z.object({ streams: z.array(streamSchema).length(1) }).parse(JSON.parse(await run('ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames', '-of', 'json', file])));
  const stream = value.streams[0]!;
  const frames = Number(stream.nb_read_frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > 18_000 || stream.width < 100 || stream.height < 100 || stream.width > 5000 || stream.height > 5000) throw new Error('Evidence media bounds exceeded.');
  const decoded = await run('ffmpeg', ['-nostdin', '-v', 'error', '-err_detect', 'explode', '-xerror', '-i', file, '-map', '0:v:0',
    '-vf', 'settb=1/1000,setpts=N', '-enc_time_base', '1:1000', ...await frameSync(directory, env, 'passthrough', phase), '-progress', 'pipe:1', '-nostats', '-f', 'null', '-']);
  const observed = [...decoded.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1];
  if (Number(observed) !== frames) throw new Error('Evidence full decode frame count mismatch.');
  return { ...stream, frames };
}

export async function derivePlayback({ directory, original, output, env, phase = evidencePhase() }: { directory: string; original: string; output: string; env: NodeJS.ProcessEnv; phase?: EvidencePhase }) {
  const source = await evidenceBytes(directory, original, undefined, attachmentLimit);
  const before = await probeMedia(join(directory, original), directory, env, phase);
  const version = await command({ executable: { file: 'ffmpeg', args: [] }, args: ['-version'], cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 10_000) });
  if (!succeeded(version)) throw new Error('FFmpeg version is unavailable.');
  const capability = await command({ executable: { file: 'ffmpeg', args: [] }, args: ['-hide_banner', '-h', 'filter=setpts'], cwd: directory,
    env: safeEnvironment(env), ...phaseBudget(phase, 10_000) });
  if (!succeeded(capability)) throw new Error('FFmpeg timestamp capability is unavailable.');
  const sync = await frameSync(directory, env, 'cfr', phase);
  const encoding = ['-an', '-enc_time_base', '1:15', '-r', '15', ...sync, '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '24', '-maxrate', '1800k', '-bufsize', '3600k', '-fs', String(attachmentLimit), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', '-n', output];
  let decoderArgs: string[] | null = null;
  let args: string[];
  if (/\bstrip_fps\b/.test(capability.stdout)) {
    args = ['-nostdin', '-v', 'error', '-err_detect', 'explode', '-xerror', '-i', original, '-map', '0:v:0', '-vf', playbackFilter, ...encoding];
    const result = await command({ executable: { file: 'ffmpeg', args: [] }, args, cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 180_000) });
    if (!succeeded(result) || result.stderr.trim()) throw new Error('Edited playback derivation failed.');
  } else {
    const fifo = 'decoded-frames.yuv';
    const height = Math.round(before.height * 604 / before.width / 2) * 2;
    const passthrough = await frameSync(directory, env, 'passthrough', phase);
    const pipeline = new AbortController();
    try {
      const made = await command({ executable: { file: 'mkfifo', args: [] }, args: [fifo], cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 10_000) });
      if (!succeeded(made)) throw new Error('Decoded-frame pipe is unavailable.');
      decoderArgs = ['-nostdin', '-v', 'error', '-err_detect', 'explode', '-xerror', '-i', original, '-map', '0:v:0', '-an',
        '-vf', 'scale=604:-2:flags=lanczos,settb=1/15,setpts=N', '-enc_time_base', '1:15', ...passthrough, '-pix_fmt', 'yuv420p', '-threads', '2',
        '-progress', 'pipe:1', '-nostats', '-f', 'rawvideo', '-y', fifo];
      args = ['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', `604x${height}`, '-framerate', '15', '-i', fifo, ...encoding];
      const pipePhase = { ...phase, signal: AbortSignal.any([phase.signal, pipeline.signal]) };
      const run = async (argv: string[]) => {
        const result = await command({ executable: { file: 'ffmpeg', args: [] }, args: argv, cwd: directory, env: safeEnvironment(env), ...phaseBudget(pipePhase, 180_000) });
        if (!succeeded(result) || result.stderr.trim()) pipeline.abort();
        return result;
      };
      const results = await Promise.allSettled([run(decoderArgs), run(args)]);
      const decoded = results[0];
      if (results.some(result => result.status !== 'fulfilled' || !succeeded(result.value) || result.value.stderr.trim()) ||
        decoded.status !== 'fulfilled' || Number([...decoded.value.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1]) !== before.frames) {
        throw new Error('Decoded-frame playback pipeline failed.', { cause: results });
      }
    } finally { pipeline.abort(); await rm(join(directory, fifo), { force: true }); }
  }
  const bytes = await evidenceBytes(directory, output, undefined, attachmentLimit);
  const after = await probeMedia(join(directory, output), directory, env, phase);
  if (before.frames !== after.frames || after.codec_name !== 'h264' || after.pix_fmt !== 'yuv420p') throw new Error('Playback did not preserve every decoded frame.');
  const pts = await command({ executable: { file: 'ffprobe', args: [] }, args: ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts_time:format=duration', '-of', 'json', output],
    cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 60_000) });
  if (!succeeded(pts)) throw new Error('Playback timing validation failed.');
  const timeline = z.object({ frames: z.array(z.object({ pts_time: z.string() })), format: z.object({ duration: z.string() }) }).parse(JSON.parse(pts.stdout));
  const times = timeline.frames.map((frame) => Number(frame.pts_time));
  if (Math.abs(Number(timeline.format.duration) - before.frames / 15) > 0.00001 || times.length !== before.frames || times[0] !== 0 || times.some((time, index) => !Number.isFinite(time) || index > 0 && Math.abs(time - times[index - 1]! - 1 / 15) > 0.000002)) throw new Error('Playback normalized timing mismatch.');
  if (digest(await readFile(join(directory, original))) !== digest(source)) throw new Error('Original recording changed during derivation.');
  return { path: output, sha256: digest(bytes), bytes: bytes.length, transform: { id: playbackTransform, sourceSha256: digest(source),
    frames: before.frames, fps: 15, timing: 'normalized', ffmpeg: version.stdout.split('\n')[0]!, args, decoderArgs } };
}

export async function verifyPlaybackReadiness(directory: string, env: NodeJS.ProcessEnv, phase = evidencePhase()) {
  const canary = `readiness-${crypto.randomUUID()}`;
  const original = `${canary}-original.mp4`, playback = `${canary}-playback.mp4`;
  try {
    const generated = await command({ executable: { file: 'ffmpeg', args: [] }, cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 15_000),
      args: ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=200x300:r=30:d=0.2', '-c:v', 'mpeg4', '-threads', '1', '-n', original] });
    if (!succeeded(generated)) throw new Error('Evidence media canary generation failed.');
    const derived = await derivePlayback({ directory, original, output: playback, env, phase });
    if (derived.transform.frames !== 6) throw new Error('Evidence media canary frame preservation failed.');
  } finally { await rm(join(directory, original), { force: true }); await rm(join(directory, playback), { force: true }); }
}
