/* ==========================================================================
   THE DAILY LEDGER — app.js
   Everything runs in the reader's browser. No server, no API key, no build step.

   HOW IT WORKS
   1. Browsers block direct requests to most news feeds, so the page asks a set
      of free public "CORS proxies" to relay them. If one proxy is down, the
      next one is tried automatically.
   2. It parses the RSS/Atom XML, cleans the summaries, removes duplicates
      (including duplicates across sections) and lays the stories out.
   3. Delayed index and share prices come from Yahoo Finance's public chart
      endpoint through the same proxies.
   4. Anything that fails is skipped quietly. The page never breaks.

   THE ONLY BITS YOU MIGHT WANT TO CHANGE ARE MARKED  >>> EDIT ME <<<
   ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
     1. SETTINGS                                        >>> EDIT ME <<<
     ====================================================================== */

  var SETTINGS = {
    // How long a saved copy of the paper counts as fresh, in minutes.
    // Open the page after this and it pulls the wires again.
    cacheMinutes: 30,

    // Most stories printed per section.
    maxPerSection: { top: 13, markets: 9, deals: 9, views: 9, macro: 9 },

    // Seconds to wait on any one request before giving up on it.
    requestTimeoutSeconds: 14,

    // How many requests run at once. Higher is faster, but the free proxies
    // start refusing. Six is a good balance.
    concurrency: 6,

    // The "No." in the dateline counts days up from here. Set your launch day.
    firstIssue: '2026-01-01'
  };

  /* ======================================================================
     2. CORS PROXIES — all free, no sign-up, no key
     ====================================================================== */

  var PROXIES = [
    {
      id: 'allorigins',
      build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
      unwrap: function (t) { return t; }
    },
    {
      id: 'codetabs',
      build: function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); },
      unwrap: function (t) { return t; }
    },
    {
      id: 'allorigins-json',
      build: function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); },
      unwrap: function (t) { try { return JSON.parse(t).contents || ''; } catch (e) { return ''; } }
    },
    {
      id: 'corsproxy',
      build: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); },
      unwrap: function (t) { return t; }
    }
  ];

  /* ======================================================================
     3. THE NEWS DESKS                                  >>> EDIT ME <<<
     Add or remove feeds freely — a dead feed is simply skipped.
     `outlet` is the name printed above the headline.
     Anything pointing at news.google.com is a search across many publishers;
     the real publisher's name is read out of the feed itself.
     ====================================================================== */

  var G = 'https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=';

  var DESKS = {
    top: [
      { outlet: 'The Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
      { outlet: 'The Wall Street Journal', url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml' },
      { outlet: 'MarketWatch',             url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
      { outlet: 'CNBC',                    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
      { outlet: 'Yahoo Finance',           url: 'https://finance.yahoo.com/news/rssindex' },
      { outlet: 'Reuters',                 url: G + 'site:reuters.com+(markets+OR+stocks+OR+economy)+when:1d' },
      { outlet: 'Bloomberg',               url: G + 'site:bloomberg.com+when:1d' },
      { outlet: 'Financial Times',         url: G + 'site:ft.com+when:1d' }
    ],

    markets: [
      { outlet: 'MarketWatch',   url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
      { outlet: 'CNBC',          url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069' },
      { outlet: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss' },
      { outlet: 'Newswire',      url: G + '(%22Wall+Street%22+OR+%22S%26P+500%22+OR+Nasdaq+OR+%22Dow+Jones%22)+when:1d' }
    ],

    deals: [
      { outlet: 'Deal Wire',   url: G + '(%22agreed+to+acquire%22+OR+takeover+OR+merger)+(billion+OR+million)+when:2d' },
      { outlet: 'Reuters',     url: G + 'site:reuters.com+(acquisition+OR+merger+OR+takeover)+when:3d' },
      { outlet: 'Bloomberg',   url: G + 'site:bloomberg.com+(acquisition+OR+merger+OR+takeover)+when:3d' },
      { outlet: 'Deal Wire',   url: G + '(%22private+equity%22+OR+%22leveraged+buyout%22+OR+%22take+private%22)+when:3d' },
      { outlet: 'PR Newswire', url: 'https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss' }
    ],

    views: [
      { outlet: 'Musings on Markets \u2014 Aswath Damodaran', url: 'https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss' },
      { outlet: 'A Wealth of Common Sense', url: 'https://awealthofcommonsense.com/feed/' },
      { outlet: 'Calculated Risk',          url: 'https://www.calculatedriskblog.com/feeds/posts/default?alt=rss' },
      { outlet: 'The Big Picture',          url: 'https://ritholtz.com/feed/' },
      { outlet: 'Strategy Desk', url: G + '(%22Aswath+Damodaran%22+OR+%22Howard+Marks%22+OR+%22Mohamed+El-Erian%22+OR+%22Jeremy+Siegel%22+OR+%22Jamie+Dimon%22)+when:7d' },
      { outlet: 'Analyst Calls', url: G + '(%22price+target%22+OR+upgraded+OR+downgraded)+(analyst+OR+strategist)+when:2d' }
    ],

    macro: [
      { outlet: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
      { outlet: 'CNBC',            url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
      { outlet: 'Macro Wire',      url: G + '(%22Federal+Reserve%22+OR+%22interest+rates%22+OR+inflation+OR+%22jobs+report%22)+when:1d' },
      { outlet: 'New Issues',      url: G + '(IPO+OR+%22initial+public+offering%22+OR+%22files+to+go+public%22)+when:2d' },
      { outlet: 'Earnings',        url: G + '(%22quarterly+results%22+OR+%22earnings+beat%22+OR+%22earnings+miss%22)+when:1d' }
    ]
  };

  var DESK_ORDER = ['top', 'markets', 'deals', 'views', 'macro'];

  /* ======================================================================
     4. THE QUOTE BOARD                                 >>> EDIT ME <<<
     Yahoo Finance symbols: ^ marks an index, =F marks a futures contract.
     ====================================================================== */

  var INDEX_SYMBOLS = [
    { sym: '^GSPC', short: 'SPX',   name: 'S&P 500' },
    { sym: '^IXIC', short: 'COMP',  name: 'Nasdaq Composite' },
    { sym: '^DJI',  short: 'DJIA',  name: 'Dow Jones Industrial' },
    { sym: '^RUT',  short: 'RUT',   name: 'Russell 2000' },
    { sym: '^VIX',  short: 'VIX',   name: 'Volatility Index' },
    { sym: '^TNX',  short: 'US10Y', name: '10-Year Treasury Yield' },
    { sym: 'CL=F',  short: 'WTI',   name: 'Crude Oil' },
    { sym: 'GC=F',  short: 'GOLD',  name: 'Gold' }
  ];

  var SINGLE_SYMBOLS = [
    { sym: 'NVDA',  short: 'NVDA', name: 'Nvidia' },
    { sym: 'AAPL',  short: 'AAPL', name: 'Apple' },
    { sym: 'MSFT',  short: 'MSFT', name: 'Microsoft' },
    { sym: 'JPM',   short: 'JPM',  name: 'JPMorgan Chase' },
    { sym: 'GS',    short: 'GS',   name: 'Goldman Sachs' },
    { sym: 'BRK-B', short: 'BRKB', name: 'Berkshire Hathaway B' }
  ];

  /* ======================================================================
     5. SMALL HELPERS
     ====================================================================== */

  var CACHE_KEY = 'daily-ledger-v1';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function isHttp(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Turn markup into plain readable text without executing or loading anything.
  function toText(html) {
    if (!html) return '';
    try {
      var doc = new DOMParser().parseFromString(String(html), 'text/html');
      var junk = doc.querySelectorAll('script,style,figure,figcaption,img,iframe,noscript');
      for (var i = junk.length - 1; i >= 0; i--) junk[i].parentNode.removeChild(junk[i]);
      return (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Split into sentences without breaking on 0.8%, U.S., Inc., etc.
  function splitSentences(t) {
    var out = [], start = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (c !== '.' && c !== '!' && c !== '?') continue;

      var prev = i > 0 ? t.charAt(i - 1) : '';
      var next = i + 1 < t.length ? t.charAt(i + 1) : '';

      if (c === '.' && /[0-9]/.test(prev) && /[0-9]/.test(next)) continue;   // 0.8
      if (next && !/\s/.test(next)) continue;                                 // mid-token
      if (c === '.' && /[A-Z]/.test(prev) && (i < 2 || !/[a-z]/i.test(t.charAt(i - 2)))) continue; // U.S.

      var tail = t.slice(Math.max(0, i - 6), i + 1);
      if (/(?:^|[\s(])(mr|mrs|ms|dr|inc|ltd|co|corp|vs|no|jr|sr|st|est|approx|fig)\.$/i.test(tail)) continue;

      out.push(t.slice(start, i + 1).trim());
      start = i + 1;
    }
    if (start < t.length) out.push(t.slice(start).trim());
    return out.filter(Boolean);
  }

  // Two or three sentences, capped so the columns stay even.
  function makeSummary(raw, title) {
    var t = toText(raw);
    if (!t) return '';

    t = t.replace(/\s*(read more|continue reading|the post .*? appeared first on .*)\s*[\u00BB>\u2192]*\s*$/i, '').trim();

    // Google News repeats the headline in the description. That is not a summary.
    var nt = norm(title), ns = norm(t);
    if (!ns) return '';
    if (ns === nt) return '';
    if (nt.length > 12 && ns.indexOf(nt.slice(0, 45)) === 0 && t.length < title.length + 70) return '';

    var parts = splitSentences(t);
    var out = '';
    for (var i = 0; i < parts.length && i < 3; i++) {
      if (out.length && (out.length + parts[i].length) > 330) break;
      out += (out ? ' ' : '') + parts[i];
      if (out.length > 230) break;
    }
    out = (out || t).trim();
    if (out.length > 340) out = out.slice(0, 335).replace(/\s+\S*$/, '') + '\u2026';
    if (out.length < 35) return '';
    return out;
  }

  // "Chipmaker explores sale - Reuters"  ->  "Chipmaker explores sale"
  var PUBLISHERS = /(reuters|bloomberg|cnbc|wsj|wall street journal|financial times|ft com|barron|forbes|yahoo|marketwatch|investing com|business insider|axios|cnn|fortune|guardian|associated press|ap news|new york times|nyt|seeking alpha|benzinga|the information|semafor|politico|quartz|investopedia|thestreet|morningstar|pymnts|coindesk)/;

  function cleanTitle(title) {
    var t = String(title || '').trim();
    var m = t.match(/^([\s\S]+?)\s+[-\u2013\u2014]\s+([^-\u2013\u2014]{2,42})$/);
    if (m && PUBLISHERS.test(norm(m[2]))) t = m[1];
    return t.trim();
  }

  function hostToOutlet(link) {
    try {
      var h = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
      if (h.indexOf('news.google') === 0) return '';
      var map = {
        'reuters.com': 'Reuters', 'bloomberg.com': 'Bloomberg', 'wsj.com': 'The Wall Street Journal',
        'ft.com': 'Financial Times', 'cnbc.com': 'CNBC', 'marketwatch.com': 'MarketWatch',
        'finance.yahoo.com': 'Yahoo Finance', 'barrons.com': 'Barron\u2019s',
        'businessinsider.com': 'Business Insider', 'markets.businessinsider.com': 'Business Insider',
        'investing.com': 'Investing.com', 'seekingalpha.com': 'Seeking Alpha', 'fortune.com': 'Fortune',
        'apnews.com': 'Associated Press', 'nytimes.com': 'The New York Times', 'axios.com': 'Axios',
        'federalreserve.gov': 'Federal Reserve', 'prnewswire.com': 'PR Newswire',
        'aswathdamodaran.blogspot.com': 'Musings on Markets'
      };
      if (map[h]) return map[h];
      var base = h.split('.')[0];
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch (e) { return ''; }
  }

  function timeAgo(ms) {
    if (!ms) return '';
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  /* ======================================================================
     6. FETCHING
     ====================================================================== */

  function fetchText(url, timeoutMs) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    var opts = { cache: 'no-store', redirect: 'follow' };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (txt) {
      clearTimeout(timer);
      return txt;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // Try each proxy in turn, starting at `offset` so the load is spread around.
  function fetchViaProxy(url, offset) {
    var timeout = SETTINGS.requestTimeoutSeconds * 1000;
    var order = [];
    for (var i = 0; i < PROXIES.length; i++) {
      order.push(PROXIES[(i + (offset || 0)) % PROXIES.length]);
    }
    function attempt(i) {
      if (i >= order.length) return Promise.reject(new Error('all proxies failed'));
      var p = order[i];
      return fetchText(p.build(url), timeout).then(function (raw) {
        var body = p.unwrap(raw);
        if (!body || body.length < 40) throw new Error('empty body');
        return body;
      }).catch(function () { return attempt(i + 1); });
    }
    return attempt(0);
  }

  // Run jobs a few at a time so the free proxies are not hammered.
  function pool(jobs, limit) {
    var results = new Array(jobs.length);
    var next = 0;
    function worker() {
      if (next >= jobs.length) return Promise.resolve();
      var idx = next++;
      return jobs[idx]()
        .then(function (v) { results[idx] = v; }, function () { results[idx] = null; })
        .then(worker);
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, jobs.length); i++) runners.push(worker());
    return Promise.all(runners).then(function () { return results; });
  }

  /* ======================================================================
     7. FEED PARSING (RSS 2.0 and Atom)
     ====================================================================== */

  // XML only knows five named entities. Feeds routinely ship HTML ones such as
  // &nbsp;, which makes a strict parser throw out the entire document. Escape
  // them first — but never inside CDATA, where the text is already literal.
  function repairXml(text) {
    var parts = String(text).split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].slice(0, 9) === '<![CDATA[') continue;
      parts[i] = parts[i]
        .replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, function (m, name) {
          return /^(amp|lt|gt|quot|apos)$/.test(name) ? m : '&amp;' + name + ';';
        })
        .replace(/&(?![a-zA-Z#])/g, '&amp;');
    }
    return parts.join('');
  }

  function firstTagText(scope, names) {
    for (var i = 0; i < names.length; i++) {
      var nodes = scope.getElementsByTagName(names[i]);
      if (nodes && nodes.length && nodes[0].textContent && nodes[0].textContent.trim()) {
        return nodes[0].textContent.trim();
      }
    }
    return '';
  }

  function itemLink(item) {
    var links = item.getElementsByTagName('link');
    for (var i = 0; i < links.length; i++) {
      var txt = (links[i].textContent || '').trim();
      if (isHttp(txt)) return txt;
      var href = links[i].getAttribute && links[i].getAttribute('href');
      if (isHttp(href)) return href;
    }
    var guid = firstTagText(item, ['guid', 'id']);
    return isHttp(guid) ? guid : '';
  }

  function parseFeed(xmlText, feed) {
    var text = String(xmlText || '');
    var cut = text.indexOf('<');
    if (cut > 0) text = text.slice(cut);
    if (!text) return [];

    var doc = null;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      try { doc = new DOMParser().parseFromString(repairXml(text), 'application/xml'); } catch (e2) { doc = null; }
    }
    if (!doc || doc.getElementsByTagName('parsererror').length) return [];

    var nodes = doc.getElementsByTagName('item');
    if (!nodes.length) nodes = doc.getElementsByTagName('entry');
    if (!nodes.length) return [];

    var isAggregator = feed.url.indexOf('news.google.com') > -1;
    var out = [];

    for (var i = 0; i < nodes.length && i < 25; i++) {
      var it = nodes[i];
      var link = itemLink(it);
      var rawTitle = firstTagText(it, ['title']);
      if (!rawTitle || !isHttp(link)) continue;

      var srcTag = it.getElementsByTagName('source');
      var srcName = (srcTag && srcTag.length) ? (srcTag[0].textContent || '').trim() : '';

      var outlet = isAggregator
        ? (srcName || hostToOutlet(link) || feed.outlet)
        : (feed.outlet || srcName || hostToOutlet(link));

      var title = cleanTitle(rawTitle);
      var body = firstTagText(it, ['content:encoded', 'encoded', 'description', 'summary', 'content', 'subtitle']);
      var dateStr = firstTagText(it, ['pubDate', 'published', 'updated', 'dc:date', 'date']);
      var when = dateStr ? Date.parse(dateStr) : NaN;

      out.push({
        title: title,
        link: link,
        outlet: outlet || 'Newswire',
        summary: makeSummary(body, title),
        when: isNaN(when) ? 0 : when
      });
    }
    return out;
  }

  /* ======================================================================
     8. RANKING AND DE-DUPLICATION
     ====================================================================== */

  // Newest first, but a story carrying a real summary counts as fresher —
  // a front page of bare headlines is not worth reading.
  function rank(items, limit, seenTitle, seenLink) {
    var kept = [];
    var cutoff = Date.now() - 864e5 * 10;
    var undated = Date.now() - 864e5 * 3;
    var bonus = 1000 * 60 * 60 * 5;

    var sorted = items.slice().sort(function (a, b) {
      return ((b.when || undated) + (b.summary ? bonus : 0)) -
             ((a.when || undated) + (a.summary ? bonus : 0));
    });

    for (var i = 0; i < sorted.length && kept.length < limit; i++) {
      var it = sorted[i];
      var kt = norm(it.title).slice(0, 65);
      var kl = it.link.split('?')[0];
      if (!kt || kt.length < 12) continue;
      if (it.when && it.when < cutoff) continue;
      if (seenTitle[kt] || seenLink[kl]) continue;
      seenTitle[kt] = 1;
      seenLink[kl] = 1;
      kept.push(it);
    }
    return kept;
  }

  // The lead carries a drop cap, so it needs a summary behind it.
  function promoteLead(list) {
    for (var j = 1; j < list.length; j++) {
      if (list[0].summary) break;
      if (list[j].summary) { list.unshift(list.splice(j, 1)[0]); break; }
    }
    return list;
  }

  /* ======================================================================
     9. QUOTES
     ====================================================================== */

  function loadQuote(entry, offset) {
    var hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

    function tryHost(hi) {
      if (hi >= hosts.length) return Promise.resolve(null);
      var url = 'https://' + hosts[hi] + '/v8/finance/chart/' +
        encodeURIComponent(entry.sym) + '?range=5d&interval=1d';

      return fetchViaProxy(url, offset + hi).then(function (body) {
        var data = JSON.parse(body);
        var res = data && data.chart && data.chart.result && data.chart.result[0];
        var meta = res && res.meta;
        if (!meta) throw new Error('no meta');
        var last = meta.regularMarketPrice;
        var prev = (meta.chartPreviousClose != null) ? meta.chartPreviousClose : meta.previousClose;
        if (typeof last !== 'number' || typeof prev !== 'number' || !prev) throw new Error('no price');
        return {
          sym: entry.sym,
          short: entry.short,
          name: entry.name,
          last: last,
          pct: ((last - prev) / prev) * 100
        };
      }).catch(function () { return tryHost(hi + 1); });
    }
    return tryHost(0);
  }

  /* ======================================================================
     10. RENDERING
     ====================================================================== */

  function fmtPrice(n) {
    var dp = Math.abs(n) >= 1 ? 2 : 4;
    return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function fmtPct(p) {
    var sign = p > 0 ? '+' : (p < 0 ? '\u2212' : '');
    return sign + Math.abs(p).toFixed(2) + '%';
  }

  function dirClass(p, base) {
    if (p > 0.0001) return base + '--up';
    if (p < -0.0001) return base + '--down';
    return base + '--flat';
  }

  function renderStory(item, isLead) {
    var art = el('article', 'story' + (isLead ? ' story--lead' : ''));

    var meta = el('p', 'story__source');
    meta.appendChild(el('span', 'story__outlet', item.outlet));
    if (item.when) meta.appendChild(el('span', 'story__time', timeAgo(item.when)));
    art.appendChild(meta);

    var hed = el('h3', 'story__hed');
    var a = el('a', null, item.title);
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    hed.appendChild(a);
    art.appendChild(hed);

    if (item.summary) {
      art.appendChild(el('p', 'story__sum', item.summary));
    } else {
      art.appendChild(el('p', 'story__sum story__sum--none',
        'Headline only on this wire \u2014 open ' + item.outlet + ' for the full report.'));
    }
    return art;
  }

  function renderDesk(bodyId, items, leadSlotId) {
    var body = $(bodyId);
    var slot = leadSlotId ? $(leadSlotId) : null;
    if (slot) clear(slot);
    if (!body) return;
    clear(body);

    if (!items || !items.length) {
      body.appendChild(el('p', 'empty',
        'Nothing came through on this wire. Press \u201cPull latest\u201d, or check back shortly.'));
      return;
    }

    var start = 0;
    if (slot) { slot.appendChild(renderStory(items[0], true)); start = 1; }
    for (var i = start; i < items.length; i++) {
      body.appendChild(renderStory(items[i], false));
    }
  }

  function renderQuoteTable(tableId, rows) {
    var table = $(tableId);
    if (!table) return;
    clear(table);
    var tbody = el('tbody');

    if (!rows.length) {
      var tr0 = el('tr');
      var td0 = el('td', 'quotes__name');
      td0.colSpan = 3;
      td0.appendChild(el('span', null, 'Quotes are unavailable right now.'));
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      table.appendChild(tbody);
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      var q = rows[i];
      var tr = el('tr');

      var tdName = el('td', 'quotes__name');
      tdName.appendChild(el('span', null, q.name));
      tr.appendChild(tdName);

      tr.appendChild(el('td', 'quotes__last', fmtPrice(q.last)));

      var arrow = q.pct > 0.0001 ? '\u25B2 ' : (q.pct < -0.0001 ? '\u25BC ' : '\u2013 ');
      tr.appendChild(el('td', 'quotes__chg ' + dirClass(q.pct, 'quotes__chg'), arrow + fmtPct(q.pct)));

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function renderTape(quotes) {
    var track = $('tape-track');
    if (!track) return;
    clear(track);

    if (!quotes.length) {
      track.appendChild(el('span', 'tape__item tape__item--placeholder',
        'The tape is quiet \u2014 the quote feed is unavailable.'));
      return;
    }
    for (var pass = 0; pass < 2; pass++) {          // printed twice so it loops seamlessly
      for (var i = 0; i < quotes.length; i++) {
        var q = quotes[i];
        var span = el('span', 'tape__item');
        span.appendChild(el('span', 'tape__sym', q.short || q.sym));
        span.appendChild(el('span', 'tape__px', fmtPrice(q.last)));
        span.appendChild(el('span', 'tape__chg ' + dirClass(q.pct, 'tape__chg'), fmtPct(q.pct)));
        track.appendChild(span);
      }
    }
  }

  function renderDateline() {
    var now = new Date();
    var dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    var h = now.getHours();
    var edition = h < 11 ? 'Morning Edition' : (h < 16 ? 'Midday Edition' : 'Evening Edition');

    var start = new Date(SETTINGS.firstIssue + 'T00:00:00');
    var issue = Math.max(1, Math.round((now - start) / 864e5) + 1);
    var vol = Math.max(1, Math.ceil(issue / 365));

    var d1 = $('dateline-date'), d2 = $('dateline-edition'), d3 = $('dateline-vol');
    if (d1) d1.textContent = dateStr;
    if (d2) d2.textContent = edition;
    if (d3) d3.textContent = 'Vol. ' + vol + ' \u00B7 No. ' + issue;

    var folio = $('colophon-folio');
    if (folio) folio.textContent = 'The Daily Ledger \u00B7 ' + dateStr + ' \u00B7 Page One';
  }

  function setStatus(msg) {
    var s = $('status');
    if (s) s.textContent = msg;
  }

  function paint(payload) {
    renderDesk('top-stories-body', payload.desks.top, 'top-stories-lead');
    renderDesk('markets-body', payload.desks.markets);
    renderDesk('deals-body', payload.desks.deals);
    renderDesk('views-body', payload.desks.views);
    renderDesk('macro-body', payload.desks.macro);

    var q = payload.quotes || [];
    var isIndex = {};
    for (var i = 0; i < INDEX_SYMBOLS.length; i++) isIndex[INDEX_SYMBOLS[i].sym] = 1;

    renderQuoteTable('quotes-index', q.filter(function (x) { return isIndex[x.sym]; }));
    renderQuoteTable('quotes-single', q.filter(function (x) { return !isIndex[x.sym]; }));
    renderTape(q);
  }

  /* ======================================================================
     11. SAVED COPY — so the page shows something the instant it opens
     ====================================================================== */

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && obj.savedAt && obj.desks) ? obj : null;
    } catch (e) { return null; }
  }

  function writeCache(payload) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); }
    catch (e) { /* private browsing or storage full — not important */ }
  }

  /* ======================================================================
     12. THE PRESS RUN
     ====================================================================== */

  var running = false;

  function publish(isManual) {
    if (running) return;
    running = true;

    var btn = $('refresh-btn');
    if (btn) btn.disabled = true;
    setStatus(isManual ? 'Resetting the type\u2026' : 'Pulling today\u2019s wires\u2026');

    // One flat queue for every request the page needs, so the proxies see a
    // steady trickle instead of forty simultaneous demands.
    var feedJobs = [];
    for (var d = 0; d < DESK_ORDER.length; d++) {
      var desk = DESK_ORDER[d];
      for (var f = 0; f < DESKS[desk].length; f++) {
        feedJobs.push({ desk: desk, feed: DESKS[desk][f] });
      }
    }
    var quoteEntries = INDEX_SYMBOLS.concat(SINGLE_SYMBOLS);

    var jobs = [];
    feedJobs.forEach(function (fj, i) {
      jobs.push(function () {
        return fetchViaProxy(fj.feed.url, i).then(function (body) {
          return parseFeed(body, fj.feed);
        }).catch(function () { return []; });
      });
    });
    quoteEntries.forEach(function (q, i) {
      jobs.push(function () { return loadQuote(q, i + feedJobs.length); });
    });

    pool(jobs, SETTINGS.concurrency).then(function (results) {
      var buckets = {}, wiresOk = 0, wiresDead = 0;
      DESK_ORDER.forEach(function (k) { buckets[k] = []; });

      for (var i = 0; i < feedJobs.length; i++) {
        var items = results[i] || [];
        if (items.length) { wiresOk++; } else { wiresDead++; }
        buckets[feedJobs[i].desk] = buckets[feedJobs[i].desk].concat(items);
      }

      var quotes = results.slice(feedJobs.length).filter(function (x) { return x; });

      // Global de-duplication, in pick order. The front page claims the day's
      // biggest story for its lead; the specialist desks pick next, so deal and
      // policy coverage is not swallowed by the general news desk; then the
      // front page fills the rest of the page from what is left.
      var seenTitle = {}, seenLink = {}, desks = {}, total = 0;

      desks.top = rank(buckets.top, 1, seenTitle, seenLink);

      ['markets', 'deals', 'views', 'macro'].forEach(function (k) {
        desks[k] = rank(buckets[k], SETTINGS.maxPerSection[k] || 9, seenTitle, seenLink);
      });

      desks.top = promoteLead(desks.top.concat(
        rank(buckets.top, (SETTINGS.maxPerSection.top || 13) - desks.top.length, seenTitle, seenLink)
      ));

      // No section should sit blank only because its stories ran elsewhere.
      DESK_ORDER.forEach(function (k) {
        if (!desks[k].length) desks[k] = rank(buckets[k], 3, {}, {});
        total += desks[k].length;
      });

      var payload = { savedAt: Date.now(), desks: desks, quotes: quotes };

      if (total === 0) {
        var cached = readCache();
        if (cached) {
          paint(cached);
          setStatus('The wires are unreachable \u2014 showing the edition saved ' + timeAgo(cached.savedAt) + '.');
        } else {
          paint(payload);
          setStatus('No wires reachable right now. Press \u201cPull latest\u201d in a moment.');
        }
      } else {
        paint(payload);
        writeCache(payload);
        var time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        var msg = 'Set at ' + time + ' \u00B7 ' + total + ' stories from ' + wiresOk + ' wires';
        if (wiresDead) msg += ' \u00B7 ' + wiresDead + ' quiet';
        setStatus(msg);
      }

      if (btn) btn.disabled = false;
      running = false;
    }).catch(function () {
      setStatus('The press jammed. Press \u201cPull latest\u201d to try again.');
      if (btn) btn.disabled = false;
      running = false;
    });
  }

  function start() {
    renderDateline();

    var btn = $('refresh-btn');
    if (btn) btn.addEventListener('click', function () { publish(true); });

    var cached = readCache();
    if (cached) {
      paint(cached);
      var fresh = (Date.now() - cached.savedAt) < SETTINGS.cacheMinutes * 60000;
      if (fresh) {
        var t = new Date(cached.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        setStatus('Set at ' + t + ' \u00B7 press \u201cPull latest\u201d for a fresh run');
        return;
      }
      setStatus('Showing the edition saved ' + timeAgo(cached.savedAt) + ' \u2014 checking the wires\u2026');
    }
    publish(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
