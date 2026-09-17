import { createHash, createHmac } from 'node:crypto';

/**
 * Cliente mínimo de S3/Cloudflare R2 (ADR 0016), só com `node:crypto` e `fetch`.
 *
 * Precisamos de cinco operações — presign de `PUT` e `GET`, `HEAD`, `DELETE` e `ListObjectsV2` —
 * e todas cabem em URL assinada por query string (SigV4). O SDK da AWS acrescentaria megabytes ao
 * bundle e tempo de boot num serviço que hiberna e acorda o tempo todo (Render Free).
 *
 * Nada aqui loga URL assinada nem credencial: a assinatura **é** uma credencial temporária.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
/** R2 ignora a região, mas ela entra no escopo da assinatura. */
export const R2_REGION = 'auto';
/** Corpo não assinado: o navegador envia os bytes direto, sem passar pela API. */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
/** Toda chamada de rede ao R2 tem timeout curto; estourou, vira `503` (nunca 500). */
export const R2_TIMEOUT_MS = 5_000;

/** Falha de rede, timeout ou status inesperado do R2. */
export class R2Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'R2Error';
  }
}

export interface R2Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** RFC 3986: `encodeURIComponent` + os três caracteres que ele deixa passar. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Caminho canônico: cada segmento codificado, as barras preservadas. */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(params: Map<string, string>): string {
  return [...params.entries()]
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** `2026-09-17T14:03:00Z` → `20260917T140300Z`. */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** URL do objeto/recurso, já com os parâmetros de query da operação (sem os de assinatura). */
  url: URL;
  credentials: R2Credentials;
  region: string;
  /** Headers que o cliente **precisa** repetir (`host` entra sozinho). */
  signedHeaders?: Record<string, string>;
  expiresInSeconds: number;
  now: Date;
}

/**
 * URL assinada por query string (SigV4, "Signature Version 4 query parameters"):
 * assina método, caminho, query, headers declarados e o escopo `data/região/s3/aws4_request`.
 * Assinar é HMAC local: não há ida à rede.
 */
export function presignUrl(input: PresignInput): string {
  const { method, credentials, region, expiresInSeconds, now } = input;
  const url = new URL(input.url.toString());
  const timestamp = amzDate(now);
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${region}/${SERVICE}/aws4_request`;

  const headers = new Map<string, string>([['host', url.host]]);
  for (const [name, value] of Object.entries(input.signedHeaders ?? {})) {
    headers.set(name.toLowerCase(), value.trim());
  }
  const signedHeaderNames = [...headers.keys()].sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const query = new Map<string, string>();
  for (const [name, value] of url.searchParams.entries()) query.set(name, value);
  query.set('X-Amz-Algorithm', ALGORITHM);
  query.set('X-Amz-Credential', `${credentials.accessKeyId}/${scope}`);
  query.set('X-Amz-Date', timestamp);
  query.set('X-Amz-Expires', String(expiresInSeconds));
  query.set('X-Amz-SignedHeaders', signedHeaders);

  const canonicalRequest = [
    method,
    canonicalPath(url.pathname),
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, timestamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = ['aws4_request'].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), SERVICE),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `${url.origin}${canonicalPath(url.pathname)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

export interface R2ClientOptions {
  /** Endpoint S3 do bucket (`https://<conta>.r2.cloudflarestorage.com`). */
  endpoint: string;
  bucket: string;
  credentials: R2Credentials;
  region?: string;
  /** Base das URLs **assinadas** de leitura (domínio próprio apontado para o endpoint S3). */
  publicBaseUrl?: string | undefined;
  timeoutMs?: number;
  /** Injeção para testes: nenhuma chamada de rede real nos testes. */
  fetch?: typeof globalThis.fetch;
}

export interface PresignedUpload {
  url: string;
  /** Headers que o `PUT` no R2 precisa repetir (o `Content-Length` o navegador envia sozinho). */
  headers: Record<string, string>;
}

export interface R2ObjectHead {
  contentLength: number;
  contentType: string | null;
}

export interface R2ListedObject {
  key: string;
  size: number;
  lastModified: Date | null;
}

export interface R2ListResult {
  objects: R2ListedObject[];
  nextToken: string | null;
}

export interface R2Client {
  readonly bucket: string;
  /** `PUT` assinado com `content-type` e `content-length`: o cliente não muda tipo nem tamanho. */
  presignPut(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSeconds: number; now: Date },
  ): PresignedUpload;
  /** `GET` assinado de leitura (com `response-cache-control` privado). */
  presignGet(
    key: string,
    options: { expiresInSeconds: number; now: Date; cacheControl?: string },
  ): string;
  /** `null` se o objeto não existe. */
  head(key: string): Promise<R2ObjectHead | null>;
  /** Primeiros bytes do objeto (`Range`), para conferir a assinatura do formato. */
  getRange(key: string, endInclusive: number): Promise<Uint8Array | null>;
  /** Idempotente: objeto ausente não é erro. */
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string, options?: { continuationToken?: string }): Promise<R2ListResult>;
}

