/**
 * Layer 3: URL/Path Scrubbing (Story 2.1)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';

/** Default public domain allowlist — URLs to these domains are preserved */
export const DEFAULT_PUBLIC_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'stackexchange.com',
  'docs.python.org', 'docs.rs', 'pkg.go.dev',
  'npmjs.com', 'pypi.org', 'crates.io',
  'developer.mozilla.org', 'mdn.io',
  'wikipedia.org', 'en.wikipedia.org',
  'google.com', 'youtube.com',
  'medium.com', 'dev.to',
  'reddit.com', 'news.ycombinator.com',
  'twitter.com', 'x.com',
  'microsoft.com', 'docs.microsoft.com', 'learn.microsoft.com',
  'aws.amazon.com', 'docs.aws.amazon.com',
  'cloud.google.com',
  'azure.microsoft.com',
  'docker.com', 'hub.docker.com',
  'kubernetes.io',
  'vercel.com', 'netlify.com', 'heroku.com',
  'openai.com', 'platform.openai.com',
  'anthropic.com', 'docs.anthropic.com',
]);

const PRIVATE_IP_RE = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

const UNIX_PATH_RE = /(?:\/(?:home|Users|var|etc|tmp|opt|usr|root|srv|mnt|proc|dev|sys|run))\/?[^\s,;:)"'`\]}>]*/g;
const WINDOWS_PATH_RE = /[A-Z]:\\[^\s,;:)"'`\]}>]*/g;
const UNC_PATH_RE = /\\\\[a-zA-Z0-9._-]+\\[^\s,;:)"'`\]}>]*/g;

const URL_RE = /https?:\/\/[^\s,;)"'`\]}>]+/g;

const INTERNAL_HOST_PATTERNS = [
  /\.local\b/i,
  /\.internal\b/i,
  /\.corp\b/i,
  /\.private\b/i,
  /\.lan\b/i,
  /\.intranet\b/i,
  /\.compute\.internal\b/i,
  /localhost/i,
];

function extractHostFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    // Try extracting manually
    const match = url.match(/https?:\/\/([^/:]+)/);
    return match?.[1] ?? null;
  }
}

function isPrivateIP(host: string): boolean {
  return /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(host);
}

function isInternalHost(host: string): boolean {
  if (isPrivateIP(host)) return true;
  return INTERNAL_HOST_PATTERNS.some(p => p.test(host));
}

function isPublicDomain(host: string, allowlist: Set<string>): boolean {
  // Check exact match and parent domains
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join('.');
    if (allowlist.has(domain)) return true;
  }
  return false;
}

export class UrlPathScrubbingLayer implements RedactionLayer {
  readonly name = 'url_path_scrubbing' as const;
  readonly order = 300;

  private readonly allowlist: Set<string>;

  constructor(publicDomainAllowlist?: string[]) {
    this.allowlist = publicDomainAllowlist
      ? new Set([...DEFAULT_PUBLIC_DOMAINS, ...publicDomainAllowlist])
      : DEFAULT_PUBLIC_DOMAINS;
  }

  process(input: string, _context: RedactionContext): RedactionLayerResult {
    const findings: RedactionFinding[] = [];
    const replacements: Array<{ start: number; end: number; replacement: string; category: string }> = [];

    // Detect URLs
    const urlRegex = new RegExp(URL_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(input)) !== null) {
      const url = match[0];
      const host = extractHostFromUrl(url);
      if (host && !isPublicDomain(host, this.allowlist)) {
        if (isInternalHost(host) || !host.includes('.') || host === 'localhost') {
          replacements.push({
            start: match.index,
            end: match.index + url.length,
            replacement: '[INTERNAL_URL]',
            category: 'internal_url',
          });
        }
      }
    }

    // Detect private IPs (standalone, not in URLs already matched)
    const ipRegex = new RegExp(PRIVATE_IP_RE.source, 'g');
    while ((match = ipRegex.exec(input)) !== null) {
      const alreadyCovered = replacements.some(
        r => match!.index >= r.start && match!.index < r.end,
      );
      if (!alreadyCovered) {
        replacements.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: '[PRIVATE_IP]',
          category: 'private_ip',
        });
      }
    }

    // Detect file paths
    for (const pathRe of [UNIX_PATH_RE, WINDOWS_PATH_RE, UNC_PATH_RE]) {
      const re = new RegExp(pathRe.source, pathRe.flags);
      while ((match = re.exec(input)) !== null) {
        const alreadyCovered = replacements.some(
          r => match!.index >= r.start && match!.index < r.end,
        );
        if (!alreadyCovered) {
          replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement: '[FILE_PATH]',
            category: 'file_path',
          });
        }
      }
    }

    // Deduplicate overlapping
    replacements.sort((a, b) => b.start - a.start);
    const deduped: typeof replacements = [];
    for (const r of replacements) {
      if (!deduped.some(d => r.start < d.end && r.end > d.start)) {
        deduped.push(r);
      }
    }

    // Record findings ascending
    const ascending = [...deduped].sort((a, b) => a.start - b.start);
    for (const r of ascending) {
      findings.push({
        layer: 'url_path_scrubbing',
        category: r.category,
        originalLength: r.end - r.start,
        replacement: r.replacement,
        startOffset: r.start,
        endOffset: r.end,
        confidence: 0.90,
      });
    }

    // Apply replacements descending
    let output = input;
    for (const r of deduped) {
      output = output.slice(0, r.start) + r.replacement + output.slice(r.end);
    }

    return { output, findings, blocked: false };
  }
}
