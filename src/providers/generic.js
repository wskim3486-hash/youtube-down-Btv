import { YtDlpProvider } from './ytdlp.js';

export class GenericProvider extends YtDlpProvider {
  constructor(config) { super(config); this.id = 'generic'; this.label = '공개 웹 영상'; }
  matches() { return true; }
}
