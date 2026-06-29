(function () {
  if (window.__FB_FRUSTRATED_CUSTOMERS_COLLECTOR_LOADED__) return;
  window.__FB_FRUSTRATED_CUSTOMERS_COLLECTOR_LOADED__ = true;

  const BLOCKED_PATTERNS = [
    /log in to facebook/i,
    /you must log in/i,
    /checkpoint/i,
    /security check/i,
    /confirm your identity/i,
    /captcha/i,
    /temporarily blocked/i,
    /you can't use this feature right now/i
  ];

  const NAVIGATION_TEXT_PATTERNS = [
    /^like$/i,
    /^comment$/i,
    /^share$/i,
    /^send$/i,
    /^join group$/i,
    /^view more comments$/i,
    /^see more$/i,
    /^most relevant$/i,
    /^all comments$/i
  ];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function simpleHash(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function isBlockedPage() {
    const pageText = normalizeText(document.body ? document.body.innerText : "");
    return BLOCKED_PATTERNS.find((pattern) => pattern.test(pageText)) || null;
  }

  function keywordMatches(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.filter((keyword) => lower.includes(String(keyword).toLowerCase()));
  }

  function getGroupUrl() {
    const match = window.location.href.match(/https:\/\/(?:www|web)\.facebook\.com\/groups\/[^/?#]+/i);
    return match ? match[0] : window.location.href.split("?")[0].split("#")[0];
  }

  function normalizeFacebookHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.origin);
      url.searchParams.delete("__cft__");
      url.searchParams.delete("__tn__");
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function extractLinks(root) {
    return unique(
      Array.from(root.querySelectorAll("a[href]"))
        .map((anchor) => normalizeFacebookHref(anchor.getAttribute("href")))
        .filter((href) => href.includes("/groups/"))
    ).slice(0, 8);
  }

  function extractBestLink(links) {
    return (
      links.find((href) => /\/posts\/|permalink|comment_id=|multi_permalinks=/.test(href)) ||
      links[0] ||
      window.location.href
    );
  }

  function extractAuthor(root) {
    const anchors = Array.from(root.querySelectorAll("a[role='link'], a[href]"));
    for (const anchor of anchors) {
      const text = normalizeText(anchor.textContent);
      const href = normalizeFacebookHref(anchor.getAttribute("href"));
      if (!text || text.length > 80) continue;
      if (NAVIGATION_TEXT_PATTERNS.some((pattern) => pattern.test(text))) continue;
      if (href.includes("/groups/") && !href.includes("user/") && !href.includes("profile.php")) continue;
      if (/^\d+[mhdw]$/.test(text)) continue;
      return text;
    }
    return "";
  }

  function extractTimestampText(text) {
    const match = text.match(/\b(?:just now|\d+\s*(?:m|h|d|w)|yesterday|today|mon|tue|wed|thu|fri|sat|sun)\b/i);
    return match ? match[0] : "";
  }

  function getCandidateRoots() {
    const articleRoots = Array.from(document.querySelectorAll("[role='article']"));
    if (articleRoots.length > 0) return articleRoots;

    return Array.from(document.querySelectorAll("[data-pagelet*='FeedUnit'], [aria-posinset]"));
  }

  function buildItem(root, keywords) {
    const text = normalizeText(root.innerText || root.textContent || "");
    if (text.length < 40) return null;

    const matches = keywordMatches(text, keywords);
    if (matches.length === 0 && !settingsDebugIncludeUnmatched(keywords)) return null;

    const links = extractLinks(root);
    const permalink = extractBestLink(links);
    const authorName = extractAuthor(root);
    const contentHash = simpleHash(`${getGroupUrl()}|${authorName}|${text.slice(0, 800)}`);

    return {
      contentHash,
      sourceUrl: window.location.href,
      groupUrl: getGroupUrl(),
      permalink,
      authorName,
      timestampText: extractTimestampText(text),
      matchedKeywords: matches,
      debugUnmatched: matches.length === 0,
      text,
      extractedAt: new Date().toISOString()
    };
  }

  function settingsDebugIncludeUnmatched(keywords) {
    return keywords && keywords.__debugIncludeUnmatched === true;
  }

  function scanVisible(settings) {
    const blockedPattern = isBlockedPage();
    if (blockedPattern) {
      return {
        ok: false,
        status: "blocked",
        reason: String(blockedPattern),
        url: window.location.href,
        items: []
      };
    }

    const keywords = Array.isArray(settings.keywords) ? settings.keywords.slice() : [];
    keywords.__debugIncludeUnmatched = Boolean(settings.debugIncludeUnmatched);
    const roots = getCandidateRoots();
    const seen = new Set();
    const items = [];

    for (const root of roots) {
      const item = buildItem(root, keywords);
      if (!item || seen.has(item.contentHash)) continue;
      seen.add(item.contentHash);
      items.push(item);
    }

    return {
      ok: true,
      status: "scanned",
      url: window.location.href,
      groupUrl: getGroupUrl(),
      articleCount: roots.length,
      pageTextLength: normalizeText(document.body ? document.body.innerText : "").length,
      items
    };
  }

  function previewVisible(settings) {
    const blockedPattern = isBlockedPage();
    if (blockedPattern) {
      return {
        ok: false,
        status: "blocked",
        reason: String(blockedPattern),
        url: window.location.href,
        previews: []
      };
    }

    const roots = getCandidateRoots();
    const bodyText = normalizeText(document.body ? document.body.innerText : "");
    const previews = roots.slice(0, Number(settings.previewLimit || 12)).map((root, index) => ({
      index,
      textLength: normalizeText(root.innerText || root.textContent || "").length,
      authorName: extractAuthor(root),
      links: extractLinks(root).slice(0, 3),
      text: normalizeText(root.innerText || root.textContent || "").slice(0, 900)
    }));

    return {
      ok: true,
      status: "previewed",
      url: window.location.href,
      groupUrl: getGroupUrl(),
      articleCount: roots.length,
      pageTextLength: bodyText.length,
      pageTextPreview: bodyText.slice(0, 1200),
      previews
    };
  }

  async function scanWithScroll(settings) {
    const maxScrolls = Math.max(0, Number(settings.maxScrolls || 0));
    const scrollDelayMs = Math.max(500, Number(settings.scrollDelayMs || 1600));
    const allItems = new Map();
    let lastResult = null;

    for (let index = 0; index <= maxScrolls; index += 1) {
      lastResult = scanVisible(settings);
      if (!lastResult.ok) return lastResult;

      for (const item of lastResult.items) {
        allItems.set(item.contentHash, item);
      }

      if (index < maxScrolls) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: "smooth" });
        await sleep(scrollDelayMs);
      }
    }

    return {
      ok: true,
      status: "scanned",
      url: window.location.href,
      groupUrl: getGroupUrl(),
      articleCount: lastResult ? lastResult.articleCount : 0,
      pageTextLength: lastResult ? lastResult.pageTextLength : 0,
      items: Array.from(allItems.values())
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "SCAN_VISIBLE") {
      sendResponse(scanVisible(message.settings || {}));
      return false;
    }

    if (message.type === "PREVIEW_VISIBLE") {
      sendResponse(previewVisible(message.settings || {}));
      return false;
    }

    if (message.type === "SCAN_WITH_SCROLL") {
      scanWithScroll(message.settings || {})
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            status: "error",
            reason: error && error.message ? error.message : String(error),
            url: window.location.href,
            items: []
          });
        });
      return true;
    }

    return false;
  });
})();
