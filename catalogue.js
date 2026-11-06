/*
 * Catalogue + progress logic for the Ngalutfota Lolumanti tracker.
 * Plain ES2017, no dependencies. Works in the browser (window.NL) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NL = factory();
})(this, function () {
  'use strict';

  var API = 'https://api.omny.fm/orgs/8f7208d2-db6e-4bfa-85b5-ad3d00776f1f/playlists/cd67d65f-8378-4790-aafd-af69012c714b/clips?pageSize=100&cursor=';
  var MAIN_START = 1140;            // main sequence starts here; lower numbers are "older short clips"
  var PROGRESS_KEY = 'nl.progress.v1';
  var CATALOGUE_KEY = 'nl.catalogue.v1';
  var UNDO_LIMIT = 30;

  // ---------- Parsing ----------

  // Dates appear as "(02.11.2026)", "( 28.09.2020)", "(27.04.2022" or "2087(02.12.2021)".
  var DATE_RE = /\(?\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})\s*\)?/;
  var DATE_RE_G = new RegExp(DATE_RE.source, 'g');
  // Episode number = first standalone 3-4 digit number once dates are removed.
  // ("_1" upload suffixes are 1 digit, so they never match.)
  var EP_RE = /(?:^|\D)(\d{3,4})(?!\d)/;

  function parseTitle(title) {
    var t = String(title == null ? '' : title);
    var d = DATE_RE.exec(t);
    var titleDate = null;
    if (d) {
      var day = +d[1], mon = +d[2], yr = +d[3];
      if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
        titleDate = yr + '-' + (mon < 10 ? '0' : '') + mon + '-' + (day < 10 ? '0' : '') + day;
      }
    }
    var m = EP_RE.exec(t.replace(DATE_RE_G, ' '));
    return { ep: m ? parseInt(m[1], 10) : null, titleDate: titleDate };
  }

  // Keep only the fields we need (keeps localStorage small).
  function compactClip(c) {
    return { t: c.Title, u: c.PublishedUrl, a: c.AudioUrl, p: c.PublishedUtc, d: c.DurationSeconds };
  }

  // fetchJson(url) -> Promise<object>. Pages until Clips is empty.
  function fetchAllClips(fetchJson, onPage) {
    var all = [];
    function page(n) {
      return fetchJson(API + n).then(function (j) {
        var clips = (j && j.Clips) || [];
        if (!clips.length) return all;
        for (var i = 0; i < clips.length; i++) all.push(compactClip(clips[i]));
        if (onPage) onPage(n, all.length);
        if (n > 200) throw new Error('Too many pages, stopping');
        return page(n + 1);
      });
    }
    return page(1);
  }

  // clips: compact clips -> catalogue model
  function buildCatalogue(clips) {
    var byNum = {};
    var excluded = [];
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var p = parseTitle(c.t);
      if (p.ep == null) { excluded.push(c); continue; }
      var up = { title: c.t, url: c.u, audio: c.a, utc: c.p, dur: c.d || 0, titleDate: p.titleDate };
      (byNum[p.ep] = byNum[p.ep] || []).push(up);
    }
    var nums = Object.keys(byNum).map(Number).sort(function (a, b) { return a - b; });
    var episodes = {};
    var numberedClips = 0;
    nums.forEach(function (n) {
      var ups = byNum[n].sort(function (a, b) { return String(a.utc).localeCompare(String(b.utc)); });
      numberedClips += ups.length;
      var primary = 0;
      for (var k = 1; k < ups.length; k++) if (ups[k].dur > ups[primary].dur) primary = k;
      var date = ups[primary].titleDate || ups[0].titleDate || null;
      episodes[n] = { num: n, uploads: ups, primary: primary, airDate: date, uploadDate: String(ups[0].utc || '').slice(0, 10) };
    });

    var mainNums = nums.filter(function (n) { return n >= MAIN_START; });
    var latest = mainNums.length ? mainNums[mainNums.length - 1] : MAIN_START;
    var sequence = [];
    for (var n = MAIN_START; n <= latest; n++) sequence.push(episodes[n] || { num: n, missing: true });

    return {
      totalClips: clips.length,
      numberedClips: numberedClips,
      sequence: sequence,
      available: mainNums,
      latest: latest,
      older: nums.filter(function (n) { return n < MAIN_START; }).map(function (n) { return episodes[n]; }),
      excluded: excluded,
      episodes: episodes
    };
  }

  // ---------- Progress (stored by episode number) ----------

  function emptyProgress() { return { finished: {}, pos: {}, undo: [] }; }

  function loadProgress(storage) {
    try {
      var raw = storage.getItem(PROGRESS_KEY);
      if (!raw) return emptyProgress();
      var s = JSON.parse(raw);
      return { finished: s.finished || {}, pos: s.pos || {}, undo: s.undo || [] };
    } catch (e) { return emptyProgress(); }
  }

  function saveProgress(storage, s) {
    try { storage.setItem(PROGRESS_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  // Set finished flag for a list of episode numbers; records an undo entry. Returns # changed.
  function setFinished(s, nums, value, label) {
    var prev = {};
    var changed = 0;
    var now = Date.now();
    nums.forEach(function (n) {
      var key = String(n);
      var was = s.finished[key] || null;
      if (!!was === !!value) return;
      prev[key] = was;
      if (value) s.finished[key] = now; else delete s.finished[key];
      changed++;
    });
    if (changed) {
      s.undo.push({ label: label, prev: prev });
      if (s.undo.length > UNDO_LIMIT) s.undo.splice(0, s.undo.length - UNDO_LIMIT);
    }
    return changed;
  }

  function undo(s) {
    var u = s.undo.pop();
    if (!u) return null;
    Object.keys(u.prev).forEach(function (k) {
      if (u.prev[k]) s.finished[k] = u.prev[k]; else delete s.finished[k];
    });
    return u.label;
  }

  function isFinished(s, n) { return !!s.finished[String(n)]; }

  function firstUnfinished(cat, s) {
    for (var i = 0; i < cat.sequence.length; i++) {
      var e = cat.sequence[i];
      if (!e.missing && !isFinished(s, e.num)) return e;
    }
    return null;
  }

  function nextAvailableAfter(cat, n) {
    for (var i = 0; i < cat.sequence.length; i++) {
      var e = cat.sequence[i];
      if (e.num > n && !e.missing) return e;
    }
    return null;
  }

  function finishedCount(cat, s) {
    var c = 0;
    cat.available.forEach(function (n) { if (isFinished(s, n)) c++; });
    return c;
  }

  // ---------- Catalogue cache ----------

  function loadCachedClips(storage) {
    try { var raw = storage.getItem(CATALOGUE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveCachedClips(storage, clips) {
    try { storage.setItem(CATALOGUE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), clips: clips })); return true; }
    catch (e) { return false; }
  }

  return {
    API: API, MAIN_START: MAIN_START,
    parseTitle: parseTitle, compactClip: compactClip, fetchAllClips: fetchAllClips, buildCatalogue: buildCatalogue,
    emptyProgress: emptyProgress, loadProgress: loadProgress, saveProgress: saveProgress,
    setFinished: setFinished, undo: undo, isFinished: isFinished,
    firstUnfinished: firstUnfinished, nextAvailableAfter: nextAvailableAfter, finishedCount: finishedCount,
    loadCachedClips: loadCachedClips, saveCachedClips: saveCachedClips
  };
});
