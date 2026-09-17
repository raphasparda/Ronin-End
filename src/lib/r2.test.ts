import { describe, expect, it, vi } from 'vitest';

import { createR2Client, presignUrl, R2Error, uriEncode } from './r2';

const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const now = new Date('2026-09-17T14:03:00.000Z');

/** Resposta mínima para os testes (nenhum teste fala com a rede). */
function response(
  status: number,
  options: { headers?: Record<string, string>; body?: string | Uint8Array } = {},
): Response {
  return new Response(options.body ?? null, { status, headers: options.headers });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn((input: string | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.href;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof globalThis.fetch;
  return { fetchStub, calls };
}

function client(handler: (url: string, init: RequestInit) => Response) {
  const { fetchStub, calls } = stubFetch(handler);
  return {
    calls,
    r2: createR2Client({
      endpoint: 'https://conta.r2.cloudflarestorage.com',
      bucket: 'ronin-capas',
      credentials,
      fetch: fetchStub,
    }),
  };
}

describe('SigV4 (presignUrl)', () => {
  it('reproduz o vetor conhecido da AWS (GET presigned, us-east-1, 24 h)', () => {
    const url = presignUrl({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      credentials,
      region: 'us-east-1',
      expiresInSeconds: 86_400,
      now: new Date('2013-05-24T00:00:00.000Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('assinatura muda com método, instante, headers assinados e chave', () => {
    const base = {
      url: new URL('https://conta.r2.cloudflarestorage.com/ronin-capas/covers/a/b'),
      credentials,
      region: 'auto',
      expiresInSeconds: 300,
      now,
    } as const;
    const signature = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');

    const get = signature(presignUrl({ ...base, method: 'GET' }));
    const put = signature(presignUrl({ ...base, method: 'PUT' }));
    const later = signature(
      presignUrl({ ...base, method: 'GET', now: new Date(now.getTime() + 1000) }),
    );
    const withHeaders = signature(
      presignUrl({ ...base, method: 'PUT', signedHeaders: { 'content-type': 'image/png' } }),
    );
    expect(new Set([get, put, later, withHeaders]).size).toBe(4);
    expect(get).toMatch(/^[0-9a-f]{64}$/);
  });

  it('codifica a chave em RFC 3986 e mantém as barras do caminho', () => {
    expect(uriEncode("a b+c/d'e")).toBe('a%20b%2Bc%2Fd%27e');
    const url = new URL(
      presignUrl({
        method: 'GET',
        url: new URL('https://conta.r2.cloudflarestorage.com/bucket/covers/id/a b'),
        credentials,
        region: 'auto',
        expiresInSeconds: 60,
        now,
      }),
    );
    expect(url.pathname).toBe('/bucket/covers/id/a%20b');
  });
});

describe('cliente do R2 (com dublê de rede)', () => {
  it('presignPut assina tipo e tamanho e devolve o header que o navegador repete', () => {
    const { r2 } = client(() => response(200));
    const signed = r2.presignPut('covers/card/objeto', {
      contentType: 'image/webp',
      contentLength: 1234,
      expiresInSeconds: 300,
      now,
    });
    const url = new URL(signed.url);
    expect(url.pathname).toBe('/ronin-capas/covers/card/objeto');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(signed.headers).toEqual({ 'content-type': 'image/webp' });

    // Outro tamanho = outra assinatura: o cliente não muda o que foi assinado.
    const outro = r2.presignPut('covers/card/objeto', {
      contentType: 'image/webp',
      contentLength: 9999,
      expiresInSeconds: 300,
      now,
    });
    expect(new URL(outro.url).searchParams.get('X-Amz-Signature')).not.toBe(
      url.searchParams.get('X-Amz-Signature'),
    );
  });

  it('presignGet usa a base pública quando há domínio próprio e leva cache privado', () => {
    const { fetchStub } = stubFetch(() => response(200));
    const r2 = createR2Client({
      endpoint: 'https://conta.r2.cloudflarestorage.com',
      bucket: 'ronin-capas',
      credentials,
      publicBaseUrl: 'https://capas.exemplo.com',
      fetch: fetchStub,
    });
    const url = new URL(
      r2.presignGet('covers/card/objeto', {
        expiresInSeconds: 900,
        now,
        cacheControl: 'private, max-age=600',
      }),
    );
    expect(url.origin).toBe('https://capas.exemplo.com');
    expect(url.searchParams.get('response-cache-control')).toBe('private, max-age=600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('head devolve tamanho e tipo; 404 vira null; outro status vira R2Error', async () => {
    const found = client(() =>
      response(200, { headers: { 'content-length': '2048', 'content-type': 'image/png' } }),
    );
    await expect(found.r2.head('covers/card/objeto')).resolves.toEqual({
      contentLength: 2048,
      contentType: 'image/png',
    });
    expect(found.calls[0]?.init.method).toBe('HEAD');

    const missing = client(() => response(404));
    await expect(missing.r2.head('covers/card/objeto')).resolves.toBeNull();

    const broken = client(() => response(500));
    await expect(broken.r2.head('covers/card/objeto')).rejects.toBeInstanceOf(R2Error);
  });

  it('getRange pede só os primeiros bytes', async () => {
    const magic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { r2, calls } = client(() => response(206, { body: magic }));
    await expect(r2.getRange('covers/card/objeto', 15)).resolves.toEqual(magic);
    expect((calls[0]?.init.headers as Record<string, string>).range).toBe('bytes=0-15');
  });

  it('deleteObject aceita 204 e 404 (idempotente) e recusa 403', async () => {
    await expect(client(() => response(204)).r2.deleteObject('k')).resolves.toBeUndefined();
    await expect(client(() => response(404)).r2.deleteObject('k')).resolves.toBeUndefined();
    await expect(client(() => response(403)).r2.deleteObject('k')).rejects.toBeInstanceOf(R2Error);
  });

  it('listObjects lê o XML do ListObjectsV2, com paginação', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>true</IsTruncated>
        <NextContinuationToken>token-2</NextContinuationToken>
        <Contents>
          <Key>covers/abc/chave-1</Key>
          <LastModified>2026-09-16T12:00:00.000Z</LastModified>
          <Size>1024</Size>
        </Contents>
        <Contents>
          <Key>covers/def/chave-2</Key>
          <LastModified>2026-09-17T12:00:00.000Z</LastModified>
          <Size>2048</Size>
        </Contents>
      </ListBucketResult>`;
    const { r2, calls } = client(() => response(200, { body: xml }));
    const result = await r2.listObjects('covers/', { continuationToken: 'token-1' });
    expect(result.objects).toEqual([
      {
        key: 'covers/abc/chave-1',
        size: 1024,
        lastModified: new Date('2026-09-16T12:00:00.000Z'),
      },
      {
        key: 'covers/def/chave-2',
        size: 2048,
        lastModified: new Date('2026-09-17T12:00:00.000Z'),
      },
    ]);
    expect(result.nextToken).toBe('token-2');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('prefix')).toBe('covers/');
    expect(url.searchParams.get('continuation-token')).toBe('token-1');
  });

  it('falha de rede vira R2Error sem expor a URL assinada', async () => {
    const fetchStub = vi.fn(() =>
      Promise.reject(new Error('conexão recusada')),
    ) as unknown as typeof globalThis.fetch;
    const r2 = createR2Client({
      endpoint: 'https://conta.r2.cloudflarestorage.com',
      bucket: 'ronin-capas',
      credentials,
      fetch: fetchStub,
    });
    const error = await r2.head('covers/card/objeto').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(R2Error);
    expect((error as R2Error).message).not.toContain('X-Amz-Signature');
  });
});
