const allowedOrigins = [
  "https://challenges.cloudflare.com",
  "http://challenges.cloudflare.com",
];
const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

let screenX = getRandomInt(800, 1200);
let screenY = getRandomInt(400, 600);

Object.defineProperty(MouseEvent.prototype, "screenX", { value: screenX });
Object.defineProperty(MouseEvent.prototype, "screenY", { value: screenY });

function handleMessage(event) {
  if (
    event.source !== window &&
    event.origin &&
    event.data?.event &&
    allowedOrigins.includes(event.origin)
  ) {
    if (
      event.data.event == "interactiveBegin" ||
      event.data.event == "interactiveEnd"
    ) {
      chrome.runtime.sendMessage({ action: event.data.event });
    }
  }
}

window.addEventListener("message", handleMessage);

// FOR TESTING
// window.onbeforeunload = function(){ return 'Leave page?'; };