// Content script entry, injected on seller origins only. Part c2b. A bundler entry point (part c2c).
const { createContent } = require('./lib/content-core');

const content = createContent({
  doc: document,
  send: (msg) => chrome.runtime.sendMessage(msg),
  extensionId: chrome.runtime.id,
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  content.onMessage(msg, sender);
});
content.start();
