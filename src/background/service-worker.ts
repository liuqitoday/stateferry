type PingMessage = { type: 'PING' };

chrome.runtime.onMessage.addListener((message: PingMessage, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
  }
});

