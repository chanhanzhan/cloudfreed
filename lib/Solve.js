import delay from "./delay.js";
import { readFile } from "./fs.js";
import path from "path";
import emuRequest from "./emuRequest.js";
import getContent from "./getContent.js";
import { fileURLToPath } from "url";
import CDP from "chrome-remote-interface";
import ProxyAgent from './ProxyAgent.js';

const __dirname = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Load all required files asynchronously
const [cloudflareChallengeHTML, cloudflareInvisibleHTML, TurnstileHTML, recaptchaInvisibleHTML] =
  await Promise.all([
    readFile(path.join(__dirname, "html", "CloudflareChallenge.html")),
    readFile(path.join(__dirname, "html", "CloudflareInvisible.html")),
    readFile(path.join(__dirname, "html", "TurnstileChallenge.html")),
    readFile(path.join(__dirname, "html", "RecaptchaInvisible.html")),
  ]);

const blockResourceTypes = ["Image", "Font", "Stylesheet", "Other", "Media"];
const validTypes = [
  "CloudflareChallenge",
  "Turnstile",
  "CloudflareInvisible",
  "RecaptchaInvisible",
];

// Generate HTML templates with dynamic values
const generateCloudflareInvisibleHTML = (r, t) =>
  cloudflareInvisibleHTML.replace("![r]!", r).replace("![t]!", t);
const generateTurnstileHTML = (sitekey) =>
  TurnstileHTML.replace("![sitekey]!", sitekey);
const generateRecaptchaHTML = (sitekey, action) =>
  recaptchaInvisibleHTML.replace(/!\[sitekey\]!/g, sitekey).replace(
    "![action]!",
    action,
  );
const generateCloudflareChallengeHTML = (script) => cloudflareChallengeHTML.replace("![script]!", script);

