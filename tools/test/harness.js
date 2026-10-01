// Shared test harness for the Deluge web UI: log in once per page, open and
// close windows on it, and wait for conditions rather than fixed times.
const { chromium } = require('playwright');

// The web UI to test and its password (a throwaway test server: the checks
// change nothing, but they open every window)
const URL = process.env.DELUGE_URL || 'http://localhost:8112/';
const PASSWORD = process.env.DELUGE_PASSWORD || 'deluge';
const T = 20000; // longest wait for any condition

// Errors from plugins whose daemon side isn't running (Blocklist without
// a list) aren't the theme's
const ignore = msg => /get_status/.test(msg);

// A logged-in page with a torrent selected. opts: width, height, dpr,
// mode ('bottom' / 'right' / null: the details layout), style (CSS added
// before logging in), onLogin(page) (runs while the login window shows).
async function openDeluge(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 1440, height: opts.height || 900 },
    deviceScaleFactor: opts.dpr || 1,
  });
  await ctx.addInitScript(m => {
    try { localStorage.clear(); if (m) localStorage.setItem('darkhand.detailsMode', m); } catch (e) {}
  }, opts.mode || '');
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!ignore(e.message)) console.log('pageerror', e.message); });
  await page.goto(URL);
  // Either the login window or, with a session, the loaded torrent list
  await page.waitForFunction(() => {
    const pw = document.querySelector('input[type=password]');
    return (pw && pw.offsetParent) || (window.deluge && deluge.torrents && deluge.torrents.getStore().getCount() > 0);
  }, null, { timeout: T });
  if (opts.style) await page.addStyleTag({ content: opts.style });
  if (await page.$('input[type=password]:visible')) {
    if (opts.onLogin) { await settle(page); await opts.onLogin(page); }
    await page.fill('input[type=password]', PASSWORD);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.deluge && deluge.torrents && deluge.torrents.getStore().getCount() > 1, null, { timeout: T });
  await selectTorrent(page, 1);
  await page.mouse.move(0, 0);
  return { ctx, page };
}

// Fonts loaded, two frames drawn, and a moment for resize observers and
// Ext's deferred layouts to finish
async function settle(page, ms = 250) {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.waitForTimeout(ms);
}

// Select a torrent and wait for the details card to fill in
async function selectTorrent(page, i) {
  await page.evaluate(i => deluge.torrents.getSelectionModel().selectRow(i), i);
  await waitForDetails(page);
}

// The details card filled in for the selected torrent
async function waitForDetails(page) {
  await page.waitForFunction(() => {
    const dd = [...document.querySelectorAll('#torrentDetails dd, .x-deluge-status dd')].find(d => d.offsetWidth);
    return dd && dd.textContent.trim();
  }, null, { timeout: T }).catch(() => {});
  await settle(page, 400);
}

async function showDetailsTab(page, t) {
  await page.evaluate(t => deluge.details.setActiveTab(t), t);
  await settle(page, 450);
}

