// The README's dashboard screenshots, at 1920x1080: the three layouts, and
// some of the dashboard's menus and windows. The test server has no peers,
// so the transfer speeds are simulated (in Deluge's updates, which the
// stats card and speed chart read), and the page's clock is run on five
// minutes so the chart is full. Writes to screenshots/.
//   node tools/test/readme-screenshots.js
const path = require('path');
const H = require('./harness');

const URL = process.env.DELUGE_URL || 'http://localhost:8112/';
const PASSWORD = process.env.DELUGE_PASSWORD || 'deluge';
const OUT = path.join(__dirname, '..', '..', 'screenshots');
// A torrent with a folder of files, for Add Torrents (DH_TORRENT, or
// test-server.sh's sample data)
const TORRENT = process.env.DH_TORRENT ||
  path.join(__dirname, '..', '..', 'test-server', 'torrents', 'Sintel.2010.4K.torrent');
const MIB = 1048576;

// The simulated activity: the speeds Deluge reports over time, split among
// the downloading torrents (each with its progress and ETA) and the seeding
// ones, which also get a few peers
const downRate = n => Math.max(0, Math.round((2.6 + 1.6 * Math.sin(n / 11) + 0.5 * Math.sin(n / 3.1)) * MIB));
const upRate = n => Math.max(0, Math.round((0.7 + 0.45 * Math.sin(n / 17 + 1) + 0.15 * Math.sin(n / 2.3)) * MIB));
const DOWNLOADS = [
  { share: 0.52, progress: 41.7, eta: 754, seeds: 12, peers: 4 },
  { share: 0.31, progress: 68.2, eta: 262, seeds: 7, peers: 3 },
  { share: 0.17, progress: 23.9, eta: 4920, seeds: 3, peers: 2 },
];
const SEEDS = [{ share: 0.38, peers: 5 }, { share: 0.27, peers: 3 }, { share: 0.21, peers: 2 }, { share: 0.14, peers: 1 }];

// Which of those each torrent gets: in name order within its state, fixed
// the first time it's seen
const roles = new Map();
function role(id, t, all) {
  if (!roles.has(id) && all) {
    for (const state of ['Downloading', 'Seeding']) {
      Object.keys(all).filter(k => all[k].state === state)
        .sort((a, b) => String(all[a].name).localeCompare(String(all[b].name)))
        .forEach((k, i) => { if (!roles.has(k)) roles.set(k, state === 'Downloading' ? DOWNLOADS[i] && { down: DOWNLOADS[i] } : SEEDS[i] && { up: SEEDS[i] }); });
    }
  }
  return roles.get(id);
}

function simulate(t, r, n) {
  if (!r) return;
  const set = (k, v) => { if (k in t) t[k] = v; };
  if (r.down) {
    const d = r.down;
    set('download_payload_rate', Math.round(downRate(n) * d.share));
    set('progress', d.progress);
    set('eta', d.eta);
    if (t.total_wanted) {
      set('total_done', Math.round(t.total_wanted * d.progress / 100));
      set('total_remaining', Math.round(t.total_wanted * (1 - d.progress / 100)));
    }
    set('num_seeds', d.seeds); set('total_seeds', d.seeds * 4);
    set('num_peers', d.peers); set('total_peers', d.peers * 6);
  } else if (r.up) {
    set('upload_payload_rate', Math.round(upRate(n) * r.up.share));
    set('num_peers', r.up.peers); set('total_peers', r.up.peers * 5);
  }
}

