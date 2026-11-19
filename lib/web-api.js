// Host web API for the review panel.
//
// The panel runs in the Web page and therefore cannot read the filesystem
// itself. It calls these two same-origin JSON endpoints, which reuse
// `reviewDirectory()` / `revertPath()` unchanged so the panel and the model
// tools report the same data and enforce the same path rules.
//
// Trust model (defence in depth, not an OS boundary):
// - the request socket must be loopback, and the Host header must name a
//   loopback host, so a DNS-rebinding page cannot reach the route;
// - `Origin` must match the request's own scheme and Host, so a cross-site
//   form or script cannot drive it (a cross-origin JSON POST also preflights,
//   and this route answers no CORS headers);
// - bodies are small JSON objects; anything else is refused;
// - revert additionally requires `confirm === true` in the body and keeps the
//   `.bak` backup, exactly like the `lyrics_revert` tool.

import { reviewDirectory } from './review.js';
import { revertPath } from './revert.js';
import { resolveDirectory, resolveFile } from './scan.js';

/** Prefix of every route owned by this plugin. */
export const WEB_API_PREFIX = '/_dsh/lyrics-review';

/** Route that runs a read-only review. */
export const REVIEW_ROUTE = `${WEB_API_PREFIX}/review`;

/** Route that restores one file from its `.bak` backup. */
export const REVERT_ROUTE = `${WEB_API_PREFIX}/revert`;

/** Largest accepted JSON body. */
const MAX_BODY_BYTES = 64 * 1024;

/** An expected client error with its HTTP status. */
export class WebApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.name = 'WebApiError';
    this.status = status;
  }
}

/** @param {unknown} value @param {string} name */
function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebApiError(400, `${name} must be a JSON object`);
  }
}

/**
 * Run an operation whose thrown errors describe the caller's input or the
 * selected files, and present them as 400 rather than as a server failure.
 * @template T
 * @param {() => T} operation
 * @returns {T}
 */
function asClientOperation(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof WebApiError) throw error;
    throw new WebApiError(400, error instanceof Error ? error.message : String(error));
  }
}

/** @param {Record<string, unknown>} body @param {string} name @param {{ required?: boolean }} options */
function readString(body, name, options = {}) {
  const value = body[name];
  if (value === undefined || value === null) {
    if (options.required) throw new WebApiError(400, `${name} is required and must be a non-empty string`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WebApiError(400, `${name} must be a non-empty string`);
  }
  return value;
}

/** @param {Record<string, unknown>} body */
function readFilter(body) {
  const value = body.filter;
  if (value === undefined) return 'flagged';
  if (value !== 'flagged' && value !== 'all') {
    throw new WebApiError(400, "filter must be 'flagged' or 'all'");
  }
  return value;
}

/** @param {Record<string, unknown>} body */
function readLimit(body) {
  const value = body.limit;
  if (value === undefined) return 100;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new WebApiError(400, 'limit must be an integer from 1 to 1000');
  }
  return value;
}

/**
 * Validate a review request and run the same engine the `lyrics_review` tool uses.
 * @param {unknown} input parsed JSON body
 */
export function reviewRequest(input) {
  requireObject(input, 'request body');
  const body = /** @type {Record<string, unknown>} */ (input);
  const directory = readString(body, 'directory', { required: true });
  const file = readString(body, 'file');
  const filter = readFilter(body);
  const limit = readLimit(body);
  return asClientOperation(() => {
    const resolved = resolveDirectory(directory);
    return reviewDirectory({ directory: resolved, file, filter, limit });
  });
}

/**
 * Validate a revert request and restore exactly one file inside the directory.
 * The body names `directory` and `file` instead of an arbitrary absolute path,
 * so the panel cannot be used to overwrite files outside the reviewed tree.
 * @param {unknown} input parsed JSON body
 */
export function revertRequest(input) {
  requireObject(input, 'request body');
  const body = /** @type {Record<string, unknown>} */ (input);
  if (body.confirm !== true) {
    throw new WebApiError(400, 'confirm must be true: reverting overwrites the current file with its .bak backup');
  }
  const directory = readString(body, 'directory', { required: true });
  const file = readString(body, 'file', { required: true });
  return asClientOperation(() => {
    const target = resolveFile(resolveDirectory(directory), file);
    return revertPath({ path: target, confirm: true });
  });
}

/** @param {import('node:http').IncomingMessage} req */
function requestScheme(req) {
  const socket = /** @type {{ encrypted?: boolean }} */ (req.socket || {});
  return socket.encrypted === true ? 'https' : 'http';
}

/** @param {import('node:http').IncomingMessage} req */
function requestOrigin(req) {
  return `${requestScheme(req)}://${req.headers.host || ''}`;
}

/** @param {string} hostname */
function isLoopbackHostname(hostname) {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '::1' || name === '::ffff:127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(name);
}

/** @param {import('node:http').IncomingMessage} req */
function isLoopbackPeer(req) {
  const address = (req.socket && req.socket.remoteAddress) || '';
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/** @param {import('node:http').IncomingMessage} req */
function hasLoopbackHostHeader(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * Enforce the same-origin local JSON contract.
 * @param {import('node:http').IncomingMessage} req
 */
function assertTrustedRequest(req) {
  if (!isLoopbackPeer(req)) throw new WebApiError(403, 'this endpoint only accepts local loopback requests');
  if (!hasLoopbackHostHeader(req)) throw new WebApiError(403, 'the Host header must name a loopback address');
  // Desktop serves the page from file:// and carries fetch over an IPC bridge;
  // the bridged request may arrive without an Origin header (or with `null`).
  // CSRF stays blocked by the JSON content-type: a cross-origin JSON POST
  // preflights, and this route never answers a preflight. The loopback Peer and
  // loopback Host header form the anti-rebinding fence. When an Origin is
  // present, it must still name this exact endpoint.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new WebApiError(403, 'the Origin header is not a valid origin');
    }
    if (`${parsedOrigin.protocol}//${parsedOrigin.host}` !== origin || origin !== requestOrigin(req)) {
      throw new WebApiError(403, 'the request must come from the page that owns this endpoint');
    }
  }
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new WebApiError(415, 'this endpoint requires Content-Type: application/json');
  }
}

/**
 * Read one bounded JSON body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        fail(new WebApiError(413, 'the request body is too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text.trim() === '' ? null : JSON.parse(text));
      } catch {
        reject(new WebApiError(400, 'the request body is not valid JSON'));
      }
    });
    req.on('error', (error) => fail(new WebApiError(400, error.message)));
  });
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Handle one route request with the shared preamble and error mapping.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {(body: unknown) => unknown} operation
 */
async function handle(req, res, operation) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      throw new WebApiError(405, 'only POST is accepted on this endpoint');
    }
    assertTrustedRequest(req);
    const body = await readJsonBody(req);
    const value = operation(body);
    sendJson(res, 200, value);
  } catch (error) {
    const status = error instanceof WebApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

/**
 * Register the two routes. Call inside a plugin effect and return its disposer.
 * @param {{ register(route: { kind: 'exact', path: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void> }): () => void }} webServer
 */
export function installReviewApi(webServer) {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: REVIEW_ROUTE,
      handler: (req, res) => handle(req, res, (body) => reviewRequest(body)),
    }),
    webServer.register({
      kind: 'exact',
      path: REVERT_ROUTE,
      handler: (req, res) => handle(req, res, (body) => revertRequest(body)),
    }),
  ];
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
