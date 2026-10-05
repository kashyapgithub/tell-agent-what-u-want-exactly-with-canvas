/**
 * background.js
 * --------------------------------------------------------------------------
 * Minimal MV3 service worker. The editor needs real screen space (it's a
 * drawing canvas, not a popup-sized tool), so clicking the extension icon
 * opens it as a full browser tab instead of a small popup window.
 * --------------------------------------------------------------------------
 */

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("editor/editor.html") });
});
