import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UnprocessableError } from '../errors.js';

/**
 * Outbound-request guard for user-supplied URLs. Resolves the hostname and
 * refuses loopback, private, link-local, multicast, metadata and unspecified
 * addresses unless private networks are explicitly allowed (development).
 */
export interface SsrfOptions {
  allowPrivateNetworks: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

export interface SsrfVerdict {
  url: URL;
  addresses: string[];
  blocked: boolean;
  reason?: string;
}

export async function checkUrl(raw: string, opts: SsrfOptions): Promise<SsrfVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnprocessableError('URL is not valid', { url: raw });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnprocessableError('Only http and https URLs can be monitored', { protocol: url.protocol });
  if (url.username || url.password) throw new UnprocessableError('Credentials in the URL are not allowed; use the authentication settings');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await (opts.resolve ?? defaultResolve)(host);
    } catch (err) {
      return { url, addresses: [], blocked: true, reason: `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (host === 'localhost' || host.endsWith('.localhost')) addresses = addresses.length ? addresses : ['127.0.0.1'];
  if (!opts.allowPrivateNetworks) {
    for (const a of addresses) {
      const why = privateReason(a);
      if (why) return { url, addresses, blocked: true, reason: `${a} is ${why}; private destinations are blocked by the SSRF guard` };
    }
    if (host === 'localhost' || host.endsWith('.localhost')) return { url, addresses, blocked: true, reason: 'localhost is blocked by the SSRF guard' };
  }
  return { url, addresses, blocked: false };
}

async function defaultResolve(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true });
  return res.map((r) => r.address);
}

/** Reason an address is non-public, or null. */
export function privateReason(address: string): string | null {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number, number, number];
    if (a === 10) return 'a private 10/8 address';
    if (a === 127) return 'a loopback address';
    if (a === 0) return 'an unspecified address';
    if (a === 169 && b === 254) return 'a link-local / cloud metadata address';
    if (a === 172 && b >= 16 && b <= 31) return 'a private 172.16/12 address';
    if (a === 192 && b === 168) return 'a private 192.168/16 address';
    if (a === 100 && b >= 64 && b <= 127) return 'a carrier-grade NAT address';
    if (a >= 224) return 'a multicast or reserved address';
    return null;
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1') return 'a loopback address';
    if (lower === '::') return 'an unspecified address';
    if (lower.startsWith('fe80:')) return 'a link-local address';
    if (/^f[cd]/.test(lower)) return 'a unique-local address';
    if (lower.startsWith('::ffff:')) return privateReason(lower.slice(7));
    return null;
  }
  return 'not an IP address';
}
