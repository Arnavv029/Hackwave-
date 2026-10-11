import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM at-rest encryption for monitor credentials. The key comes from
 * the environment (MONITOR_SECRET_KEY); any string is accepted and hashed to
 * 32 bytes so operators can use a passphrase. Ciphertext format:
 * `v1:<iv b64>:<tag b64>:<data b64>`.
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(secret: string) {
    if (!secret || secret.length < 16) throw new Error('MONITOR_SECRET_KEY must be at least 16 characters');
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }
  decrypt(blob: string): string {
    const [v, iv, tag, data] = blob.split(':');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('unrecognised secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
