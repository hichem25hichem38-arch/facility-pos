import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/utils/crypto';

/*
 * The pure-JS PBKDF2 fallback must produce byte-identical output to WebCrypto,
 * otherwise a user who logs in over plain HTTP (no `crypto.subtle`) could no
 * longer authenticate afterwards. The vite test env has no subtle, so these
 * calls exercise the fallback.
 */
describe('password hashing', () => {
  it('matches the known PBKDF2-HMAC-SHA256 vector', async () => {
    expect(
      await verifyPassword(
        'admin123',
        '000102030405060708090a0b0c0d0e0f',
        'f11cfeba98866961ca4903b25696fb7a85efea47c0b7b35525aaa0682ac7097f',
      ),
    ).toBe(true);
  });

  it('falls back to the JS implementation when crypto.subtle is missing', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    try {
      expect(
        await verifyPassword(
          'admin123',
          '000102030405060708090a0b0c0d0e0f',
          'f11cfeba98866961ca4903b25696fb7a85efea47c0b7b35525aaa0682ac7097f',
        ),
      ).toBe(true);
      expect(
        await verifyPassword(
          'admin123',
          '000102030405060708090a0b0c0d0e0f',
          '0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });

  it('round-trips a fresh salt', async () => {
    const { salt, passwordHash } = await hashPassword('s3cret-pass');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPassword('s3cret-pass', salt, passwordHash)).toBe(true);
    expect(await verifyPassword('wrong', salt, passwordHash)).toBe(false);
  });
});
