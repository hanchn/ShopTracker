// cross-tracker-sdk.js
(function (global) {
  const DEFAULT_CONFIG = {
    server: '',
    projectId: '',
    debug: false,
    autoTrackPage: true,
    userId: null,
    forwardPipelines: [],
    flushInterval: 500,
    flushMaxBatch: 20,
    trackLogSwitch: false,
    asyncContextResolver: null,
  };

  let config = {};
  let queue = [];
  let anonymousId = '';
  let flushTimer = null;
  let globalContext = {};

  const interactionRegistry = {};

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getAnonymousId() {
    let id = localStorage.getItem('_cross_anonymous_id');
    if (!id) {
      id = generateUUID();
      localStorage.setItem('_cross_anonymous_id', id);
    }
    return id;
  }

  function parseBrowserVersion(ua) {
    const match = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/);
    return match ? `${match[1]} ${match[2]}` : 'unknown';
  }

  function getActiveDeviceInfo() {
    const ua = navigator.userAgent;
    const paintEntries = performance.getEntriesByType('paint');
    const firstPaint = paintEntries.find(e => e.name === 'first-paint')?.startTime || 0;
    const firstContentfulPaint = paintEntries.find(e => e.name === 'first-contentful-paint')?.startTime || 0;
    const connection = navigator.connection || {};
    let referrerDomain = '';
    try {
      referrerDomain = new URL(document.referrer).hostname;
    } catch (e) {}

    return {
      uuid: anonymousId,
      timestamp: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      ua,
      browserVersion: parseBrowserVersion(ua),
      screen: `${screen.width}x${screen.height}`,
      platform: navigator.platform,
      deviceMemory: navigator.deviceMemory || 'unknown',
      hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
      connectionType: connection.effectiveType || 'unknown',
      cookieEnabled: navigator.cookieEnabled,
      colorDepth: screen.colorDepth,
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      isMobile: /Mobile|Android|iPhone|iPad|iPod/i.test(ua),
      vendor: navigator.vendor || 'unknown',
      referrerDomain,
      jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit || 'unsupported',
      firstPaint,
      firstContentfulPaint,
    };
  }

  function getPageInfo() {
    return {
      url: location.href,
      referrer: document.referrer,
    };
  }

  function flushQueue() {
    if (!queue.length) return;
    const batch = queue.splice(0, config.flushMaxBatch);
    const payload = JSON.stringify(batch);

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(config.server, blob);
    } else {
      fetch(config.server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    }

    config.forwardPipelines.forEach(pipeline => {
      if (typeof pipeline.handler === 'function') {
        try {
          pipeline.handler(batch);
        } catch (e) {
          if (config.debug) console.warn(`[CrossTracker] Forward pipeline failed: ${pipeline.name}`, e);
        }
      }
    });

    if (queue.length) {
      flushTimer = setTimeout(flushQueue, config.flushInterval);
    } else {
      flushTimer = null;
    }
  }

  function scheduleFlush() {
    if (!flushTimer) {
      flushTimer = setTimeout(flushQueue, config.flushInterval);
    }
  }

  function track(event, data = {}) {
    const payload = {
      event,
      ts: new Date().toISOString(),
      projectId: config.projectId,
      user: {
        uid: config.userId,
        anonymousId,
      },
      page: getPageInfo(),
      device: getActiveDeviceInfo(),
      context: globalContext,
      data,
    };

    queue.push(payload);
    if (config.debug) console.log('[CrossTracker] track:', payload);
    if (config.trackLogSwitch) console.log('[TrackLog]', JSON.stringify(payload, null, 2));

    if (queue.length >= config.flushMaxBatch || event === 'place_order') {
      flushQueue();
    } else {
      scheduleFlush();
    }
  }

  async function resolveAsyncContext() {
    if (typeof config.asyncContextResolver === 'function') {
      try {
        globalContext = await config.asyncContextResolver();
      } catch (e) {
        if (config.debug) console.warn('[CrossTracker] asyncContextResolver error:', e);
      }
    }
  }

  function autoTrackPageView() {
    if (config.autoTrackPage) {
      track('page_view');
      window.addEventListener('beforeunload', flushQueue);
    }
  }

  // === 自动交互埋点模块 ===
  function track_view(selector = 'body') {
    const el = document.querySelector(selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
        track('auto_view', { selector });
      }
    }
  }

  function track_scroll(selector = 'body', threshold = 0.5) {
    const el = document.querySelector(selector);
    if (!el) return;
    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
          track('auto_scroll', {
            selector,
            ratio: entry.intersectionRatio,
          });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold });
    observer.observe(el);
  }

  function track_click(selector = '[data-track-click]') {
    document.addEventListener('click', (e) => {
      const target = e.target.closest(selector);
      if (target) {
        track('auto_click', {
          selector,
          tag: target.tagName,
          text: target.innerText?.slice(0, 100),
        });
      }
    });
  }

  function registerInteractionTracker(name, handler) {
    if (typeof name === 'string' && typeof handler === 'function') {
      interactionRegistry[name] = handler;
    }
  }

  const CrossTracker = {
    async init(userConfig) {
      config = { ...DEFAULT_CONFIG, ...userConfig };
      anonymousId = getAnonymousId();
      await resolveAsyncContext();
      autoTrackPageView();
      if (config.debug) console.log('[CrossTracker] Initialized', config);
    },
    setUser(user) {
      config.userId = user?.uid;
    },
    track,
    track_view,
    track_scroll,
    track_click,
    registerInteractionTracker,
  };

  global.CrossTracker = CrossTracker;
})(window);
