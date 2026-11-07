/* UI for the Ngalutfota Lolumanti tracker. Depends on catalogue.js (window.NL). */
(function () {
  'use strict';
  var NL = window.NL;
  var $ = function (id) { return document.getElementById(id); };

  var store = (function () {
    try { var k = '__t'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; }
  })();

  var progress = NL.loadProgress(store);

  // Per-device preferences (kept apart from progress so backups/restores don't touch them).
  var SETTINGS_KEY = 'nl.settings.v1';
  var settings = (function () { try { return JSON.parse(store.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })();
  function saveSettings() { try { store.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
  function syncAutoToggles() {
    var ts = document.querySelectorAll('.autoToggle');
    for (var i = 0; i < ts.length; i++) ts[i].checked = !!settings.autoplay;
  }
  syncAutoToggles();
  var cat = null;
  var fetchedAt = null;
  var current = null;          // { num, idx } currently loaded in the player

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function epDate(e) { return e.airDate ? fmtDate(e.airDate) : 'uploaded ' + fmtDate(e.uploadDate); }
  function fmtDur(s) { s = Math.round(s || 0); if (s < 60) return s + 's'; return Math.round(s / 60) + ' min'; }
  function fmtTime(s) { s = Math.floor(s || 0); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function save() { NL.saveProgress(store, progress); }
  function say(id, text) { $(id).textContent = text || ''; }
  function resumeOf(num) { return progress.pos[String(num)] || null; }

  function act(nums, value, label) {
    var n = NL.setFinished(progress, nums, value, label);
    save(); refreshStatus();
    say('actionMsg', n ? label : 'Nothing to change.');
    return n;
  }

  // ---------- rendering ----------
  function uploadButtons(e) {
    var multi = e.uploads.length > 1;
    return e.uploads.map(function (u, i) {
      var lbl = multi ? 'Play ' + (i + 1) + ' · ' + fmtDur(u.dur) : 'Play · ' + fmtDur(u.dur);
      return '<button class="small" data-play="' + e.num + ':' + i + '" title="' + esc(u.title) + '">▶ ' + lbl + '</button>' +
        '<a class="btn small" href="' + esc(u.url) + '" target="_blank" rel="noopener" title="' + esc(u.title) + '">Omny' + (multi ? ' ' + (i + 1) : '') + ' ↗</a>';
    }).join('');
  }

  function epRow(e) {
    return '<div class="ep" id="ep-' + e.num + '" data-num="' + e.num + '">' +
      '<input type="checkbox" data-check="' + e.num + '" aria-label="Episode ' + e.num + ' finished">' +
      '<div class="body"><div><span class="num">Episode ' + e.num + '</span> <span class="meta">· ' + esc(epDate(e)) +
      (e.uploads.length > 1 ? ' · ' + e.uploads.length + ' uploads' : '') + '</span> <span class="resume"></span></div>' +
      '<div class="acts">' + uploadButtons(e) + '</div></div></div>';
  }

  function renderList() {
    var groups = {};
    cat.sequence.forEach(function (e) { var g = Math.floor(e.num / 100) * 100; (groups[g] = groups[g] || []).push(e); });
    var html = '';
    Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (g) {
      var items = groups[g], body = '', gapStart = null;
      for (var i = 0; i <= items.length; i++) {
        var e = items[i];
        if (e && e.missing) { if (gapStart == null) gapStart = e.num; continue; }
        if (gapStart != null) {
          var gapEnd = (e ? e.num : items[items.length - 1].num + 1) - 1;
          body += '<div class="gaprow">' + (gapStart === gapEnd ? 'Episode ' + gapStart : 'Episodes ' + gapStart + '–' + gapEnd) + ' · not online</div>';
          gapStart = null;
        }
        if (e) body += epRow(e);
      }
      html += '<details class="group" data-group="' + g + '"><summary>' + g + '–' + (g + 99) + ' <span data-gsum="' + g + '"></span></summary>' + body + '</details>';
    });
    $('list').innerHTML = html;

    $('older').innerHTML = cat.older.length ? '<p class="meta">Not counted in progress. The main sequence starts at episode ' + NL.MAIN_START + '.</p>' +
      cat.older.map(epRow).join('') : '<p class="meta">None.</p>';

    $('excluded').innerHTML = '<p class="meta">' + cat.excluded.length + ' clip(s) have no episode number in the title, so they are left out:</p><ul class="plain">' +
      cat.excluded.map(function (c) {
        return '<li><a href="' + esc(c.u) + '" target="_blank" rel="noopener">' + esc(c.t) + '</a> <span class="meta">· uploaded ' + esc(fmtDate(String(c.p).slice(0, 10))) + '</span></li>';
      }).join('') + '</ul>';

    var gaps = cat.sequence.filter(function (e) { return e.missing; }).length;
    $('catInfo').textContent = cat.totalClips + ' clips on Omny · ' + cat.available.length + ' episodes ' + NL.MAIN_START + '–' + cat.latest +
      ' · ' + gaps + ' not online · ' + cat.excluded.length + ' excluded' + (fetchedAt ? ' · checked ' + new Date(fetchedAt).toLocaleString() : '');
    $('statusChip').textContent = cat.available.length + ' eps · latest ' + cat.latest;
  }

  function refreshStatus() {
    if (!cat) return;
    var next = NL.firstUnfinished(cat, progress);
    var done = NL.finishedCount(cat, progress), total = cat.available.length;

    // Up next
    if (next) {
      var r = resumeOf(next.num), u = next.uploads[next.primary];
      $('upNextBody').innerHTML = '<p class="up-ep" aria-label="Episode ' + next.num + '">' + next.num + '</p>' +
        '<div class="meta">' + esc(epDate(next)) + ' · ' + fmtDur(u.dur) + (next.uploads.length > 1 ? ' · ' + next.uploads.length + ' uploads' : '') +
        (r ? ' · <span class="resume">resume at ' + fmtTime(r.t) + '</span>' : '') + '</div>' +
        '<div class="row" style="margin-top:12px"><button class="primary" data-play="' + next.num + ':' + (r ? r.i : next.primary) + '">▶ ' + (r ? 'Resume' : 'Listen') + '</button>' +
        '<button data-finish-next="' + next.num + '">Finished, go to next</button></div>';
    } else {
      $('upNextBody').innerHTML = '<p class="up-ep caught">All caught up</p><div class="meta">Check for new episodes below.</div>';
    }

    // Progress
    $('countText').textContent = done + ' of ' + total + ' finished';
    var pct = total ? done / total * 100 : 0;
    $('barFill').style.width = pct.toFixed(2) + '%';
    $('pctText').textContent = pct.toFixed(1) + '%' + (next ? ' · up to episode ' + next.num + ' of ' + cat.latest : '');
    $('ringArc').style.strokeDashoffset = (301.6 * (1 - pct / 100)).toFixed(1);
    $('ringPct').textContent = (pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)) + '%';
    var last = progress.undo[progress.undo.length - 1];
    $('undoBtn').disabled = !last;
    $('undoBtn').textContent = last ? 'Undo: ' + last.label : 'Undo';

    // List rows
    var rows = document.querySelectorAll('.ep');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], num = +row.getAttribute('data-num'), f = NL.isFinished(progress, num), rp = resumeOf(num);
      row.querySelector('input').checked = f;
      row.classList.toggle('done', f);
      row.classList.toggle('next', !!next && next.num === num);
      row.querySelector('.resume').textContent = rp && !f ? '⏸ ' + fmtTime(rp.t) : '';
    }
    var sums = document.querySelectorAll('[data-gsum]');
    for (var j = 0; j < sums.length; j++) {
      var g = +sums[j].getAttribute('data-gsum'), have = 0, fin = 0;
      cat.available.forEach(function (n) { if (n >= g && n < g + 100) { have++; if (NL.isFinished(progress, n)) fin++; } });
      sums[j].textContent = fin + '/' + have + (fin === have && have ? ' ✓' : '');
    }
  }

  // ---------- catalogue load / refresh ----------
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function useClips(clips, when) {
    cat = NL.buildCatalogue(clips);
    fetchedAt = when;
    renderList(); refreshStatus();
    var next = NL.firstUnfinished(cat, progress);
    if (next) { var d = document.querySelector('[data-group="' + Math.floor(next.num / 100) * 100 + '"]'); if (d) d.open = true; }
  }

  function refresh(quiet) {
    var btn = $('refreshBtn'), before = cat ? cat.latest : null, beforeCount = cat ? cat.available.length : 0;
    btn.disabled = true; say('refreshMsg', 'Fetching catalogue…');
    return NL.fetchAllClips(fetchJson, function (page, n) { say('refreshMsg', 'Fetching… page ' + page + ' (' + n + ' clips)'); })
      .then(function (clips) {
        if (!clips.length) throw new Error('API returned no clips');
        var stored = NL.saveCachedClips(store, clips);
        var openGroups = [].map.call(document.querySelectorAll('details.group[open]'), function (d) { return d.getAttribute('data-group'); });
        useClips(clips, new Date().toISOString());
        openGroups.forEach(function (g) { var d = document.querySelector('[data-group="' + g + '"]'); if (d) d.open = true; });
        var added = cat.available.length - beforeCount;
        say('refreshMsg', before == null ? 'Loaded ' + clips.length + ' clips.' :
          (added > 0 ? added + ' new episode(s), latest is ' + cat.latest + '.' : 'No new episodes. Latest is ' + cat.latest + '.') +
          (stored ? '' : ' (Could not cache catalogue; it will be re-fetched next time.)'));
      })
      .catch(function (err) { say('refreshMsg', (quiet ? '' : 'Refresh failed: ') + err.message + (cat ? ' — showing saved catalogue.' : '')); })
      .then(function () { btn.disabled = false; });
  }

  // ---------- player ----------
  var audio = $('audio'), lastSave = 0;

  function play(num, idx) {
    var e = cat.episodes[num]; if (!e) return;
    var u = e.uploads[idx] || e.uploads[e.primary];
    idx = e.uploads.indexOf(u);
    current = { num: num, idx: idx };
    $('player').classList.add('on');
    $('playerTitle').textContent = 'Episode ' + num + (e.uploads.length > 1 ? ' (upload ' + (idx + 1) + ')' : '') + ' · ' + epDate(e);
    audio.src = u.audio;
    var r = resumeOf(num);
    audio.onloadedmetadata = function () {
      if (r && r.i === idx && r.t > 3 && (!audio.duration || r.t < audio.duration - 5)) audio.currentTime = r.t;
    };
    audio.play().catch(function () {});
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Episode ' + num, artist: 'Ngalutfota Lolumanti', album: 'Ligwalagwala FM · ' + epDate(e),
          artwork: [
            { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
            { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }
          ]
        });
      } catch (x) {}
    }
  }

  // ---------- lock screen / notification / Bluetooth / car controls ----------
  // Only play, pause and seeking are wired up: there is deliberately no "next track",
  // so playback never moves on to another episode by itself.
  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!audio.duration || !isFinite(audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration, playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, audio.duration)
      });
    } catch (x) {}
  }
  function seekBy(sec) {
    audio.currentTime = Math.max(0, Math.min((audio.duration || Infinity) - 1, audio.currentTime + sec));
    updatePositionState(); savePos(true);
  }
  if ('mediaSession' in navigator) {
    var handlers = {
      play: function () { audio.play().catch(function () {}); },
      pause: function () { audio.pause(); },
      stop: function () { audio.pause(); },
      seekbackward: function (d) { seekBy(-((d && d.seekOffset) || 15)); },
      seekforward: function (d) { seekBy((d && d.seekOffset) || 30); },
      seekto: function (d) {
        if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime;
        updatePositionState(); savePos(true);
      },
      previoustrack: null, nexttrack: null
    };
    Object.keys(handlers).forEach(function (k) {
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (x) {}
    });
  }
  ['loadedmetadata', 'ratechange', 'seeked', 'play', 'pause'].forEach(function (ev) {
    audio.addEventListener(ev, function () {
      updatePositionState();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    });
  });

  function savePos(force) {
    if (!current || !audio.src || isNaN(audio.currentTime)) return;
    var now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    if (audio.currentTime > 3) {
      progress.pos[String(current.num)] = { i: current.idx, t: Math.floor(audio.currentTime), at: now };
      save(); refreshStatus();
    }
  }

  audio.addEventListener('timeupdate', function () { savePos(false); });
  audio.addEventListener('pause', function () { savePos(true); document.body.classList.remove('playing'); });
  audio.addEventListener('playing', function () { document.body.classList.add('playing'); });
  audio.addEventListener('ended', function () {
    if (!current) return;
    var num = current.num;
    delete progress.pos[String(num)];
    act([num], true, 'Finished episode ' + num);
    if (settings.autoplay) {
      var nx = NL.firstUnfinished(cat, progress);
      if (nx) {
        play(nx.num, resumeOf(nx.num) ? resumeOf(nx.num).i : nx.primary);
        say('actionMsg', 'Finished episode ' + num + ' · auto-playing episode ' + nx.num);
      }
    }
  });
  window.addEventListener('pagehide', function () { savePos(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) savePos(true); });

  $('back15').onclick = function () { seekBy(-15); };
  $('fwd30').onclick = function () { seekBy(30); };
  var rates = [1, 1.25, 1.5, 2, 0.75];
  $('rateBtn').onclick = function () {
    var r = rates[(rates.indexOf(audio.playbackRate) + 1) % rates.length] || 1;
    audio.playbackRate = r; this.textContent = r + '×';
  };
  $('closePlayer').onclick = function () { savePos(true); audio.pause(); $('player').classList.remove('on'); current = null; };

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-play],[data-finish-next]');
    if (!t) return;
    if (t.hasAttribute('data-play')) {
      var p = t.getAttribute('data-play').split(':');
      play(+p[0], +p[1]);
    } else {
      var num = +t.getAttribute('data-finish-next');
      var wasPlaying = current && current.num === num;
      delete progress.pos[String(num)];
      act([num], true, 'Finished episode ' + num);
      var nx = NL.firstUnfinished(cat, progress);
      if (wasPlaying && nx) play(nx.num, nx.primary);
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('autoToggle')) {
      settings.autoplay = t.checked;
      saveSettings(); syncAutoToggles();
      say('actionMsg', t.checked ? 'Auto-play on: the next unfinished episode starts when one ends.' : 'Auto-play off: playback stops after each episode.');
      return;
    }
    if (!t.hasAttribute || !t.hasAttribute('data-check')) return;
    var num = +t.getAttribute('data-check');
    act([num], t.checked, (t.checked ? 'Ticked' : 'Unticked') + ' episode ' + num);
  });

  $('undoBtn').onclick = function () {
    var label = NL.undo(progress);
    save(); refreshStatus();
    say('actionMsg', label ? 'Undid: ' + label : '');
  };

  $('partwayForm').onsubmit = function (ev) {
    ev.preventDefault();
    var n = parseInt($('partwayInput').value, 10);
    if (!cat) return;
    if (isNaN(n) || n <= NL.MAIN_START || n > cat.latest + 1) {
      say('partwayMsg', 'Enter an episode number from ' + (NL.MAIN_START + 1) + ' to ' + (cat.latest + 1) + '.');
      return;
    }
    var nums = cat.available.filter(function (x) { return x < n; });
    var changed = act(nums, true, 'Marked ' + NL.MAIN_START + '–' + (n - 1) + ' finished');
    say('partwayMsg', changed + ' episode(s) marked finished. Up next is now the first unfinished episode from ' + n + ' on (or earlier if you unticked any).');
    $('partwayInput').value = '';
  };

  $('jumpBtn').onclick = function () {
    var nx = cat && NL.firstUnfinished(cat, progress);
    if (!nx) return;
    var d = document.querySelector('[data-group="' + Math.floor(nx.num / 100) * 100 + '"]');
    if (d) d.open = true;
    var row = $('ep-' + nx.num);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  $('refreshBtn').onclick = function () { refresh(false); };

  $('exportBtn').onclick = function () {
    var blob = new Blob([JSON.stringify({ app: 'ngalutfota-tracker', savedAt: new Date().toISOString(), progress: progress }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ngalutfota-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  $('importFile').onchange = function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var data = JSON.parse(txt), p = data.progress || data;
      if (!p || typeof p.finished !== 'object') throw new Error('not a progress backup');
      progress = { finished: p.finished, pos: p.pos || {}, undo: [] };
      save(); refreshStatus();
      say('refreshMsg', 'Restored ' + Object.keys(progress.finished).length + ' finished episodes from backup.');
    }).catch(function (e) { say('refreshMsg', 'Restore failed: ' + e.message); });
    this.value = '';
  };

  // ---------- navbar: highlight the section in view ----------
  (function () {
    var links = [].slice.call(document.querySelectorAll('.navlinks a'));
    function update() {
      var y = window.scrollY + 140, active = links[0];
      links.forEach(function (a) {
        var el = document.querySelector(a.getAttribute('href'));
        if (el && el.getBoundingClientRect().top + window.scrollY <= y) active = a;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = links[links.length - 1];
      links.forEach(function (a) { a.classList.toggle('on', a === active); });
    }
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return; queued = true;
      requestAnimationFrame(function () { queued = false; update(); });
    }, { passive: true });
    links.forEach(function (a) {
      a.addEventListener('click', function (ev) {
        var el = document.querySelector(a.getAttribute('href'));
        if (!el) return;
        ev.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  })();

  // ---------- start ----------
  var cached = NL.loadCachedClips(store);
  if (cached && cached.clips && cached.clips.length) {
    useClips(cached.clips, cached.fetchedAt);
    // quietly re-check if the saved catalogue is older than 12 hours
    if (!cached.fetchedAt || Date.now() - new Date(cached.fetchedAt).getTime() > 12 * 3600 * 1000) refresh(true);
  } else {
    refresh(false).then(function () { if (!cat) $('upNextBody').textContent = 'Could not load the catalogue. Check your connection and press "Check for new episodes".'; });
  }
})();
