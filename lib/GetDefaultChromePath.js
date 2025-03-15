import os from "os";

function getDefaultChromePath() {
  const platform = os.platform();
  const paths = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: [
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/microsoft-edge",
    ],
  };
  
  const result = paths[platform] || null;
  console.log("Default browser path:", result);
  return result;
}

export default getDefaultChromePath;