interface ApiBaseUrlOptions {
  envBaseUrl?: string;
  hostname?: string;
  protocol?: string;
  port?: number;
}

const DEFAULT_HOSTNAME = 'localhost';
const DEFAULT_PORT = 3000;

const normalizeBaseUrl = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
};

const normalizeProtocol = (value?: string) => {
  return value === 'https:' || value === 'http:' ? value : 'http:';
};

export const resolveApiBaseUrl = (options: ApiBaseUrlOptions = {}) => {
  const explicitBaseUrl = normalizeBaseUrl(options.envBaseUrl);
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const protocol = normalizeProtocol(options.protocol);
  const hostname = options.hostname?.trim() || DEFAULT_HOSTNAME;
  const port = options.port ?? DEFAULT_PORT;
  return `${protocol}//${hostname}:${port}`;
};
