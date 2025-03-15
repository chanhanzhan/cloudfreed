import https from "https";
import http from "http";
import Proxy from "./Proxy.js";
import zlib from "zlib";

const defaultHeaders = {
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  Priority: "u=0, i",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

/**
 * Makes an HTTP/HTTPS request with optional proxy support
 * @param {string} url - The URL to request
 * @param {string} method - HTTP method (GET, POST, etc)
 * @param {string} proxyUrl - Optional proxy URL
 * @param {Object} customHeaders - Optional additional headers
 * @param {number} maxSize - Maximum response size in bytes (default: 1MB)
 * @returns {Promise<{success: boolean, code: number, headers?: object, response?: string, status?: number, url?: string, error?: Error, errormessage?: string, truncated?: boolean}>}
 */
async function emuRequest(url, method = "GET", proxyUrl, customHeaders = {}, maxSize = 1024 * 1024) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const headers = {
        ...defaultHeaders,
        ...customHeaders, // Merge custom headers
      };

      let requestOptions = {
        method,
        headers,
        timeout: 30000,
      };

      // Configure proxy if provided
      if (proxyUrl) {
        let proxyConfig;
        if (proxyUrl.startsWith("socks")) {
          proxyConfig = { socks: proxyUrl };
        } else {
          const protocol = urlObj.protocol === "https:" ? "https" : "http";
          proxyConfig = {
            [protocol]: proxyUrl
          };
        }

        const proxy = new Proxy(proxyConfig);
        requestOptions.agent = proxy.getAgent();
      }

      const protocol = urlObj.protocol === "https:" ? https : http;

      const req = protocol.request(url, requestOptions, (res) => {
        const chunks = [];
        let totalSize = 0;
        let sizeLimitExceeded = false;

        res.on("data", (chunk) => {
          totalSize += chunk.length;
          if (totalSize <= maxSize) {
            chunks.push(chunk);
          } else if (!sizeLimitExceeded) {
            sizeLimitExceeded = true;
            console.warn(`Response size exceeded ${maxSize} bytes limit, data truncated`);
          }
        });

        res.on("end", () => {
          try {
            let buffer = Buffer.concat(chunks);

            // Handle different content encodings
            const encoding = res.headers["content-encoding"];
            if (encoding === "gzip") {
              buffer = zlib.gunzipSync(buffer);
            } else if (encoding === "deflate") {
              buffer = zlib.inflateSync(buffer);
            } else if (encoding === "br") {
              buffer = zlib.brotliDecompressSync(buffer);
            }

            // Get charset from Content-Type header
            let charset = "utf-8"; // default charset
            const contentType = res.headers["content-type"];
            if (contentType) {
              const charsetMatch = contentType.match(/charset=([^;]+)/i);
              if (charsetMatch) {
                charset = charsetMatch[1].toLowerCase();
              }
            }

            // Convert buffer to string using the correct charset
            const response = buffer.toString(charset);

            resolve({
              success: true,
              code: 200,
              headers: res.headers,
              response,
              status: res.statusCode,
              url: res.url || url,
              truncated: sizeLimitExceeded
            });
          } catch (error) {
            resolve({
              success: false,
              code: 500,
              error,
              errormessage: "Failed to process response",
            });
          }
        });
      });

      req.on("error", (error) => {
        resolve({
          success: false,
          code: 500,
          error,
          errormessage: error.code === "ABORT_ERR" ? "Proxy connection failed" : "Request failed",
        });
      });

      req.end();
    } catch (error) {
      resolve({
        success: false,
        code: 500,
        error,
        errormessage: "Failed to initialize request",
      });
    }
  });
}

export default emuRequest;
