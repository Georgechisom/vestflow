// Issue #1058: gzip/brotli compression middleware for all API responses
// Compresses responses > 1KB with gzip or brotli based on client's Accept-Encoding

import { Request, Response, NextFunction } from 'express';
import * as zlib from 'zlib';
import { Transform } from 'stream';

export interface CompressionConfig {
  /** Minimum response size to compress (bytes) */
  threshold?: number;
  /** Compression level for gzip (0-9) */
  gzipLevel?: number;
  /** Compression level for brotli (0-11) */
  brotliLevel?: number;
  /** Content types to compress */
  filter?: (req: Request, res: Response) => boolean;
}

const DEFAULT_CONFIG: Required<CompressionConfig> = {
  threshold: 1024, // 1KB
  gzipLevel: 6, // Balanced compression
  brotliLevel: 4, // Balanced compression
  filter: defaultFilter,
};

/**
 * Default filter for compressible content types
 */
function defaultFilter(req: Request, res: Response): boolean {
  const contentType = res.getHeader('Content-Type');

  if (!contentType) {
    return false;
  }

  const type = String(contentType).toLowerCase();

  // Compress text-based content
  return (
    type.includes('text/') ||
    type.includes('application/json') ||
    type.includes('application/javascript') ||
    type.includes('application/xml') ||
    type.includes('+json') ||
    type.includes('+xml')
  );
}

/**
 * Parse Accept-Encoding header
 */
function parseAcceptEncoding(header: string | undefined): {
  gzip: boolean;
  brotli: boolean;
  preferBrotli: boolean;
} {
  if (!header) {
    return { gzip: false, brotli: false, preferBrotli: false };
  }

  const encodings = header.toLowerCase().split(',').map((s) => s.trim());

  const gzip = encodings.some((e) => e.startsWith('gzip'));
  const brotli = encodings.some((e) => e.startsWith('br'));

  // Prefer brotli if both are supported (brotli has better compression)
  const preferBrotli = brotli && gzip;

  return { gzip, brotli, preferBrotli };
}

/**
 * Compression middleware
 * 
 * Compresses API responses when:
 * - Response size > threshold (default 1KB)
 * - Client accepts gzip or brotli encoding
 * - Content type is compressible (text, json, etc.)
 * 
 * Features:
 * - Brotli preferred over gzip when both are supported
 * - Configurable compression levels
 * - Configurable size threshold
 * - Content-type filtering
 * 
 * Usage:
 * ```
 * import { compressionMiddleware } from './middleware/compression';
 * 
 * app.use(compressionMiddleware());
 * ```
 */
export function compressionMiddleware(config: CompressionConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if already compressed
    if (res.getHeader('Content-Encoding')) {
      return next();
    }

    // Parse client's Accept-Encoding header
    const acceptEncoding = parseAcceptEncoding(req.header('Accept-Encoding'));

    // Skip if client doesn't support compression
    if (!acceptEncoding.gzip && !acceptEncoding.brotli) {
      return next();
    }

    // Store original methods
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    let chunks: Buffer[] = [];
    let totalSize = 0;

    // Override write method to collect chunks
    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        totalSize += buffer.length;
      }
      return true;
    };

    // Override end method to compress if needed
    res.end = function (chunk?: any, ...args: any[]): Response {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        totalSize += buffer.length;
      }

      // Check if should compress
      const shouldCompress =
        totalSize >= mergedConfig.threshold &&
        mergedConfig.filter(req, res) &&
        (acceptEncoding.gzip || acceptEncoding.brotli);

      if (!shouldCompress) {
        // Send uncompressed
        chunks.forEach((buf) => originalWrite(buf));
        return originalEnd();
      }

      // Combine chunks
      const data = Buffer.concat(chunks);

      // Choose compression algorithm
      const useBrotli = acceptEncoding.preferBrotli || acceptEncoding.brotli;

      if (useBrotli) {
        // Use brotli compression
        zlib.brotliCompress(
          data,
          {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: mergedConfig.brotliLevel,
            },
          },
          (err, compressed) => {
            if (err) {
              console.error('Brotli compression error:', err);
              // Fall back to uncompressed
              chunks.forEach((buf) => originalWrite(buf));
              return originalEnd();
            }

            res.setHeader('Content-Encoding', 'br');
            res.setHeader('Content-Length', compressed.length);
            res.removeHeader('Content-Length'); // Let node calculate it
            originalWrite(compressed);
            originalEnd();
          },
        );
      } else if (acceptEncoding.gzip) {
        // Use gzip compression
        zlib.gzip(
          data,
          { level: mergedConfig.gzipLevel },
          (err, compressed) => {
            if (err) {
              console.error('Gzip compression error:', err);
              // Fall back to uncompressed
              chunks.forEach((buf) => originalWrite(buf));
              return originalEnd();
            }

            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', compressed.length);
            res.removeHeader('Content-Length'); // Let node calculate it
            originalWrite(compressed);
            originalEnd();
          },
        );
      } else {
        // No compression
        chunks.forEach((buf) => originalWrite(buf));
        originalEnd();
      }

      return res;
    };

    next();
  };
}