class Solve {
  constructor(
    client,
    sessionId,
    originalUserAgent,
    extensionSessionId,
    proxyOverride,
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.originalUserAgent = originalUserAgent;
    this.extensionSessionId = extensionSessionId;
    this.proxyOverride = proxyOverride;

    this.resolve = undefined;
    this.proxyUrl = undefined;
    this.iframeBody = undefined;
    this.iframeURL = undefined;
    this.data = undefined;

    this.proxyAgent = null;

    this.continueRequest = async (listener, options = {}) => {
      try {
        if (options.rawResponse === undefined) {
        }

        await this.client.Network.continueInterceptedRequest(
          {
            interceptionId: listener.interceptionId,
            ...options,
          },
          this.sessionId,
        );
      } catch {}
    };

    this.getBody = async (listener) => {
      try {
        const body = await this.client.Network.getResponseBodyForInterception(
          { interceptionId: listener.interceptionId },
          this.sessionId,
        );
        return body.base64Encoded
          ? Buffer.from(body.body, "base64").toString("utf-8")
          : body.body;
      } catch {}
    };

    this.InterceptedChallenge = async (listener) => {
      try {
        if (listener.authChallenge) {
          if (!this.data.proxy.username || !this.data.proxy.password) {
            this.resolve?.({
              success: false,
              code: 500,
              data: this.data,
              errormessage:
                "Proxy Provided requires a Username & Password, request is missing one or more of these parameters.",
            });
            return;
          }

          await this.continueRequest(listener, {
            authChallengeResponse: {
              response: "ProvideCredentials",
              username: this.data.proxy.username,
              password: this.data.proxy.password,
            },
          });
          return;
        }

        if (blockResourceTypes.includes(listener.resourceType)) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 404 CloudFreed Stopped media\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
            ).toString("base64"),
          });
          return;
        }

        if (
          listener.request.url === this.data.url &&
          listener.responseHeaders
        ) {
          if (listener.request.method === "GET") {
            let body = await this.getBody(listener);
            if (body?.includes('<body class="no-js">')) {
              const string = body
                .split('<body class="no-js">')[1]
                .split("</body>")[0];
              let html = generateCloudflareChallengeHTML(string);

              await this.continueRequest(listener, {
                rawResponse: Buffer.from(
                  `HTTP/2 200 OK\r\nContent-Type: text/html\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Opener-Policy: same-origin\r\nContent-Length: 0\r\n\r\n${html}`,
                ).toString("base64"),
              });
              return;
            }

            await this.continueRequest(listener);
            return;
          }

          if (listener.request.method === "POST") {
            const t = Buffer.from(
              Math.floor(Date.now() / 1000).toString() + ".000000",
            ).toString("base64");
            const r = listener.responseHeaders["cf-ray"].split("-")[0]
              ? listener.responseHeaders["cf-ray"].split("-")[0]
              : "";
            await this.continueRequest(listener, {
              rawResponse: Buffer.from(
                `HTTP/2 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\n\r\n${generateCloudflareInvisibleHTML(r, t)}`,
              ).toString("base64"),
            });
            return;
          }
        }

        await this.continueRequest(listener);
      } catch (error) {
        console.log(error);
        // Resolve errors silently
      }
    };

    this.InterceptedTurnstile = async (listener) => {
      try {
        if (listener.responseHeaders) {
          await this.continueRequest(listener);
        }

        if (listener.authChallenge) {
          if (!this.data?.proxy?.username || !this.data?.proxy?.password) {
            this.resolve?.({
              success: false,
              code: 500,
              data: this.data,
              errormessage:
                "Proxy Provided requires a Username & Password, request is missing one or more of these parameters.",
            });
            return;
          }

          await this.continueRequest(listener, {
            authChallengeResponse: {
              response: "ProvideCredentials",
              username: this.data.proxy.username,
              password: this.data.proxy.password,
            },
          });
          return;
        }

        if (blockResourceTypes.includes(listener.resourceType)) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 404 CloudFreed Stopped media\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
            ).toString("base64"),
          });
          return;
        }

        if (listener.request.url === this.data.url) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\n\r\n" +
                generateTurnstileHTML(this.data.sitekey),
            ).toString("base64"),
          });
          return;
        }

        if (
          listener.request.url === "https://internals.cloudfreed.com/turnstile"
        ) {
          if (listener.request.method === "OPTIONS") {
            await this.continueRequest(listener, {
              rawResponse: Buffer.from(
                "HTTP/2 204 No Content\r\nAllow: POST, OPTIONS\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\n\r\n",
              ).toString("base64"),
            });
            return;
          }

          await this.continueRequest(listener);

          this.resolve?.({
            success: true,
            code: 200,
            data: this.data,
            response: listener.request.postData,
          });
          return;
        }

        await this.continueRequest(listener);
      } catch (error) {
        console.error(error);
        // Resolve errors silently
      }
    };

    this.InterceptedInvisible = async (listener) => {
      try {
        if (listener.authChallenge) {
          if (!this.data?.proxy?.username || !this.data?.proxy?.password) {
            this.resolve?.({
              success: false,
              code: 500,
              data: this.data,
              errormessage:
                "Proxy Provided requires a Username & Password, request is missing one or more of these parameters.",
            });
            return;
          }

          await this.continueRequest(listener, {
            authChallengeResponse: {
              response: "ProvideCredentials",
              username: this.data.proxy.username,
              password: this.data.proxy.password,
            },
          });
          return;
        }

        if (blockResourceTypes.includes(listener.resourceType)) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 404 CloudFreed Stopped media\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
            ).toString("base64"),
          });
          return;
        }

        if (
          listener.request.url === this.data.url &&
          listener.responseHeaders
        ) {
          const t = Buffer.from(
            Math.floor(Date.now() / 1000).toString() + ".000000",
          ).toString("base64");
          const r = listener.responseHeaders["cf-ray"].split("-")[0]
            ? listener.responseHeaders["cf-ray"].split("-")[0]
            : "";

          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              `HTTP/2 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\n\r\n${generateCloudflareInvisibleHTML(r, t)}`,
            ).toString("base64"),
          });
        }

        await this.continueRequest(listener);
      } catch (error) {
        // Resolve errors silently
      }
    };

    this.InterceptedRecaptchaInvisible = async (listener) => {
      try {
        if (listener.responseHeaders) {
          await this.continueRequest(listener);
        }

        if (listener.authChallenge) {
          if (!this.data?.proxy?.username || !this.data?.proxy?.password) {
            this.resolve?.({
              success: false,
              code: 500,
              data: this.data,
              errormessage:
                "Proxy Provided requires a Username & Password, request is missing one or more of these parameters.",
            });
            return;
          }

          await this.continueRequest(listener, {
            authChallengeResponse: {
              response: "ProvideCredentials",
              username: this.data.proxy.username,
              password: this.data.proxy.password,
            },
          });
          return;
        }

        if (blockResourceTypes.includes(listener.resourceType)) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
            ).toString("base64"),
          });
          return;
        }

        if (listener.request.url === this.data.url) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\n\r\n" +
                generateRecaptchaHTML(this.data.sitekey, this.data.action),
            ).toString("base64"),
          });
          return;
        }

        if (
          listener.request.url === "https://internals.cloudfreed.com/turnstile"
        ) {
          if (listener.request.method === "OPTIONS") {
            await this.continueRequest(listener, {
              rawResponse: Buffer.from(
                "HTTP/2 204 No Content\r\nAllow: POST, OPTIONS\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\n\r\n",
              ).toString("base64"),
            });
            return;
          }

          await this.continueRequest(listener);

          this.resolve?.({
            success: true,
            code: 200,
            data: this.data,
            response: listener.request.postData,
          });
          return;
        }

        await this.continueRequest(listener);
      } catch (error) {
        console.error(error);
        // Resolve errors silently
      }
    };

    this.Intercepted = async (listener) => {
      try {
        if (blockResourceTypes.includes(listener.resourceType)) {
          await this.continueRequest(listener, {
            rawResponse: Buffer.from(
              "HTTP/2 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
            ).toString("base64"),
          });

          return;
        }

        if (typeof this.data?.type !== "string") {
          await this.continueRequest(listener);

          return;
        }

        switch (this.data.type) {
          case "CloudflareChallenge":
            this.InterceptedChallenge(listener);
            break;
          case "Turnstile":
            this.InterceptedTurnstile(listener);
            break;
          case "CloudflareInvisible":
            this.InterceptedInvisible(listener);
            break;
          case "RecaptchaInvisible":
            this.InterceptedRecaptchaInvisible(listener);
            break;
          default:
            this.continueRequest(listener);
        }
      } catch (error) {
        console.error(error);
      }
    };

    this.Extra = async (response) => {
      try {
        const setCookieHeader = response.headers["set-cookie"];

        // Check and log Set-Cookie headers
        if (
          setCookieHeader &&
          response.headers["content-length"] === "0" &&
          setCookieHeader.includes("cf_clearance") &&
          setCookieHeader.includes("\n")
        ) {
          const cookie = setCookieHeader.split("\n")[1];
          const cfClearance = cookie.match(/cf_clearance=([^;]+)/)?.[1];

          if (this.data?.content) {
            const content = await getContent(this.data.originalUrl, this.proxyUrl, cfClearance, this.data.userAgent);
            this.resolve?.({
              success: true,
              code: 200,
              response: cfClearance,
              data: this.data,
              content: content,
            });
          } else {
            this.resolve?.({
              success: true,
              code: 200,
              response: cfClearance,
              data: this.data,
            });
          }
          return;
        }
      } catch (error) {
        console.error(error);
        // Resolve errors silently
      }
    };

    this.client.Network.requestIntercepted(
      (listener) => this.Intercepted?.(listener),
      this.sessionId,
    );
    this.client.Network.responseReceivedExtraInfo(
      (response) => this.Extra?.(response),
      this.sessionId,
    );
    this.client.Network.setRequestInterception(
      {
        patterns: [
          { urlPattern: "*" },
          { urlPattern: "*", interceptionStage: "HeadersReceived" },
        ],
      },
      this.sessionId,
    );
  }

  /**
   * @param {CDP.Client} client
   * @param {Object} data
   * @param {string} data.url - The URL to request.
   * @param {string} data.type - The request type (e.g., GET, POST).
   * @param {string|undefined} data.sitekey - The site key, if applicable.
   * @param {string|undefined} data.userAgent - The User-Agent string to use, if applicable.
   * @param {{ scheme:string, host:string, port:number, username:string|undefined, password:string|undefined }} data.proxy - The proxy configuration object, if applicable.
   * @param {string} sessionId
   * @param {string} originalUserAgent
   * @param {string} extensionSessionId
   * @param {boolean} proxyOverride
   */
  async Solve(data, client) {
    return new Promise(async (resolve, reject) => {
      try {
        if (
          typeof this.client !== "object" ||
          typeof data !== "object" ||
          typeof this.sessionId !== "string" ||
          !validTypes.includes(data.type) ||
          !data.url ||
          typeof data.url !== "string"
        ) {
          resolve({
            success: false,
            code: 500,
            errormessage:
              "Solve function received invalid parameters, please contact a dev.",
          });
          return;
        }

        if (typeof data.userAgent !== "string") {
          data.userAgent = this.originalUserAgent;
        }

        // Handle proxy setup with authentication
        if (data.proxy?.username && data.proxy?.password) {
          // Initialize and start ProxyAgent if proxy has auth
          this.proxyAgent = new ProxyAgent(
            `${data.proxy.scheme}://${data.proxy.username}:${data.proxy.password}@${data.proxy.host}:${data.proxy.port}`
          );
          const localPort = await this.proxyAgent.start();
          
          // Update proxy URL to use local proxy agent without auth
          this.proxyUrl = `http://127.0.0.1:${localPort}`;
        } else {
          // Use direct proxy URL if no auth
          this.proxyUrl = data.proxy?.scheme && data.proxy?.host && data.proxy?.port
            ? `${data.proxy.scheme}://${data.proxy.host}:${data.proxy.port}`
            : undefined;
        }

        if (
          typeof data.proxy === "object" &&
          typeof data.proxy.scheme === "string" &&
          typeof data.proxy.host === "string" &&
          typeof data.proxy.port === "number" &&
          data.proxy.port > 0
        ) {
          const payload = { proxy: data.proxy, userAgent: data.userAgent };
          await this.client.Runtime.evaluate(
            {
              expression: `consoleMessageHandler(${JSON.stringify({ type: "modifyData", data: payload })});`,
            },
            this.extensionSessionId,
          );

          await delay(100);
        } else if (data.proxy === undefined) {
          await this.client.Runtime.evaluate(
            {
              expression: `consoleMessageHandler(${JSON.stringify({ type: "modifyData", data: { userAgent: data.userAgent } })});`,
            },
            this.extensionSessionId,
          );

          await delay(100);
        } else {
          resolve({
            success: false,
            code: 500,
            errormessage:
              "Proxy entered is invalid, please check your parameters and try again.",
          });
          return;
        }

        this.resolve = resolve;
        this.data = data;

        await this.client.Network.clearBrowserCookies(this.sessionId);
        await this.client.Emulation.setUserAgentOverride(
          { userAgent: data.userAgent },
          this.sessionId,
        );
        await this.client.Network.enable(this.sessionId);

        if (data.type === "CloudflareChallenge") {
          if (
            this.proxyOverride !== true &&
            (!data.proxy ||
              !data.proxy.scheme ||
              !data.proxy.host ||
              typeof data.proxy.port !== "number")
          ) {
            resolve({
              success: false,
              code: 500,
              errormessage:
                "A Proxy is required for this type of solve, please enter a proxy into your request and try again.",
            });
            return;
          }

          // Construct headers if user agent is provided
          const headers = data.userAgent 
            ? { "User-Agent": data.userAgent }
            : {};

          // Perform the HTTP request
          let html = await emuRequest(data.url, "GET", this.proxyUrl, headers, 1024 * 1024);

          if (!html.success) {
            resolve({
              success: false,
              code: html.code,
              cerror: html.err ? html.err : undefined,
              error: html.error ? html.error : undefined,
              errormessage: html.errormessage
                ? html.errormessage
                : "Unknown error occurred, please contact a dev.",
            });
            return;
          }

          if (html.redirected) {
            resolve({
              success: false,
              code: 400,
              cerror: html.err ? html.err : undefined,
              errormessage:
                "Given URL leads to a redirect, please enter a URL that returns a cloudflare challenge.",
            });
            return;
          }

          if (
            typeof html !== "object" ||
            typeof html.response !== "string" ||
            html.status !== 403 ||
            !html.response.includes('<body class="no-js">')
          ) {
            resolve({
              success: false,
              code: 400,
              cerror: html.err ? html.err : undefined,
              errormessage: `Failed to find Cloudflare challenge. Check the URL or proxy. (${html.status}) (${html.response})`,
            });
            return;
          }

          await this.client.Page.navigate({ url: data.url }, this.sessionId);
        }

        if (data.type === "Turnstile") {
          await this.client.Page.navigate({ url: data.url }, this.sessionId);
        }

        if (data.type === "CloudflareInvisible") {
          if (
            this.proxyOverride !== true &&
            (!data.proxy ||
              !data.proxy.scheme ||
              !data.proxy.host ||
              typeof data.proxy.port !== "number")
          ) {
            resolve({
              success: false,
              code: 500,
              errormessage:
                "A Proxy is required for this type of solve, please enter a proxy into your request and try again.",
            });
            return;
          }

          await this.client.Page.navigate({ url: data.url }, this.sessionId);
        }

        if (data.type === "RecaptchaInvisible") {
          if (typeof data.action !== "string") {
            resolve({
              success: false,
              code: 400,
              errormessage:
                "An action parameter is required for this type of solve, please enter an action into your request and try again.",
            });
            return;
          }

          await this.client.Page.navigate({ url: data.url }, this.sessionId);
        }

        // Add cleanup in case of errors
        try {
          await this.client.Page.navigate({ url: data.url }, this.sessionId);
        } catch (error) {
          this.proxyAgent?.stop();
          throw error;
        }
      } catch (error) {
        this.proxyAgent?.stop(); // Clean up proxy agent on error
        resolve({
          success: false,
          code: 500,
          errormessage: "An error occurred on our side. Please check your request or try again later.",
          error,
        });
        return;
      }
    });
  }
}

export default Solve;
