import validateURL from "./ValidateURL.js";
import getDefaultChromePath from "./GetDefaultChromePath.js";
import getHomeDirectory from "./GetHomeDirectory.js";
import delay from "./delay.js";
import deleteTempUserDataFolders from "./DeleteTempUserDataFolders.js";
import findAvailablePort from "./FindAvailablePort.js";
import checkDebuggingEndpoint from "./CheckDebuggingEndpoint.js";
import killProcess from "./KillProcess.js";
import Solve from "./Solve.js";

// Separate library imports from module imports
import CDP from "chrome-remote-interface";
import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extensionPath = path.join(__dirname, "..", "extension");
const chromePaths = getDefaultChromePath();
const homedir = getHomeDirectory();

let chromium = null;

class CloudFreed {
  /**
   * Starts a CloudFreed Instance
   * @param {boolean|undefined} headless - Whether the instance should run in headless mode.
   * @param {boolean|undefined} proxyOverride
   */
  async start(headless, proxyOverride) {
    let chromeProcess;

    try {
      // Check if OS is valid
      if (!chromePaths || !homedir) {
        return {
          success: false,
          code: 500,
          errormessage: "Unsupported OS, please use darwin, linux, or windows.",
        };
      }

      // Check if Chrome/Edge is installed
      for (const path of chromePaths) {
        try {
          await fs.access(path);
          chromium = path;
          break;
        } catch (error) {
          continue;
        }
      }

      if (!chromium) {
        return {
          success: false,
          code: 500,
          errormessage:
            "Neither Google Chrome nor Microsoft Edge is installed on host server, please install one of them and try again.",
        };
      }

      const cloudflareBypassDir = path.join(homedir, "CloudFreed");
      await deleteTempUserDataFolders(
        path.join(cloudflareBypassDir, "DataDirs"),
      );

      // Find an available port
      const port = await findAvailablePort(10000, 60000);
      const random8DigitNumber = Math.floor(
        10000000 + Math.random() * 90000000,
      );
      const dataDir = path.join(
        cloudflareBypassDir,
        "DataDirs",
        `CloudFreed_${Date.now() + random8DigitNumber}`,
      );

      // Configure Chrome arguments
      const chromeArgs = [
        `--user-data-dir=${dataDir}`,
        "--no-sandbox",
        "--window-size=512,512",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--mute-audio",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-translate",
        "--disk-cache-size=0",
        "--disable-application-cache",
        "--disable-gpu",
        "--disable-features=CookiesWithoutSameSiteMustBeSecure",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-blink-features=AutomationControlled",
        "--lang=en",
        "--disable-sync",
        `--remote-debugging-port=${port}`,
        "--window-name=CloudFreed",
        "--ignore-certificate-errors",
        "--disable-infobars",
        `--app=file:///${path.join(__dirname, "..", "html", "CloudFreed.html")}`,
        // `file:///${path.join(__dirname, "..", "html", "CloudFreed.html")}`,
      ];

      if (headless === true) {
        chromeArgs.push("--headless=new");
      }

      // Launch Chrome in headless mode
      chromeProcess = spawn(chromium, chromeArgs, {
        detached: true,
        stdio: "ignore",
      });

      const pid = chromeProcess.pid;
      chromeProcess.unref();

      // Fetch Chrome version information
      const versionInfo = await checkDebuggingEndpoint(port);

      if (!versionInfo) {
        await killProcess(pid);
        return {
          success: false,
          code: 500,
          errormessage:
            "Error occurred on our side: VersionInfo could not be parsed from chrome. returned null.",
        };
      }

      // If WebSocket debugger URL is available, establish WebSocket connection
      if (versionInfo.webSocketDebuggerUrl && versionInfo["User-Agent"]) {
        let solving = false;
        const originalUserAgent = versionInfo["User-Agent"].includes("Headless")
          ? versionInfo["User-Agent"].replace("Headless", "")
          : versionInfo["User-Agent"];
        console.log(
          "Process started with " + originalUserAgent + " user agent",
        );
        const client = await CDP({ port });
        let target = null,
          extensionTarget = null,
          targetId,
          sessionId = null,
          extensionSessionId = null;

        for (let i = 0; i < 10; i++) {
          // Try up to 10 times
          const targets = (await client.Target.getTargets()).targetInfos;
          target = targets.find(
            (t) => t.type === "page" && t.title === "CloudFreed",
          );
          extensionTarget = targets.find(
            (t) => t.type === "service_worker" && !t.url.includes("neajdpp"),
          );

          if (target && extensionTarget) {
            break; // Exit the loop if the target is found
          }

          await delay(500); // Wait for 500ms before retrying
        }

        if (
          target &&
          extensionTarget &&
          target.targetId &&
          extensionTarget.targetId
        ) {
          targetId = target.targetId;
          const extensionTargetId = extensionTarget.targetId;
          extensionSessionId = (
            await client.Target.attachToTarget({
              targetId: extensionTargetId,
              flatten: true,
            })
          ).sessionId;
          sessionId = (
            await client.Target.attachToTarget({ targetId, flatten: true })
          ).sessionId;
        } else {
          return {
            success: false,
            code: 500,
            errormessage: "Error occurred while initializing.",
          };
        }

        await client.Network.enable();
        await client.DOM.enable(sessionId);
        await client.Log.enable(sessionId);
        await client.Network.setCacheDisabled({ cacheDisabled: true });
        await client.Emulation.setFocusEmulationEnabled(
          { enabled: true },
          sessionId,
        );

        let solve = new Solve(
          client,
          sessionId,
          originalUserAgent,
          extensionSessionId,
          proxyOverride,
        );

        return {
          success: true,
          code: 200,
          userAgent: originalUserAgent,
          webSocketDebuggerUrl: versionInfo.webSocketDebuggerUrl,
          port,

          /**
           * Solves CloudFlare Challenge.
           * @param {CDP.Client} client
           * @param {{url: string, type: string, sitekey: string|undefined, userAgent: string|undefined, action:string|undefined, proxy: {scheme: string, host: string, port: Number, username: string|undefined, password: string|undefined}}} data
           * @param {string} sessionId
           */
          Solve: async (data) => {
            try {
              if (solving === false) {
                if (typeof data === "object") {
                  if (data.url && typeof data.url === "string") {
                    if (data.type && typeof data.type === "string") {
                      solving = true;
                      data.originalUrl = data.url;
                      data.url = validateURL(data.url);
                      console.log("Solving " + data.url);

                      const timeoutSeconds = data.timeout || 60;

                      const solveWithTimeout = new Promise(
                        async (resolve, reject) => {
                          try {
                            const response = await solve.Solve(data);

                            await client.Page.navigate(
                              {
                                url: `file:///${path.join(__dirname, "..", "html", "CloudFreed.html")}`,
                              },
                              sessionId,
                            );

                            solving = false;

                            resolve(response);
                          } catch (error) {
                            solving = false;

                            resolve({
                              success: false,
                              code: 500,
                              errormessage:
                                "Error occurred while initializing.",
                              error,
                            });
                          }
                        },
                      );

                      const timeout = new Promise((resolve) => {
                        let elapsed = 0;

                        const interval = setInterval(async () => {
                          elapsed += 1;

                          // Use configurable timeout value
                          if (solving === false || elapsed >= timeoutSeconds) {
                            clearInterval(interval);

                            if (solving === true) {
                              try {
                                await client.Page.navigate(
                                  {
                                    url: `file:///${path.join(__dirname, "..", "html", "CloudFreed.html")}`,
                                  },
                                  sessionId,
                                );

                                solving = false;

                                resolve({
                                  success: false,
                                  code: 408,
                                  errormessage:
                                    `Request timed out after ${timeoutSeconds} seconds.`,
                                });
                              } catch (error) {
                                resolve({
                                  success: false,
                                  code: 408,
                                  errormessage:
                                    `Request timed out with an error after ${timeoutSeconds} seconds.`,
                                });
                              }
                            } else {
                              return; // Resolve immediately if solving became false before timeout
                            }
                          }
                        }, 1000); // Run every 1 second
                      });

                      // Use Promise.race to return whichever promise resolves first (response or timeout)
                      const result = await Promise.race([
                        solveWithTimeout,
                        timeout,
                      ]);

                      solving = false;

                      return result;
                    } else {
                      return {
                        success: false,
                        code: 400,
                        errormessage: `Invalid input: Expected data.type to be of type "string", but received "${typeof data.url}".`,
                      };
                    }
                  } else {
                    return {
                      success: false,
                      code: 400,
                      errormessage: `Invalid input: Expected data.url to be of type "string", but received "${typeof data.url}".`,
                    };
                  }
                } else {
                  return {
                    success: false,
                    code: 400,
                    errormessage: `Invalid input: Expected data to be of type "Object", but received "${typeof data}".`,
                  };
                }
              } else {
                return {
                  success: false,
                  code: 503,
                  errormessage: "Instance currently busy.",
                };
              }
            } catch (error) {
              return {
                success: false,
                code: 500,
                errormessage: "Error occurred while initializing.",
                error,
              };
            }
          },

          /**
           * Closes CloudFreed Instance.
           */
          Close: async () => {
            try {
              if (client) {
                client.close();
              }

              if (pid) {
                await killProcess(pid);
              }

              return {
                success: true,
                code: 200,
              };
            } catch {
              return {
                success: false,
                code: 500,
                errormessage: "Error occurred while closing.",
              };
            }
          },
        };
      }
    } catch (error) {
      if (chromeProcess) {
        killProcess(chromeProcess.pid);
        chromeProcess.kill();
      }

      return {
        success: false,
        code: 500,
        error,
        errormessage: `Error occurred on our side: ${error.message}`,
      };
    }
  }
}

export default CloudFreed;
