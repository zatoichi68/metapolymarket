// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log('PolyTrader Edge installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPDATE_BADGE') {
    const count = request.count;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString(), tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#00fa9a', tabId: sender.tab.id }); // Vert SpringGreen
      chrome.action.setBadgeTextColor({ color: '#000000', tabId: sender.tab.id });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
    }
  }
});
