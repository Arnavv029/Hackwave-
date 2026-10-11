/**
 * Minimal JSONPath subset used for feature mappings and diffs.
 *
 * Supported: `$.a.b`, `$.a[0].b`, `$.items[].sku` (every element), `$['key']`,
 * `a.b` (leading `$.` optional). No filters, no recursion, no scripts: the
 * language is deliberately small so a mapping can never execute anything.
 *
 * Internal "flat path" syntax (as produced by the shape analyser) is
 * `a.b[].c`; `toFlatPath()` converts a JSONPath to it so mappings can be
 * compared with diff output regardless of how the user typed them.
 */

export type PathSegment = { key: string } | { index: number } | { all: true };

export class JsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonPathError';
  }
}

export function parseJsonPath(input: string): PathSegment[] {
  let s = input.trim();
  if (!s) throw new JsonPathError('path is empty');
  if (s === '$') return [];
  if (s.startsWith('$')) s = s.slice(1);
  if (s.startsWith('.')) s = s.slice(1);
  const out: PathSegment[] = [];
  let i = 0;
  const readKey = (): string => {
    const start = i;
    while (i < s.length && s[i] !== '.' && s[i] !== '[') i++;
    const key = s.slice(start, i);
    if (!key) throw new JsonPathError(`unexpected token at position ${start} in "${input}"`);
    return key;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '.') {
      i++;
      continue;
    }
    if (ch === '[') {
      const close = s.indexOf(']', i);
      if (close < 0) throw new JsonPathError(`unclosed "[" in "${input}"`);
      const inner = s.slice(i + 1, close).trim();
      i = close + 1;
      if (inner === '' || inner === '*') out.push({ all: true });
      else if (/^-?\d+$/.test(inner)) out.push({ index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) out.push({ key: inner.slice(1, -1) });
      else throw new JsonPathError(`unsupported bracket expression "[${inner}]" in "${input}"`);
      continue;
    }
    out.push({ key: readKey() });
  }
  return out;
}

/** Every value the path addresses (several when `[]` is used). */
export function resolveJsonPath(value: unknown, path: string | PathSegment[]): unknown[] {
  const segs = typeof path === 'string' ? parseJsonPath(path) : path;
  let current: unknown[] = [value];
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const v of current) {
      if ('all' in seg) {
        if (Array.isArray(v)) next.push(...(v as unknown[]));
      } else if ('index' in seg) {
        if (Array.isArray(v)) {
          const idx = seg.index < 0 ? v.length + seg.index : seg.index;
          if (idx >= 0 && idx < v.length) next.push(v[idx]);
        }
      } else if (isRecord(v) && Object.prototype.hasOwnProperty.call(v, seg.key)) {
        next.push(v[seg.key]);
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

/** True when the path resolves to at least one value (null counts as present). */
export function jsonPathExists(value: unknown, path: string | PathSegment[]): boolean {
  return resolveJsonPath(value, path).length > 0;
}

/** JSONPath -> flat path used by the shape analyser (`$.items[0].sku` -> `items[].sku`). */
export function toFlatPath(path: string | PathSegment[]): string {
  const segs = typeof path === 'string' ? parseJsonPath(path) : path;
  let out = '';
  for (const seg of segs) {
    if ('key' in seg) out = out ? `${out}.${seg.key}` : seg.key;
    else out = `${out}[]`;
  }
  return out;
}

/** Flat path -> canonical JSONPath (`items[].sku` -> `$.items[].sku`). */
export function toJsonPath(flat: string): string {
  return flat ? `$.${flat}` : '$';
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