/**
 * Stream-based compression middleware (for large responses)
 * 
 * More memory efficient for large responses as it compresses on the fly
 * rather than buffering the entire response.
 */
export function streamCompressionMiddleware(config: CompressionConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if already compressed
    if (res.getHeader('Content-Encoding')) {
      return next();
    }

    // Parse client's Accept-Encoding header
    const acceptEncoding = parseAcceptEncoding(req.header('Accept-Encoding'));

    // Skip if client doesn't support compression
    if (!acceptEncoding.gzip && !acceptEncoding.brotli) {
      return next();
    }

    // Check if should compress based on content type
    const shouldCompress = mergedConfig.filter(req, res);

    if (!shouldCompress) {
      return next();
    }

    // Store original write method
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    let compressionStream: Transform;
    let firstChunk = true;

    // Choose compression algorithm
    const useBrotli = acceptEncoding.preferBrotli || acceptEncoding.brotli;

    if (useBrotli) {
      compressionStream = zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: mergedConfig.brotliLevel,
        },
      });
      res.setHeader('Content-Encoding', 'br');
    } else if (acceptEncoding.gzip) {
      compressionStream = zlib.createGzip({
        level: mergedConfig.gzipLevel,
      });
      res.setHeader('Content-Encoding', 'gzip');
    } else {
      return next();
    }

    // Remove Content-Length header (will be different after compression)
    res.removeHeader('Content-Length');

    // Pipe compressed data to response
    compressionStream.on('data', (chunk) => {
      originalWrite(chunk);
    });

    compressionStream.on('end', () => {
      originalEnd();
    });

    // Override write to pipe through compression
    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk) {
        compressionStream.write(chunk);
      }
      return true;
    };

    // Override end to finish compression
    res.end = function (chunk?: any, ...args: any[]): Response {
      if (chunk) {
        compressionStream.write(chunk);
      }
      compressionStream.end();
      return res;
    };

    next();
  };
}

/**
 * Compression statistics middleware
 * Adds compression ratio to response headers
 */
export function compressionStatsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalEnd = res.end.bind(res);
    let originalSize = 0;

    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        originalSize += buffer.length;
      }
      return (res.write as any).call(this, chunk, ...args);
    };

    res.end = function (chunk?: any, ...args: any[]): Response {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        originalSize += buffer.length;
      }

      const compressedSize = parseInt(res.getHeader('Content-Length') as string, 10);

      if (compressedSize && originalSize) {
        const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
        res.setHeader('X-Compression-Ratio', `${ratio}%`);
        res.setHeader('X-Original-Size', originalSize);
      }

      return originalEnd(chunk, ...args);
    };

    next();
  };
}
