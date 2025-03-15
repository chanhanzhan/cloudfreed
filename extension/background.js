const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const solverState = new Set();

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "interactiveBegin" && sender.tab) {
    console.log(
      `[Service Worker] Received start request for tab ${sender.tab.id}`,
    );

    solverState.add(sender.tab.id);

    try {
      await attachDebuggerToTab(sender.tab.id);
    } catch (error) {
      console.error(
        `[Service Worker] Failed to attach debugger for tab ${sender.tab.id}:`,
        error,
      );
    }
  }

  if (message.action === "interactiveEnd" && sender.tab) {
    console.log(`[Service Worker] Stopping solver for tab ${sender.tab.id}`);
    stopSolver(sender.tab.id);
  }
});

async function attachDebuggerToTab(tabId) {
  return new Promise((resolve) => {
    const client = {
      send: (command, params) => {
        return new Promise((resolve, reject) => {
          chrome.debugger.sendCommand(
            { tabId },
            command,
            params || {},
            (result) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
              } else {
                resolve(result);
              }
            },
          );
        });
      },
    };

    chrome.debugger.attach({ tabId }, "1.3", async () => {
      if (chrome.runtime.lastError) {
        console.log(
          `Error attaching debugger to tab ${tabId}:`,
          chrome.runtime.lastError.message,
        );
        resolve();
        return;
      }

      console.log(`[Service Worker] Debugger attached to tab: ${tabId}`);

      await client.send("DOM.enable");
      await client.send("Page.enable");
      await client.send("Emulation.setFocusEmulationEnabled", {
        enabled: true,
      });

      await Solver(client, tabId);
      resolve();
    });
  });
}

function stopSolver(tabId) {
  if (solverState.has(tabId)) {
    console.log(`[Service Worker] Solver stop requested for tab ${tabId}`);
    solverState.delete(tabId);
  }
}

async function Solver(client, tabId) {
  while (true) {
    if (!solverState.has(tabId)) {
      console.log(`[Service Worker] Solver for tab ${tabId} is stopping.`);
      break;
    }

    try {
      await delay(500);

      const { nodes } = await client.send("DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true,
      });

      const turnstileNode = nodes.find(
        (node) =>
          node.nodeName === "IFRAME" &&
          node.attributes?.includes(
            "Widget containing a Cloudflare security challenge",
          ),
      );

      if (!turnstileNode) {
        continue;
      }

      const location = await client.send("DOM.getBoxModel", {
        nodeId: turnstileNode.nodeId,
      });
      const [x1, y1, x2, y2, x3, y3, x4, y4] = location.model.content;

      const x = (x1 + x3) / 2 - ((x1 + x3) / 2 - x1) / 2;
      const y = (y1 + y3) / 2;

      await delay(500);

      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });

      await delay(10);

      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });

      await delay(10);

      await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });

      console.log(
        `[Service Worker] Cloudflare turnstile clicked for tab ${tabId}!`,
      );
    } catch (error) {
      console.log(
        `[Service Worker] Error solving Cloudflare challenge on tab ${tabId}:`,
        error,
      );

      if (error.includes("No tab with given id ")) {
        stopSolver(tabId);
        return;
      }

      if (error.includes("Debugger is not attached to the tab with id: ")) {
        let id = String(error).split(
          "Debugger is not attached to the tab with id: ",
        )[1];
        attachDebuggerToTab(parseInt(id));
        return;
      }
    }
  }

  chrome.debugger.detach({ tabId }, () => {
    if (chrome.runtime.lastError) {
      console.log(
        `[Service Worker] Error detaching debugger from tab ${tabId}:`,
        chrome.runtime.lastError.message,
      );
    } else {
      console.log(`[Service Worker] Debugger detached from tab ${tabId}.`);
    }
  });
}

async function setUserAgentOverride(userAgent) {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1], // Remove any existing rule with ID 1
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "User-Agent",
              operation: "set",
              value: userAgent,
            },
          ],
        },
        condition: {
          resourceTypes: ALL_RESOURCE_TYPES,
          urlFilter: "*",
        },
      },
    ],
  });
}

// Function to update proxy settings
function updateProxy(proxyConfig) {
  if (
    !proxyConfig ||
    typeof proxyConfig.scheme !== "string" ||
    typeof proxyConfig.host !== "string" ||
    typeof proxyConfig.port !== "number"
  ) {
    console.error("Invalid proxy configuration:", JSON.stringify(proxyConfig));
    return;
  }

  chrome.proxy.settings.set(
    {
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: proxyConfig.scheme,
            host: proxyConfig.host,
            port: parseInt(proxyConfig.port, 10),
          },
        },
      },
      scope: "regular",
    },
    () => {
      console.log("Proxy updated to:", proxyConfig);
    },
  );
}

function clearProxy() {
  chrome.proxy.settings.clear({}, function () {
    if (chrome.runtime.lastError) {
      console.error("Error clearing proxy settings:", chrome.runtime.lastError);
    } else {
      console.log("Proxy settings cleared successfully.");
    }
  });
}

self.consoleMessageHandler = (message) => {
  console.log(
    "Received message from DevTools console:",
    JSON.stringify(message),
  );

  if (
    typeof message === "object" &&
    message.data &&
    message.type === "modifyData"
  ) {
    if (message.data.userAgent) {
      setUserAgentOverride(message.data.userAgent);
    }
    if (message.data.proxy) {
      updateProxy(message.data.proxy);
    } else {
      clearProxy();
    }
  }
};
