import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './lib/process.js';
import { AppError } from './lib/errors.js';
import { normalizeTitle } from './providers/base.js';

export class JobManager {
  constructor(config) { this.config = config; this.jobs = new Map(); this.running = 0; this.queue = []; }

  async init() {
    await fs.mkdir(this.config.tempRoot, { recursive: true });
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  create(provider, metadata, selection) {
    const id = crypto.randomUUID();
    const extension = selection.mode === 'audio' ? 'mp3' : 'mp4';
    const safeTitle = normalizeTitle(metadata.title);
    const directory = path.join(this.config.tempRoot, id);
    const outputPath = path.join(directory, `${safeTitle}.${extension}`);
    const job = { id, status: 'queued', progress: null, createdAt: Date.now(), provider, metadata, selection, directory, outputPath, filename: `${safeTitle}.${extension}`, error: null };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.drain();
    return publicJob(job);
  }

  get(id) { const job = this.jobs.get(id); if (!job) throw new AppError('작업을 찾을 수 없습니다.', 404, 'JOB_NOT_FOUND'); return job; }

  async drain() {
    while (this.running < this.config.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      this.execute(job).finally(() => { this.running -= 1; this.drain(); });
    }
  }

  async execute(job) {
    try {
      job.status = 'processing';
      await fs.mkdir(job.directory, { recursive: true });
      const outputTemplate = path.join(job.directory, '%(title).120B.%(ext)s');
      const spec = job.provider.buildDownload({ ...job.metadata, ...job.selection, outputPath: job.outputPath, outputTemplate });
      await run(spec.command, spec.args, { timeoutMs: 30 * 60_000 });
      if (job.provider.id === 'ytdlp' || job.provider.id === 'generic') {
        const files = await fs.readdir(job.directory);
        const result = files.find(name => name.toLowerCase().endsWith(`.${spec.extension}`));
        if (!result) throw new AppError('변환된 파일을 찾지 못했습니다.', 500, 'OUTPUT_MISSING');
        job.outputPath = path.join(job.directory, result);
        job.filename = result;
      }
      job.status = 'ready';
      job.readyAt = Date.now();
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || '다운로드에 실패했습니다.';
    }
  }

  async cleanup() {
    const cutoff = Date.now() - this.config.downloadTtlMs;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff && job.status !== 'processing') {
        await fs.rm(job.directory, { recursive: true, force: true }).catch(() => {});
        this.jobs.delete(id);
      }
    }
  }
}

export function publicJob(job) {
  return { id: job.id, status: job.status, filename: job.status === 'ready' ? job.filename : null, error: job.error };
}
