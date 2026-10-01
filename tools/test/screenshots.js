// Screenshots for visual regression checks: the dashboard (both details
// layouts, two widths), its details tabs, context menu and windows; or the
// plain theme (plugin off: pass "theme"). They go to test-output/<tag>/;
// compare two sets with compare.py.
//   node tools/test/screenshots.js <tag> [theme]
const fs = require('fs');
const H = require('./harness');
const TAG = process.argv[2];
const THEME = process.argv[3] === 'theme';
if (!TAG) { console.error('usage: node tools/test/screenshots.js <tag> [theme]'); process.exit(2); }
const OUT = `test-output/${TAG}`;
fs.mkdirSync(OUT, { recursive: true });

const WINDOWS = ['prefs', 'prefs-network', 'prefs-plugins', 'cm', 'add-connection', 'edit-connection', 'add',
  'add-url', 'remove', 'move', 'copy-magnet', 'trackers', 'edit-tracker', 'add-tracker', 'other-limit',
  'other-limit-plain', 'chart-range', 'msg', 'error', 'warning', 'prompt', 'wait', 'about'];

// One layout: the page, its details tabs, and the context menu
async function layout(b, [W, Hh, mode]) {
  const name = mode || 'theme';
  const { ctx, page } = await H.openDeluge(b, {
    width: W, height: Hh, mode,
    // one login screenshot per width (the right-hand layout shares 1440)
    onLogin: mode === 'right' ? null : p => p.screenshot({ path: `${OUT}/login-${W}.png` }),
  });
  await page.screenshot({ path: `${OUT}/page-${name}-${W}.png` });
  if (W === 1440) {
    for (const t of [1, 2, 3]) {
      await H.showDetailsTab(page, t);
      await page.screenshot({ path: `${OUT}/page-${name}-tab${t}.png` });
    }
    await H.showDetailsTab(page, 0);
    const row = await page.$('#torrentGrid .x-grid3-row:nth-child(3)');
    await row.hover();
    await H.settle(page, 200); // Ext marks the row hovered before it takes a click
    await row.click({ button: 'right' });
    await H.waitForMenu(page);
    await H.waitForDetails(page); // the click selected another torrent
    await page.screenshot({ path: `${OUT}/menu-${name}.png` });
  }
  await ctx.close();
}

// Every window, one after another on one page
async function windows(b, [W, Hh, mode]) {
  const { ctx, page } = await H.openDeluge(b, { width: W, height: Hh, mode });
  for (const name of WINDOWS) {
    await H.openWindow(page, name);
    await page.screenshot({ path: `${OUT}/win-${name}.png`, clip: await H.windowBox(page) });
    await H.closeWindows(page);
  }
  await ctx.close();
}

(async () => {
  const b = await H.chromium.launch();
  const layouts = THEME ? [[1440, 900, null]] : [[1440, 900, 'bottom'], [1440, 900, 'right'], [1024, 768, 'bottom']];
  await Promise.all([...layouts.map(l => layout(b, l)), windows(b, layouts[0])]);
  await b.close();
  console.log(TAG, fs.readdirSync(OUT).length, 'shots');
})();
