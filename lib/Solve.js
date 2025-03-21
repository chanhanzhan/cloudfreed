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

// 异步加载所有必要的 HTML 文件
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

// 生成动态 HTML 模板的函数
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
    config,
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.originalUserAgent = originalUserAgent;
    this.extensionSessionId = extensionSessionId;
    this.proxyOverride = proxyOverride;

    this.config = config;

    this.resolve = undefined;
    this.proxyUrl = undefined;
    this.iframeBody = undefined;
    this.iframeURL = undefined;
    this.data = undefined;

    this.proxyAgent = null;

    this.continueRequest = async (listener, options = {}) => {
      try {
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
      } catch (error) {}
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
        if (setCookieHeader && setCookieHeader.includes("cf_clearance")) {
          const cookies = setCookieHeader.split("\n");
          for (const cookie of cookies) {
            if (cookie.startsWith("cf_clearance=")) {
              const cfClearance = cookie.split(";")[0].split("=")[1];
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
          }
        }
      } catch (error) {
        console.error(error);
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

  async Solve(data, client) {
    return new Promise(async (resolve, reject) => {
      try {
        // 重写 resolve 函数以确保在解析时清理代理
        const originalResolve = resolve;
        resolve = (result) => {
          this.proxyAgent?.stop();
          originalResolve(result);
        };

        // 参数校验
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

        // 处理代理设置
        if (data.proxy?.username && data.proxy?.password) {
          this.proxyAgent = new ProxyAgent(
            `${data.proxy.scheme}://${data.proxy.username}:${data.proxy.password}@${data.proxy.host}:${data.proxy.port}`
          );
          const localPort = await this.proxyAgent.start();
          this.proxyUrl = `http://127.0.0.1:${localPort}`;
        } else {
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

          await this.client.Page.navigate({ url: data.url }, this.sessionId);

          // 设置每秒检查 cookie 的间隔
          const cookieCheckInterval = setInterval(async () => {
            try {
              const cookies = await this.client.Network.getCookies({ urls: [data.url] }, this.sessionId);
              const cfClearanceCookie = cookies.cookies.find(cookie => cookie.name === "cf_clearance");
              if (cfClearanceCookie) {
                const cfClearance = cfClearanceCookie.value;
                clearInterval(cookieCheckInterval);
                clearTimeout(timeoutId);
                if (this.data?.content) {
                  const content = await getContent(this.data.originalUrl, this.proxyUrl, cfClearance, this.data.userAgent);
                  resolve({
                    success: true,
                    code: 200,
                    response: cfClearance,
                    data: this.data,
                    content: content,
                  });
                } else {
                  resolve({
                    success: true,
                    code: 200,
                    response: cfClearance,
                    data: this.data,
                  });
                }
              }
            } catch (error) {
              console.error("检查 cookie 时出错:", error);
            }
          }, 1000);

          // 设置 30 秒超时
          const timeoutId = setTimeout(() => {
            clearInterval(cookieCheckInterval);
            resolve({
              success: false,
              code: 408,
              errormessage: `超时: 在 ${this.data.timeout} 秒内未能获取 cf_clearance cookie。`,
            });
          }, this.data.timeout * 1000);
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
      } catch (error) {
        this.proxyAgent?.stop();
        resolve({
          success: false,
          code: 500,
          errormessage: "服务器端发生错误。请检查您的请求或稍后重试。",
          error,
        });
      }
    });
  }
}

export default Solve;