// The windows the checks open. open: runs in the page; ready: true once
// the window's contents (which some load from the daemon) are in.
const WINDOWS = {
  prefs: { open: () => deluge.preferences.show() },
  'prefs-network': { open: () => { deluge.preferences.show(); deluge.preferences.selectPage(_('Network')); } },
  'prefs-plugins': {
    open: () => { deluge.preferences.show(); deluge.preferences.selectPage(_('Plugins')); },
    ready: () => Object.values(deluge.preferences.pages).some(p => p.list && p.list.getStore && p.list.getStore().getCount() > 0 && p.isVisible()),
  },
  cm: {
    open: () => deluge.connectionManager.show(),
    // Deluge enables Stop Daemon once the host's status arrives
    ready: () => { const r = deluge.connectionManager.list.getStore().getAt(0); return r && r.get('status'); },
  },
  'add-connection': {
    open: () => { deluge.connectionManager.show(); deluge.connectionManager.onAddClick(); },
    ready: () => { const r = deluge.connectionManager.list.getStore().getAt(0); return r && r.get('status'); },
  },
  add: { open: () => deluge.add.show() },
  'add-options': { open: () => { deluge.add.show(); deluge.add.optionsPanel.setActiveTab(1); } },
  'add-url': { open: () => { deluge.add.show(); deluge.add.onUrl(); } },
  remove: { open: () => deluge.removeWindow.show([deluge.torrents.getStore().getAt(1).id]) },
  move: { open: () => deluge.moveStorage.show([deluge.torrents.getStore().getAt(1).id]) },
  trackers: {
    open: () => deluge.editTrackers.show(),
    ready: () => deluge.editTrackers.list.getStore().getCount() > 0,
  },
  'copy-magnet': { open: () => deluge.copyMagnetWindow.show() },
  // Dialogs opened from other windows (then: opens it once the first is ready)
  'edit-connection': {
    open: () => deluge.connectionManager.show(),
    ready: () => { const r = deluge.connectionManager.list.getStore().getAt(0); return r && r.get('status'); },
    then: () => { const cm = deluge.connectionManager; cm.list.select(0); cm.onEditClick(); },
  },
  'edit-tracker': {
    open: () => deluge.editTrackers.show(),
    ready: () => deluge.editTrackers.list.getStore().getCount() > 0,
    then: () => { const w = deluge.editTrackers; w.editWindow.show(w.list.getStore().getAt(0)); },
  },
  'add-tracker': {
    open: () => deluge.editTrackers.show(),
    ready: () => deluge.editTrackers.list.getStore().getCount() > 0,
    then: () => deluge.editTrackers.addWindow.show(),
  },
  // The speed chart's Custom... range (its range menu, then Custom...)
  'chart-range': {
    open: () => {
      document.getElementById('dh-chart-range').click();
      [...document.querySelectorAll('.x-menu a.x-menu-item')].find(a => a.offsetWidth && /^Custom/.test(a.textContent)).click();
    },
  },
  // The status bar's "Other..." limits, with a unit and without
  'other-limit': { open: () => { window.__ol = window.__ol || new Deluge.OtherLimitWindow({ title: _('Set Maximum Download Speed'), unit: _('KiB/s'), group: 'max_download_speed' }); window.__ol.show(); } },
  'other-limit-plain': { open: () => { window.__ol2 = window.__ol2 || new Deluge.OtherLimitWindow({ title: _('Set Maximum Connections'), group: 'max_connections_global' }); window.__ol2.show(); } },
  prompt: { open: () => Ext.MessageBox.prompt('Name', 'Please enter your name:') },
  wait: { open: () => Ext.MessageBox.wait(_('Uploading your plugin...'), _('Please wait...')) },
  msg: { open: () => Ext.Msg.show({ title: 'Change Default Password', msg: 'We recommend changing the default password.<br><br>Would you like to change it now?', buttons: Ext.Msg.YESNO, icon: Ext.MessageBox.QUESTION }) },
  error: { open: () => Ext.MessageBox.show({ title: _('Error'), msg: 'Could not connect to the daemon.', buttons: Ext.MessageBox.OK, icon: Ext.MessageBox.ERROR }) },
  warning: { open: () => Ext.MessageBox.show({ title: 'Warning', msg: 'Something to check.', buttons: Ext.MessageBox.OK, icon: Ext.MessageBox.WARNING }) },
  about: {
    open: () => { window.__about = new Deluge.about.AboutWindow(); window.__about.show(); },
    // it fetches the version numbers
    ready: () => /libtorrent:\s*\d/.test(window.__about.el.dom.textContent),
  },
};

// The topmost visible window
function topWindow() {
  const w = [...document.querySelectorAll('.x-window')].filter(e => e.offsetWidth && getComputedStyle(e).visibility !== 'hidden');
  w.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0));
  return w[0] || null;
}

// name: one of WINDOWS, or a spec of the same shape
async function openWindow(page, name) {
  const w = typeof name === 'string' ? WINDOWS[name] : name;
  // (void: what they return, often an Ext component, isn't sent back)
  await page.evaluate(`void (${w.open.toString()})()`);
  await page.waitForFunction(`(${topWindow.toString()})() !== null`, null, { timeout: T });
  if (w.ready) await page.waitForFunction(`!!((${w.ready.toString()})())`, null, { timeout: T });
  if (w.then) { await settle(page, 200); await page.evaluate(`void (${w.then.toString()})()`); }
  await page.mouse.move(0, 0);
  await settle(page, 300);
}

async function windowBox(page, margin = 30) {
  return page.evaluate(`(() => { const w = (${topWindow.toString()})(); const r = w.getBoundingClientRect(); const m = ${margin}; return { x: Math.max(0, r.x - m), y: Math.max(0, r.y - m), width: r.width + 2 * m, height: r.height + 2 * m }; })()`);
}

// After a right-click: wait for the menu (the page has several, hidden)
async function waitForMenu(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.x-menu')].some(m => m.offsetWidth && getComputedStyle(m).visibility !== 'hidden'), null, { timeout: T });
  await settle(page, 150);
}

async function closeWindows(page) {
  await page.evaluate(() => {
    if (Ext.Msg.isVisible()) Ext.Msg.hide();
    Ext.WindowMgr.each(w => { if (w.isVisible()) w.hide(); });
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.x-window')].some(e => e.offsetWidth && getComputedStyle(e).visibility !== 'hidden'), null, { timeout: T });
  await page.evaluate(() => { const m = document.querySelector('.x-menu'); if (m && m.offsetWidth) document.body.click(); });
  await settle(page, 100);
}

module.exports = { chromium, openDeluge, settle, selectTorrent, waitForDetails, showDetailsTab, WINDOWS, openWindow, windowBox, waitForMenu, closeWindows };
