export class MediaProvider {
  constructor(id, label) {
    this.id = id;
    this.label = label;
  }
  matches() { return false; }
  async analyze() { throw new Error('analyze() must be implemented'); }
  buildDownload() { throw new Error('buildDownload() must be implemented'); }
}

export function normalizeTitle(title = 'video') {
  return String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
}
