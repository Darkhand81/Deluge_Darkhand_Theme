// Find text that's cut off anywhere: in the dashboard, its details tabs and
// menu, and every window. Run it normally, and with slightly wider text
// ("wide") to catch what a browser with wider font rendering would cut off.
//   node tools/test/cutoff.js [wide]
// Known, expected entries: a progress label "clipped by x-progress-text" (the
// bar's white copy is clipped to its fill on purpose), and details-tab
// columns past the narrow right-hand card's edge (they scroll).
const WIDE = process.argv[2] === 'wide';

const CHECK = () => {
  const out = [];
  const visible = e => { for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  document.querySelectorAll('body *').forEach(e => {
    const texts = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length || !visible(e)) return;
    const range = document.createRange(); range.setStartBefore(texts[0]); range.setEndAfter(texts[texts.length - 1]);
    const t = range.getBoundingClientRect(); if (!t.width) return;
    // the element itself truncating (ellipsis / hidden overflow)
    const cs = getComputedStyle(e);
    if (cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && e.scrollWidth > e.clientWidth + 1) {
      out.push({ text: e.textContent.trim().slice(0, 50), where: e.className.toString().split(' ').slice(0, 2).join('.') || e.tagName, how: 'truncated in own box by ' + (e.scrollWidth - e.clientWidth) + 'px' + (cs.textOverflow === 'ellipsis' ? ' (ellipsis)' : '') });
      return;
    }
    // text past a clipping ancestor
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') break; // scrollable: fine
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      const dx = Math.max(t.right - c.right, c.left - t.left), dy = Math.max(t.bottom - c.bottom, c.top - t.top);
      if (dx > 0.5 || dy > 0.5) { out.push({ text: e.textContent.trim().slice(0, 50), where: e.className.toString().split(' ').slice(0, 2).join('.') || e.tagName, how: 'clipped by ' + (a.id || a.className.toString().split(' ').slice(0, 2).join('.')) + ' by ' + Math.round(Math.max(dx, dy)) + 'px' }); break; }
    }
  });
  return out;
};


// Report label -> window (a harness name, or a spec)
const PAGES = ['Network', 'Encryption', 'Bandwidth', 'Interface', 'Other', 'Daemon', 'Queue', 'Proxy', 'Cache', 'Plugins'];
const WINDOWS = [
  ['preferences', 'prefs'],
  ...PAGES.map(pg => ['prefs ' + pg, pg === 'Plugins' ? 'prefs-plugins' : { open: new Function(`deluge.preferences.show(); deluge.preferences.selectPage(_('${pg}'));`) }]),
  ['connection-manager', 'cm'],
  ['add-connection', 'add-connection'],
  ['add-torrents', 'add'],
  ['add-torrents options', 'add-options'],
  ['add url', 'add-url'],
  ['remove', 'remove'],
  ['move-storage', 'move'],
  ['edit-trackers', 'trackers'],
  ['copy-magnet', 'copy-magnet'],
  ['message', 'msg'],
  ['error', 'error'],
  ['about', 'about'],
];

const H = require('./harness');
const STYLE = WIDE ? 'body * { letter-spacing: 0.3px !important; }' : null;

function report(out, label, list) {
  const uniq = [...new Map(list.map(x => [x.text + x.how, x])).values()];
  out.push(label + ': ' + (uniq.length ? '' : 'ok'));
  uniq.forEach(x => out.push('   "' + x.text + '"  [' + x.where + ']  ' + x.how));
}

async function dashboard(b, W, mode) {
  const out = [];
  const { ctx, page: p } = await H.openDeluge(b, { width: W, height: 900, mode, style: STYLE });
  report(out, `dashboard ${mode} ${W}`, await p.evaluate(CHECK));
  for (const tab of [1, 2, 3, 4]) {
    await H.showDetailsTab(p, tab);
    report(out, `  details tab ${tab}`, await p.evaluate(CHECK));
  }
  if (W === 1440 && mode === 'bottom') {
    await H.showDetailsTab(p, 0);
    const row = await p.$('#torrentGrid .x-grid3-row:nth-child(2)');
    await row.click({ button: 'right' });
    await H.waitForMenu(p);
    report(out, '  context menu', await p.evaluate(CHECK));
    await p.keyboard.press('Escape');
  }
  await ctx.close();
  return out;
}

async function windows(b) {
  const out = [];
  const { ctx, page: p } = await H.openDeluge(b, { width: 1440, height: 900, mode: 'bottom', style: STYLE });
  for (const [label, win] of WINDOWS) {
    await H.openWindow(p, win);
    const found = await p.evaluate(CHECK);
    // only what's inside windows (the dashboard behind was checked above)
    const inWin = await p.evaluate(() => [...document.querySelectorAll('.x-window')].filter(w => w.offsetWidth && getComputedStyle(w).visibility !== 'hidden').map(w => w.textContent));
    report(out, 'window ' + label, found.filter(x => inWin.some(t => t.includes(x.text.slice(0, 20)))));
    await H.closeWindows(p);
  }
  await ctx.close();
  return out;
}

(async () => {
  const b = await H.chromium.launch();
  const parts = await Promise.all([
    dashboard(b, 1440, 'bottom'), dashboard(b, 1440, 'right'), dashboard(b, 1024, 'bottom'), windows(b),
  ]);
  await b.close();
  console.log(parts.flat().join('\n'));
})();