// A logged-in dashboard with simulated speeds and a full chart
async function dashboard(browser, details, stats) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(([d, s]) => {
    try {
      localStorage.clear();
      localStorage.setItem('darkhand.detailsMode', d);
      localStorage.setItem('darkhand.statsPosition', s);
    } catch (e) {}
  }, [details, stats]);
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/get_status/.test(e.message)) console.log('pageerror', e.message); });
  let n = 0;
  await page.route('**/json', async route => {
    const body = route.request().postDataJSON();
    const method = body && body.method;
    if (method !== 'web.update_ui' && method !== 'web.get_torrent_status') return route.continue();
    const res = await route.fetch();
    const json = await res.json();
    const result = json.result;
    if (method === 'web.update_ui' && result && result.stats) {
      n++;
      result.stats.download_rate = downRate(n);
      result.stats.upload_rate = upRate(n);
      if ('num_connections' in result.stats) result.stats.num_connections = 37;
      if ('dht_nodes' in result.stats) result.stats.dht_nodes = 286;
      const torrents = result.torrents || {};
      Object.keys(torrents).forEach(id => simulate(torrents[id], role(id, torrents[id], torrents), n));
      // Every downloading and seeding torrent is active
      const states = result.filters && result.filters.state;
      if (states) {
        const active = Object.values(torrents).filter(t => t.state === 'Downloading' || t.state === 'Seeding').length;
        states.forEach(f => { if (f[0] === 'Active') f[1] = active; });
      }
    } else if (method === 'web.get_torrent_status' && result) {
      simulate(result, role(body.params[0]), n);
    }
    await route.fulfill({ response: res, json });
  });
  // The page's timers on a clock this script runs (Deluge updates every 2s)
  await page.clock.install();
  await page.goto(URL);
  await page.waitForSelector('input[type=password]', { state: 'visible', timeout: 20000 });
  await page.fill('input[type=password]', PASSWORD);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 40; i++) {
    await page.clock.runFor(250);
    if (await page.evaluate(() => window.deluge && deluge.torrents && deluge.torrents.getStore().getCount() > 1)) break;
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => deluge.torrents.getSelectionModel().selectRow(1));
  for (let i = 0; i < 160; i++) {
    await page.clock.runFor(2000);
    await page.waitForTimeout(30);
  }
  // Real time again, for the menus and windows
  await page.clock.resume();
  await H.settle(page, 600);
  await page.mouse.move(0, 0);
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

(async () => {
  const b = await H.chromium.launch();

  for (const [details, stats, name] of [['right', 'below', 'dashboard-right.png'], ['bottom', 'above', 'dashboard-stats-above.png']]) {
    const { ctx, page } = await dashboard(b, details, stats);
    await shot(page, name);
    await ctx.close();
  }

  // The default layout, then its menus and windows over it
  const { ctx, page } = await dashboard(b, 'bottom', 'below');
  await shot(page, 'dashboard-default.png');

  // The torrent menu, with Options and a speed limit open
  const row = await page.$('#torrentGrid .x-grid3-row:nth-child(2)');
  await row.hover();
  await H.settle(page, 200);
  await row.click({ button: 'right' });
  await H.waitForMenu(page);
  const hover = async (text, inner) => {
    const p = await page.evaluate(([t, inner]) => {
      const items = [...document.querySelectorAll('.x-menu a.x-menu-item')].filter(a => a.offsetWidth && a.textContent.trim() === t);
      const a = inner ? items[items.length - 1] : items[0];
      const r = a.getBoundingClientRect();
      return { x: r.x + 30, y: r.y + r.height / 2 };
    }, [text, inner]);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await H.settle(page, 500);
  };
  await hover('Options');
  await hover('D/L Speed Limit', true);
  await shot(page, 'dashboard-menu.png');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await H.closeWindows(page);

  // Add Torrents with a torrent of several files, its Files tab showing
  await H.openWindow(page, 'add');
  // (its File button's input: Deluge uploads the file when one is chosen)
  await page.setInputFiles('#fileUploadForm input[type=file]', TORRENT);
  await page.waitForFunction(() => deluge.add.list.getStore().getCount() > 0 && deluge.add.list.getStore().getAt(0).get('info_hash'), null, { timeout: 20000 });
  await page.evaluate(() => deluge.add.list.select(0));
  await page.waitForFunction(() => document.querySelectorAll('.dh-add .x-treegrid .x-tree-node-el').length > 1, null, { timeout: 20000 });
  await page.evaluate(() => {
    const root = deluge.add.optionsPanel.files.getRootNode();
    root.cascade(n => { if (!n.isLeaf()) n.expand(); });
  });
  await page.mouse.move(0, 0);
  await H.settle(page, 500);
  await shot(page, 'dashboard-add-torrents.png');
  await H.closeWindows(page);

  await H.openWindow(page, 'prefs');
  await shot(page, 'dashboard-preferences.png');
  await H.closeWindows(page);

  await H.openWindow(page, 'cm');
  await shot(page, 'dashboard-connection-manager.png');
  await H.closeWindows(page);

  await ctx.close();
  await b.close();
  console.log('wrote screenshots to', OUT);
})();
