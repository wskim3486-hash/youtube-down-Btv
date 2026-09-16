import { HlsProvider } from './hls.js';
import { YtDlpProvider } from './ytdlp.js';
import { GenericProvider } from './generic.js';

export function createRegistry(config) {
  const providers = [new HlsProvider(config), new YtDlpProvider(config), new GenericProvider(config)];
  return {
    all: providers,
    resolve(url) { return providers.find(provider => provider.matches(url)); }
  };
}
