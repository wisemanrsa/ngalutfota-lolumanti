// Checks the parser, grouping and progress persistence against the live Omny catalogue.
// Usage: node verify.js            (fetches live)
//        node verify.js clips.json (uses a saved raw or compact clip array)
'use strict';
var https = require('https');
var fs = require('fs');
var NL = require('./catalogue.js');

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (res) {
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

var failures = 0;
function check(ok, msg) { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; }

function memStorage() {
  var m = {};
  return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, _m: m };
}

function run(clips) {
  console.log('Clips: ' + clips.length + '\n');

  // 1. Title examples from the brief
  var examples = {
    'Ngalutfota lolumanti episode 1140': 1140,
    'SOAPY EPS 3231 (02.11.2026)': 3231,
    'NGALUTFOTA LOLUMANTI - SOAPY EPS 2810 (10.09.2024)': 2810,
    'SOAPY EPS 3133 (17.06.2026)_1': 3133,
    'SOASPY EPS 3000 (01.01.2026)': 3000,
    'Ngalutfota Lolumanti 2087(02.12.2021)': 2087,
    'Ngalutfota Lolumanti 1780 ( 28.09.2020)': 1780,
    'Ngalutfota Lolumanti 2191 (27.04.2022': 2191,
    'Say No To Xenophobia': null,
    'Africa Month on Nigeria': null,
    'Ngalutfota Lolumanti (21.01.2022)': null
  };
  Object.keys(examples).forEach(function (t) {
    var got = NL.parseTitle(t).ep;
    check(got === examples[t], 'parse "' + t + '" -> ' + got);
  });

  // 2. Every clip with a number in its title (after removing dates) gets that number
  var cat = NL.buildCatalogue(clips);
  var digitsLeft = cat.excluded.filter(function (c) { return /\d{3,}/.test(c.t.replace(/\(?\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4}\s*\)?/g, '')); });
  check(digitsLeft.length === 0, 'every numbered clip got an episode number (excluded with stray digits: ' + digitsLeft.length + ')');
  console.log('     Excluded clips (' + cat.excluded.length + '):');
  cat.excluded.forEach(function (c) { console.log('       - ' + c.t); });

  // 3. No clip lost when grouping
  var grouped = 0;
  Object.keys(cat.episodes).forEach(function (n) { grouped += cat.episodes[n].uploads.length; });
  check(grouped + cat.excluded.length === clips.length, 'grouped uploads (' + grouped + ') + excluded (' + cat.excluded.length + ') = total clips (' + clips.length + ')');
  var urls = {};
  Object.keys(cat.episodes).forEach(function (n) { cat.episodes[n].uploads.forEach(function (u) { urls[u.url + '|' + u.audio] = 1; }); });
  check(Object.keys(urls).length === grouped, 'each grouped upload is distinct (' + Object.keys(urls).length + ')');
  var multi = Object.keys(cat.episodes).filter(function (n) { return cat.episodes[n].uploads.length > 1; });
  console.log('     Episodes with several uploads (' + multi.length + '): ' + multi.join(', '));

  // 4. Sequence shape
  var seqAvail = cat.sequence.filter(function (e) { return !e.missing; }).length;
  check(seqAvail === cat.available.length, 'sequence has every available main episode (' + seqAvail + ')');
  check(cat.sequence[0].num === NL.MAIN_START, 'sequence starts at ' + NL.MAIN_START);
  var olderNums = cat.older.map(function (e) { return e.num; });
  check(olderNums.join() === '1050', 'older short clips are only episode 1050 (' + olderNums.join() + ', ' + (cat.older[0] ? cat.older[0].uploads.length : 0) + ' uploads)');
  var gaps = cat.sequence.filter(function (e) { return e.missing; }).map(function (e) { return e.num; });
  console.log('     Latest: ' + cat.latest + ' · available: ' + cat.available.length + ' · not online: ' + gaps.length);
  console.log('     Gaps: ' + compress(gaps));
  for (var i = 1; i < cat.sequence.length; i++) if (cat.sequence[i].num !== cat.sequence[i - 1].num + 1) { check(false, 'sequence is contiguous'); break; }

  // 5. Progress survives restart and catalogue refresh
  var storage = memStorage();
  var p = NL.loadProgress(storage);
  var partway = cat.available.filter(function (n) { return n < 1500; });
  NL.setFinished(p, partway, true, 'Marked 1140-1499 finished');
  NL.setFinished(p, [1600], true, 'Ticked 1600');
  p.pos['1500'] = { i: 0, t: 321, at: Date.now() };
  NL.saveProgress(storage, p);
  var before = JSON.stringify(p.finished);

  var p2 = NL.loadProgress(storage); // "restart"
  check(JSON.stringify(p2.finished) === before && p2.pos['1500'].t === 321, 'progress + listening position survive a restart');
  check(NL.firstUnfinished(cat, p2).num === firstAvailFrom(cat, 1500), 'up next after restart = first unfinished (' + NL.firstUnfinished(cat, p2).num + ')');

  // refresh: simulate a new catalogue with the newest 50 clips missing, then with them back and reordered
  var older = NL.buildCatalogue(clips.slice(50));
  var reordered = NL.buildCatalogue(clips.slice().reverse());
  check(NL.finishedCount(older, p2) === NL.finishedCount(cat, p2), 'finished count unchanged when catalogue shrinks/grows (' + NL.finishedCount(cat, p2) + ')');
  check(NL.finishedCount(reordered, p2) === NL.finishedCount(cat, p2) && NL.firstUnfinished(reordered, p2).num === NL.firstUnfinished(cat, p2).num,
    'progress unchanged when upload order changes');
  check(reordered.latest === cat.latest && older.latest <= cat.latest, 'refresh adds new episodes at the end (' + older.latest + ' -> ' + cat.latest + ')');

  // undo
  NL.setFinished(p2, [1500], true, 'Ticked 1500');
  check(NL.undo(p2) === 'Ticked 1500' && !NL.isFinished(p2, 1500), 'undo reverts the last action');
  check(NL.undo(p2) === 'Ticked 1600' && !NL.isFinished(p2, 1600) && NL.isFinished(p2, partway[partway.length - 1]), 'undo again reverts the previous action only');

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All checks passed'));
  process.exit(failures ? 1 : 0);
}

function firstAvailFrom(cat, n) { return cat.available.filter(function (x) { return x >= n; })[0]; }
function compress(nums) {
  var out = [], s = null, prev = null;
  nums.concat([null]).forEach(function (n) {
    if (s != null && n === prev + 1) { prev = n; return; }
    if (s != null) out.push(s === prev ? '' + s : s + '–' + prev);
    s = prev = n;
  });
  return out.join(', ');
}

var file = process.argv[2];
if (file) {
  var raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  run(raw.map(function (c) { return c.Title !== undefined ? NL.compactClip(c) : c; }));
} else {
  NL.fetchAllClips(fetchJson, function (pg, n) { process.stdout.write('\rFetching page ' + pg + ' (' + n + ')'); })
    .then(function (clips) { process.stdout.write('\n'); run(clips); })
    .catch(function (e) { console.error(e); process.exit(1); });
}