function objectUrl(base: string, bucket: string, key: string): URL {
  const url = new URL(base);
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = `${prefix}/${bucket}/${key}`;
  return url;
}

/** Extrai o texto de uma tag XML simples (sem atributos), o suficiente para o ListObjectsV2. */
function xmlValues(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'));
  return [...matches].map((match) => match[1] ?? '');
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Cliente do bucket. Não guarda estado nem abre conexão na criação. */
export function createR2Client(options: R2ClientOptions): R2Client {
  const region = options.region ?? R2_REGION;
  const timeoutMs = options.timeoutMs ?? R2_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const readBase = options.publicBaseUrl?.trim() || options.endpoint;

  const sign = (
    method: PresignInput['method'],
    url: URL,
    expiresInSeconds: number,
    now: Date,
    signedHeaders?: Record<string, string>,
  ): string =>
    presignUrl({
      method,
      url,
      credentials: options.credentials,
      region,
      expiresInSeconds,
      now,
      ...(signedHeaders ? { signedHeaders } : {}),
    });

  async function request(
    method: 'GET' | 'HEAD' | 'DELETE',
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      return await doFetch(url, { ...init, method, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // Mensagem sem a URL: ela carrega a assinatura.
      throw new R2Error(`falha ao falar com o armazenamento (${method})`, undefined, {
        cause: err,
      });
    }
  }

  return {
    bucket: options.bucket,

    presignPut(key, { contentType, contentLength, expiresInSeconds, now }) {
      const url = sign(
        'PUT',
        objectUrl(options.endpoint, options.bucket, key),
        expiresInSeconds,
        now,
        { 'content-type': contentType, 'content-length': String(contentLength) },
      );
      return { url, headers: { 'content-type': contentType } };
    },

    presignGet(key, { expiresInSeconds, now, cacheControl }) {
      const url = objectUrl(readBase, options.bucket, key);
      if (cacheControl) url.searchParams.set('response-cache-control', cacheControl);
      return sign('GET', url, expiresInSeconds, now);
    },

    async head(key) {
      const url = sign('HEAD', objectUrl(options.endpoint, options.bucket, key), 60, new Date());
      const res = await request('HEAD', url);
      if (res.status === 404) return null;
      if (!res.ok) throw new R2Error('HEAD recusado pelo armazenamento', res.status);
      const length = Number(res.headers.get('content-length') ?? '');
      return {
        contentLength: Number.isFinite(length) ? length : 0,
        contentType: res.headers.get('content-type'),
      };
    },

    async getRange(key, endInclusive) {
      const url = sign('GET', objectUrl(options.endpoint, options.bucket, key), 60, new Date());
      const res = await request('GET', url, { headers: { range: `bytes=0-${endInclusive}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new R2Error('leitura recusada pelo armazenamento', res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async deleteObject(key) {
      const url = sign('DELETE', objectUrl(options.endpoint, options.bucket, key), 60, new Date());
      const res = await request('DELETE', url);
      // 204 (apagado) e 404 (já não existia) são sucesso.
      if (!res.ok && res.status !== 404) {
        throw new R2Error('exclusão recusada pelo armazenamento', res.status);
      }
    },

    async listObjects(prefix, listOptions = {}) {
      const url = new URL(options.endpoint);
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${options.bucket}`;
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('max-keys', '1000');
      if (listOptions.continuationToken) {
        url.searchParams.set('continuation-token', listOptions.continuationToken);
      }
      const res = await request('GET', sign('GET', url, 60, new Date()));
      if (!res.ok) throw new R2Error('listagem recusada pelo armazenamento', res.status);
      const xml = await res.text();
      const objects = xmlValues(xml, 'Contents').map((entry): R2ListedObject => {
        const modified = xmlValues(entry, 'LastModified')[0];
        const parsed = modified ? new Date(modified) : null;
        return {
          key: xmlDecode(xmlValues(entry, 'Key')[0] ?? ''),
          size: Number(xmlValues(entry, 'Size')[0] ?? '0'),
          lastModified: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
        };
      });
      const truncated = xmlValues(xml, 'IsTruncated')[0] === 'true';
      const nextToken = truncated ? (xmlValues(xml, 'NextContinuationToken')[0] ?? null) : null;
      return { objects, nextToken };
    },
  };
}
