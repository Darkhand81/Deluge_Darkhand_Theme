/**
 * Darkhand dashboard layout for the Deluge 2.x Web UI.
 * https://github.com/darkhand81/deluge_darkhand_theme
 *
 * Deluge builds its window in deluge.ui.initialize(): toolbar on top, filter
 * sidebar on the left, details at the bottom, status bar at the foot, all
 * inside one Ext.Viewport. Plugin scripts load before that runs, so this file
 * wraps initialize() and, at the moment Deluge creates its Viewport, builds a
 * dashboard layout from the same components instead:
 *
 *   +---------+  breadcrumb / page title          controls  +---------+
 *   |  brand  |  +--------------------------------------+  | details |
 *   |         |  | toolbar                              |  | (right, |
 *   | filters |  | torrent list                         |  | or below|
 *   |  (nav)  |  |                                      |  | the     |
 *   +---------+  +--------------------------------------+  +---------+
 *   status bar (full width)
 *
 * The navigation, torrent list and details are floating cards. The details
 * card sits below the list or on the right; a switch in the header flips
 * between the two.
 *
 * Only the arrangement changes; every component keeps its own behaviour.
 * Styling lives in the Darkhand theme (themes/darkhand/dashboard.css), scoped
 * to the "dh-dashboard" class this script puts on <body>.
 */
Ext.ns('Deluge.plugins.darkhand');

(function () {
    var MODE_KEY = 'darkhand.detailsMode';

    var state = {
        active: false, // dashboard layout built for this page
        mode: null, // details card: 'right' or 'bottom'
        statsPos: null, // stats and chart: 'above' or 'below' the list
    };

    function getMode() {
        var mode = null;
        try {
            mode = window.localStorage.getItem(MODE_KEY);
        } catch (e) {}
        // Bottom unless the right-hand layout was chosen
        return mode === 'right' ? 'right' : 'bottom';
    }

    function setMode(mode) {
        try {
            window.localStorage.setItem(MODE_KEY, mode);
        } catch (e) {}
    }

    // Details card size, saved per layout when the divider is dragged:
    // { bottom: height, right: width }
    var SIZE_KEY = 'darkhand.detailsSize';

    function getSavedSize(mode) {
        try {
            var v = JSON.parse(window.localStorage.getItem(SIZE_KEY) || '{}')[mode];
            return typeof v === 'number' && v > 0 ? v : null;
        } catch (e) {
            return null;
        }
    }

    function saveSize(mode, size) {
        try {
            var sizes = JSON.parse(window.localStorage.getItem(SIZE_KEY) || '{}');
            sizes[mode] = Math.round(size);
            window.localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
        } catch (e) {}
    }

    // Whether the details card is open, remembered across reloads (and so
    // across the Stats and Details switches, which reload the page). Open
    // unless you've closed it.
    var OPEN_KEY = 'darkhand.detailsOpen';

    function isDetailsOpen() {
        try {
            return window.localStorage.getItem(OPEN_KEY) !== '0';
        } catch (e) {
            return true;
        }
    }

    function saveDetailsOpen(open) {
        try {
            window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
        } catch (e) {}
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // Default details size scales with the window: 30% of the height at the
    // bottom (250-600px), 25% of the width on the right (400-640px). A size
    // you've dragged it to is used instead, within sensible limits.
    function detailsHeight() {
        var h = window.innerHeight || 860;
        var saved = getSavedSize('bottom');
        return saved
            ? clamp(saved, 140, Math.round(h * 0.6))
            : clamp(Math.round(h * 0.3), 250, 600);
    }

    function detailsWidth() {
        var w = window.innerWidth || 1440;
        var saved = getSavedSize('right');
        return saved ? clamp(saved, 320, 720) : clamp(Math.round(w * 0.25), 400, 640);
    }

    // Stats and speed chart above or below the torrent list
    var STATS_KEY = 'darkhand.statsPosition';

    function getStatsPosition() {
        var pos = null;
        try {
            pos = window.localStorage.getItem(STATS_KEY);
        } catch (e) {}
        // Below the list unless above was chosen
        return pos === 'above' ? 'above' : 'below';
    }

    function setStatsPosition(pos) {
        try {
            window.localStorage.setItem(STATS_KEY, pos);
        } catch (e) {}
    }

    // A labelled two-way switch; data-pref names the setting it changes.
    function switchHtml(pref, label, current, options) {
        // The title attribute keeps the label as a tooltip when the compact
        // header hides it.
        var html =
            '<span class="dh-seg-label">' + label + '</span>' +
            '<div class="dh-seg" title="' + label + '">';
        Ext.each(options, function (opt) {
            html +=
                '<button type="button" class="dh-seg-btn' +
                (opt[0] === current ? ' dh-seg-active' : '') +
                '" data-pref="' + pref + '" data-value="' + opt[0] + '">' +
                opt[1] +
                '</button>';
        });
        return html + '</div>';
    }

    function headerHtml(mode, statsPos) {
        return (
            '<div class="dh-header-wrap">' +
            '<div class="dh-header-inner">' +
            '<div class="dh-heading">' +
            '<div class="dh-breadcrumb">Deluge <span>/</span> ' +
            '<span id="dh-crumb">Torrents</span></div>' +
            '<h1 id="dh-title">All Torrents</h1>' +
            '</div>' +
            '<div class="dh-header-tools">' +
            switchHtml('stats', 'Stats', statsPos, [['above', 'Above'], ['below', 'Below']]) +
            switchHtml('details', 'Details', mode, [['right', 'Right'], ['bottom', 'Bottom']]) +
            '</div>' +
            '</div>' +
            '</div>'
        );
    }

    // When the title and the switches don't both fit, hide the switch labels
    // and tighten the buttons rather than wrapping the title.
    function fitTitle() {
        var inner = Ext.get(document.querySelector('.dh-header-inner'));
        var title = document.getElementById('dh-title');
        if (!inner || !title) return;
        inner.removeClass('dh-header-compact');
        // The title truncates itself with an ellipsis, so compare its full
        // width with the width it's given
        if (title.scrollWidth > title.clientWidth + 1) {
            inner.addClass('dh-header-compact');
        }
    }

    // Stats card and speed chart, shown above or below the torrent list
    function overviewHtml() {
        return (
            '<div class="dh-overview-wrap">' +
            '<div class="dh-overview">' +
            statsHtml() +
            chartHtml() +
            '</div>' +
            '</div>'
        );
    }

    // Stats shown under the page title, as sections of one card. Values come from the regular
    // web.update_ui poll (data.stats and data.filters), so they cost nothing
    // extra.
    var STATS = [
        { key: 'download', label: 'Download' },
        { key: 'upload', label: 'Upload' },
        { key: 'active', label: 'Active torrents' },
        { key: 'connections', label: 'Connections' },
        { key: 'dht', label: 'DHT nodes' },
        { key: 'space', label: 'Free space' },
    ];

    function statsHtml() {
        var html = '<div class="dh-stats" id="dh-stats">';
        Ext.each(STATS, function (stat) {
            html +=
                '<div class="dh-stat dh-stat-' +
                stat.key +
                '">' +
                '<span class="dh-stat-icon"></span>' +
                '<div class="dh-stat-text">' +
                '<div class="dh-stat-label">' +
                stat.label +
                '</div>' +
                '<div class="dh-stat-value" id="dh-stat-' +
                stat.key +
                '">&ndash;</div>' +
                '<div class="dh-stat-sub" id="dh-stat-' +
                stat.key +
                '-sub">&nbsp;</div>' +
                '</div>' +
                '</div>';
        });
        return html + '</div>';
    }

    function setStat(key, value, sub) {
        var el = document.getElementById('dh-stat-' + key);
        if (el) el.innerHTML = Ext.util.Format.htmlEncode(String(value));
        el = document.getElementById('dh-stat-' + key + '-sub');
        if (el) el.innerHTML = Ext.util.Format.htmlEncode(String(sub)) || '&nbsp;';
    }

    // Speed limits are in KiB/s; -1 (or 0) means no limit.
    function limitText(kib) {
        return kib > 0 ? 'Limit ' + fspeed(kib * 1024, true) : 'No limit';
    }

    function updateStats(data) {
        var stats = (data && data.stats) || {};
        var states = {};
        var filters = (data && data.filters) || {};
        Ext.each(filters.state || [], function (pair) {
            states[pair[0]] = pair[1];
        });

        setStat(
            'download',
            fspeed(stats.download_rate || 0, true),
            limitText(stats.max_download)
        );
        setStat(
            'upload',
            fspeed(stats.upload_rate || 0, true),
            limitText(stats.max_upload)
        );
        setStat(
            'active',
            states.Active || 0,
            // "3 ↓ · 4 ↑": downloading and seeding, like the card icons
            (states.Downloading || 0) +
                ' \u2193 \u00b7 ' +
                (states.Seeding || 0) +
                ' \u2191'
        );
        setStat(
            'connections',
            stats.num_connections || 0,
            stats.max_num_connections > 0
                ? 'of ' + stats.max_num_connections + ' max'
                : 'No limit'
        );
        setStat(
            'dht',
            stats.dht_nodes || 0,
            stats.has_incoming_connections ? 'Incoming OK' : 'No incoming'
        );
        setFreeSpace(stats.free_space);
    }

    // Preferences, on the Downloads page (Download to)
    function openDownloadPrefs(e) {
        if (e && e.preventDefault) e.preventDefault();
        deluge.preferences.show();
        Ext.defer(function () {
            try {
                deluge.preferences.selectPage(_('Downloads'));
            } catch (err) {}
        }, 50);
        return false;
    }

    // Deluge reports -1 when the daemon can't find the download folder
    // (Preferences > Downloads > Download to): it doesn't exist, or the
    // user deluged runs as can't reach it. Its status bar just says "Error".
    function setFreeSpace(space) {
        var card = Ext.get(document.querySelector('.dh-stat-space'));
        var missing = typeof space === 'number' && space < 0;
        if (card) {
            card[missing ? 'addClass' : 'removeClass']('dh-stat-warn');
            card.dom.title = missing
                ? "Deluge can't find the download folder: it doesn't exist, or the user " +
                  'deluged runs as can’t reach it. Check Preferences › Downloads › Download to.'
                : '';
        }
        if (missing) {
            var sub = document.getElementById('dh-stat-space-sub');
            var value = document.getElementById('dh-stat-space');
            if (value) value.innerHTML = 'Folder not found';
            if (sub && !sub.querySelector('.dh-stat-link')) {
                sub.innerHTML = '<a href="#" class="dh-stat-link">Open Preferences</a>';
                sub.firstChild.onclick = openDownloadPrefs;
            }
        } else {
            setStat('space', typeof space === 'number' ? fsize(space, true) : '–', 'Download folder');
        }
    }

    // -----------------------------------------------------------------------
    // Speed chart: download and upload over the last few minutes, sampled
    // from the same update poll. Deluge's web API keeps no history, so it
    // starts empty when the page loads. Plain SVG, no chart library.
    // -----------------------------------------------------------------------

    var CHART_WINDOW = 5 * 60 * 1000; // ms of history shown
    var CHART_GAP = 10 * 1000; // ms without updates that breaks the lines
    var samples = []; // { t: ms, down: bytes/s, up: bytes/s }

    function chartHtml() {
        return (
            '<div class="dh-chart">' +
            '<div class="dh-chart-head">' +
            '<div class="dh-chart-title">Transfer speed ' +
            '<span>Last 5 minutes</span></div>' +
            '<div class="dh-chart-legend">' +
            '<span class="dh-legend-down"><i></i>Download ' +
            '<b id="dh-chart-down">&ndash;</b></span>' +
            '<span class="dh-legend-up"><i></i>Upload ' +
            '<b id="dh-chart-up">&ndash;</b></span>' +
            '</div>' +
            '</div>' +
            '<div class="dh-chart-plot" id="dh-chart-plot"></div>' +
            '</div>'
        );
    }

    function addSample(stats) {
        var now = new Date().getTime();
        samples.push({
            t: now,
            down: stats.download_rate || 0,
            up: stats.upload_rate || 0,
        });
        // Keep one sample beyond the window so the lines run off the edge
        while (samples.length > 2 && samples[1].t < now - CHART_WINDOW) {
            samples.shift();
        }
        var down = document.getElementById('dh-chart-down');
        if (down) down.innerHTML = fspeed(stats.download_rate || 0, true);
        var up = document.getElementById('dh-chart-up');
        if (up) up.innerHTML = fspeed(stats.upload_rate || 0, true);
    }

    // A round axis maximum just above the value, in the largest binary unit
    // (KiB/s, MiB/s...) below it: 1, 1.5, 2, 3, 4, 5, 6 or 8 times a power
    // of ten, so the lines use most of the chart. At least 16 KiB/s.
    function niceMax(value) {
        value = Math.max(value, 16 * 1024);
        var unit = 1;
        while (value / unit >= 1000) unit *= 1024;
        var n = value / unit;
        var decade = Math.pow(10, Math.floor(Math.log(n) / Math.LN10));
        var steps = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];
        for (var i = 0; i < steps.length; i++) {
            if (steps[i] * decade >= n) return steps[i] * decade * unit;
        }
        return 10 * decade * unit;
    }

    // Smooth path through the points without overshooting them (monotone
    // cubic interpolation, Fritsch-Carlson), so a line never dips below zero.
    function smoothPath(pts) {
        var n = pts.length;
        if (n < 2) return '';
        var i, dx = [], m = [], t = [];
        for (i = 0; i < n - 1; i++) {
            dx[i] = pts[i + 1][0] - pts[i][0];
            m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
        }
        t[0] = m[0];
        t[n - 1] = m[n - 2];
        for (i = 1; i < n - 1; i++) {
            t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
        }
        for (i = 0; i < n - 1; i++) {
            if (m[i] === 0) {
                t[i] = t[i + 1] = 0;
            } else {
                var a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
                if (h > 9) {
                    var k = 3 / Math.sqrt(h);
                    t[i] = k * a * m[i];
                    t[i + 1] = k * b * m[i];
                }
            }
        }
        var f = function (v) {
            return Math.round(v * 10) / 10;
        };
        var d = 'M' + f(pts[0][0]) + ',' + f(pts[0][1]);
        for (i = 0; i < n - 1; i++) {
            var third = dx[i] / 3;
            d +=
                'C' + f(pts[i][0] + third) + ',' + f(pts[i][1] + t[i] * third) +
                ' ' + f(pts[i + 1][0] - third) + ',' + f(pts[i + 1][1] - t[i + 1] * third) +
                ' ' + f(pts[i + 1][0]) + ',' + f(pts[i + 1][1]);
        }
        return d;
    }

    function drawChart() {
        var plot = document.getElementById('dh-chart-plot');
        if (!plot) return;
        var w = plot.clientWidth, h = plot.clientHeight;
        if (w < 20 || h < 20) return;

        var peak = 0;
        Ext.each(samples, function (s) {
            peak = Math.max(peak, s.down, s.up);
        });
        var max = niceMax(peak * 1.1);
        // Axis labels get their own column on the left, clear of the lines
        var gutter = 70;
        var top = 6, bottom = h - 6;
        var now = samples.length ? samples[samples.length - 1].t : 0;
        var x = function (t) {
            return gutter + (1 - (now - t) / CHART_WINDOW) * (w - gutter);
        };
        var y = function (v) {
            return bottom - (v / max) * (bottom - top);
        };

        var svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
            '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<defs>' +
            '<linearGradient id="dh-fill-down" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" class="dh-stop-down" stop-opacity="0.3"/>' +
            '<stop offset="1" class="dh-stop-down" stop-opacity="0"/>' +
            '</linearGradient>' +
            '<linearGradient id="dh-fill-up" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" class="dh-stop-up" stop-opacity="0.18"/>' +
            '<stop offset="1" class="dh-stop-up" stop-opacity="0"/>' +
            '</linearGradient>' +
            '</defs>';

        // Grid lines and labels at the top, middle and bottom of the scale
        Ext.each([1, 0.5, 0], function (f) {
            var gy = Math.round(y(max * f)) + 0.5;
            svg +=
                '<line class="dh-chart-grid" x1="' + gutter + '" x2="' + w +
                '" y1="' + gy + '" y2="' + gy + '"/>' +
                '<text class="dh-chart-label" text-anchor="end" x="' + (gutter - 10) +
                '" y="' + (gy + 3.5) + '">' + (f ? fspeed(max * f, true) : '0') + '</text>';
        });

        // Updates stop while the tab is in the background or the computer
        // sleeps. Break the lines at such gaps rather than drawing a ramp
        // across time nobody measured.
        var runs = [], run = [];
        Ext.each(samples, function (s, i) {
            if (i && s.t - samples[i - 1].t > CHART_GAP) {
                runs.push(run);
                run = [];
            }
            run.push(s);
        });
        runs.push(run);

        // The lines stay inside the plot, right of the axis labels: the
        // sample kept from just before the window starts left of it.
        svg +=
            '<clipPath id="dh-chart-clip"><rect x="' + gutter + '" y="0" width="' +
            (w - gutter) + '" height="' + h + '"/></clipPath>' +
            '<g clip-path="url(#dh-chart-clip)">';
        Ext.each(runs, function (run) {
            if (run.length < 2) return;
            Ext.each(['up', 'down'], function (key) {
                var pts = [];
                Ext.each(run, function (s) {
                    pts.push([x(s.t), y(s[key])]);
                });
                var line = smoothPath(pts);
                var first = pts[0][0], last = pts[pts.length - 1][0];
                svg +=
                    '<path class="dh-chart-area" fill="url(#dh-fill-' + key + ')" d="' +
                    line + 'L' + last + ',' + bottom + 'L' + first + ',' + bottom + 'Z"/>' +
                    '<path class="dh-chart-line dh-chart-' + key + '" d="' + line + '"/>';
            });
        });

        plot.innerHTML = svg + '</g></svg>';
    }

    /**
     * Lay out the stats and chart and size their region to fit them. Six
     * columns when there's room, three otherwise; with the details card on
     * the right the column's width changes as the card opens and closes, so
     * it stays at three to keep the torrent list from jumping.
     */
    function fitOverview(box) {
        // Layout polish only: never let a failure here break Deluge's UI
        try {
            doFitOverview(box);
        } catch (e) {
            if (window.console) console.error('Darkhand: stats layout failed', e);
        }
    }

    function doFitOverview(box) {
        var el = box.getEl();
        if (!el) return;
        var wrap = el.child('.dh-overview-wrap');
        var grid = el.child('.dh-stats');
        var overview = el.child('.dh-overview');
        if (!wrap || !grid || !overview) return;

        // Where the speed chart goes: beside the stats when the column is
        // wide, below them otherwise, or hidden when either would leave the
        // torrent list too short (a small window, a tall details card).
        var placements = overview.getWidth() >= 1000 ? ['side', 'below', 'off'] : ['below', 'off'];
        var side;
        for (var i = 0; i < placements.length; i++) {
            side = placements[i] === 'side';
            overview[side ? 'addClass' : 'removeClass']('dh-overview-side');
            overview[placements[i] === 'off' ? 'addClass' : 'removeClass']('dh-chart-off');
            layoutStats(grid, side);
            if (listRoom(box, wrap.getHeight()) >= MIN_LIST_HEIGHT) break;
        }

        var height = wrap.getHeight();
        if (height && height !== box.getHeight()) {
            box.setHeight(height);
            // Often called while Ext is already laying out the column (the
            // details card opening, a window resize), when a nested
            // doLayout() is silently ignored; lay out again right after.
            Ext.defer(function () {
                if (box.ownerCt) box.ownerCt.doLayout();
            }, 1);
        }
    }

    // The torrent list should keep at least this much height (toolbar,
    // column headings and about four rows).
    var MIN_LIST_HEIGHT = 220;

    // Height left for the torrent list if the stats region were this tall.
    // The list shares its column only with that region (the column already
    // shrinks as the details card grows).
    function listRoom(box, boxHeight) {
        var column = box.ownerCt;
        if (!column || !column.body) return Infinity;
        return column.body.getHeight() - boxHeight;
    }

    function layoutStats(grid, side) {
        // A stacked section needs about 160px for "1023.9 MiB/s"; one with
        // the icon beside the text needs about 230px.
        var width = grid.getWidth();
        var fits = function (n, min) {
            return width / n >= min;
        };
        var cols = fits(6, 160) ? 6 : fits(3, 160) ? 3 : 2;
        if (side || state.mode === 'right') cols = Math.min(cols, 3);
        grid.setStyle('grid-template-columns', 'repeat(' + cols + ', minmax(0, 1fr))');
        // The dividers between sections depend on the column count
        grid.removeClass(['dh-cols-2', 'dh-cols-3', 'dh-cols-6']);
        grid.addClass('dh-cols-' + cols);
        grid[fits(cols, 230) ? 'removeClass' : 'addClass']('dh-stats-compact');
    }

    // Spacing between cards and around the window edge. Where a resize bar
    // (SPLIT px wide) sits between two cards, the margin next to it is
    // reduced so the visible gap is still GAP.
    var GAP = 16;
    // The bar between the torrent list and the details card, and the strip
    // the card leaves when it's closed, are wider than Ext's 5px so they're
    // easy to see and grab; dashboard.css sets the same size.
    var SPLIT = 12;

    function margins(top, right, bottom, left) {
        return [top, right, bottom, left].join(' ');
    }

    /**
     * Change a component's layout settings before it is rendered. Ext's
     * BorderLayout reads region options (margins, split, collapseMode...)
     * from initialConfig, so both copies need updating.
     */
    function configure(component, cfg) {
        Ext.apply(component, cfg);
        Ext.apply(component.initialConfig, cfg);
    }

    /**
     * Build the dashboard Viewport from Deluge's components. Called in place
     * of `new Ext.Viewport(...)` inside deluge.ui.initialize().
     */
    function buildLayout(ui, Viewport) {
        var mode = getMode();
        var statsPos = getStatsPosition();
        state.mode = mode;
        state.statsPos = statsPos;

        Ext.getBody().addClass(['dh-dashboard', 'dh-details-' + mode, 'dh-stats-' + statsPos]);

        // The filter sidebar becomes the body of the navigation column.
        configure(deluge.sidebar, {
            region: 'center',
            split: false,
            collapsible: false,
            margins: '0 0 0 0',
        });

        var nav = new Ext.Panel({
            id: 'dh-nav',
            region: 'west',
            width: 248,
            margins: margins(GAP, 0, GAP, GAP),
            border: false,
            layout: 'border',
            items: [
                new Ext.BoxComponent({
                    id: 'dh-brand',
                    region: 'north',
                    height: 88,
                    html:
                        '<div class="dh-brand" role="button" tabindex="0" title="About Deluge">' +
                        '<span class="dh-brand-mark"></span>' +
                        '<span class="dh-brand-name">Deluge</span>' +
                        '</div>',
                }),
                deluge.sidebar,
            ],
        });

        var header = new Ext.BoxComponent({
            id: 'dh-header',
            region: 'north',
            height: 92,
            html: headerHtml(mode, statsPos),
            listeners: {
                resize: fitTitle,
            },
        });

        var overviewBox = new Ext.BoxComponent({
            id: 'dh-overview-box',
            region: statsPos === 'below' ? 'south' : 'north',
            // Resized to fit the stats and chart once rendered (fitOverview)
            height: 200,
            html: overviewHtml(),
            listeners: {
                resize: function (box) {
                    fitOverview(box);
                },
            },
        });

        // Let the Name column take up the spare width in the wider card, up
        // to 1600px (Ext's default cap is 1000px); stretchColumns() shares out
        // anything beyond that on very wide screens.
        deluge.torrents.autoExpandColumn = 'name';
        deluge.torrents.autoExpandMax = 1600;

        var tableCard = new Ext.Panel({
            id: 'dh-torrents-card',
            region: 'center',
            layout: 'fit',
            border: false,
            tbar: deluge.toolbar,
            items: [deluge.torrents],
        });

        // The torrent list and the stats region stacked in one column
        var listColumn = new Ext.Panel({
            id: 'dh-list-column',
            region: 'center',
            layout: 'border',
            border: false,
            margins:
                mode === 'bottom'
                    ? margins(0, GAP, 0, GAP)
                    : margins(0, GAP - SPLIT, GAP, GAP),
            items: [overviewBox, tableCard],
        });

        var details = ui.detailsPanel;
        var mainItems = [header, listColumn];
        var viewportItems = [nav];

        if (mode === 'bottom') {
            configure(details, {
                region: 'south',
                height: detailsHeight(),
                minSize: 140,
                split: true,
                collapsible: true,
                // Closed, the card leaves a slim strip like the right-hand
                // card's, and clicking it opens the card (Ext's default
                // collapse floats the card over the list instead)
                collapsed: !isDetailsOpen(),
                collapseMode: 'mini',
                animCollapse: false,
                useSplitTips: true,
                collapsibleSplitTip: 'Drag to resize. Double-click to close.',
                margins: margins(GAP - SPLIT, GAP, GAP, GAP),
                // Closed, the strip keeps a full gap from the cards above
                cmargins: margins(GAP, GAP, GAP, GAP),
            });
            mainItems.push(details);
        } else {
            configure(details, {
                region: 'east',
                width: detailsWidth(),
                minSize: 320,
                maxSize: 720,
                margins: margins(GAP, GAP, GAP, 0),
                cmargins: margins(GAP, GAP, GAP, 0),
                split: true,
                collapsible: true,
                collapsed: !isDetailsOpen(),
                collapseMode: 'mini',
                animCollapse: false,
                useSplitTips: true,
                collapsibleSplitTip: 'Drag to resize. Double-click to close.',
            });
        }

        var main = new Ext.Panel({
            id: 'dh-main',
            region: 'center',
            layout: 'border',
            border: false,
            items: mainItems,
        });
        viewportItems.push(main);
        if (mode === 'right') viewportItems.push(details);

        // The status bar runs along the bottom of the whole window, below
        // all the cards, which each end the same distance above it.
        var shell = new Ext.Panel({
            id: 'dh-shell',
            layout: 'border',
            border: false,
            items: viewportItems,
            bbar: deluge.statusbar,
        });

        var viewport = new Viewport({
            layout: 'fit',
            items: [shell],
        });

        state.active = true;
        wireUp(mode, details, overviewBox);
        return viewport;
    }

    // -----------------------------------------------------------------------
    // Very wide screens: once Name has reached its cap, share the remaining
    // width among the other visible columns in proportion to their widths,
    // so the columns always fill the torrent list.
    //
    // The extra is for display only. Deluge saves the grid's column widths
    // in a cookie (sorting or resizing a column saves them), so getState()
    // is wrapped to save the widths without the extra; otherwise a big
    // screen's widths would follow you to a small one.
    // -----------------------------------------------------------------------

    var stretch = {}; // column id -> px added for display

    // Columns you've resized by hand keep your width, even if their header
    // doesn't fit (remembered across reloads; Deluge saves the widths).
    var SIZED_KEY = 'darkhand.sizedColumns';

    function getSizedColumns() {
        try {
            return JSON.parse(window.localStorage.getItem(SIZED_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function markColumnSized(id) {
        try {
            var sized = getSizedColumns();
            sized[id] = true;
            window.localStorage.setItem(SIZED_KEY, JSON.stringify(sized));
        } catch (e) {}
    }

    // Width a column needs to show its whole header, sort arrow included
    function headerWidth(view, i) {
        var cell = view.getHeaderCell(i);
        var inner = cell && cell.firstChild;
        if (!inner || !inner.offsetWidth) return 0;
        var content = 0;
        Ext.each(Ext.toArray(inner.childNodes), function (node) {
            if (node.nodeType === 3) {
                var range = document.createRange();
                range.selectNodeContents(node);
                content += range.getBoundingClientRect().width;
            } else if (node.nodeType === 1 && !/x-grid3-hd-btn/.test(node.className) && node.offsetWidth) {
                var s = window.getComputedStyle(node);
                content += node.offsetWidth + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
            }
        });
        var style = window.getComputedStyle(inner);
        return Math.ceil(
            content +
                parseFloat(style.paddingLeft) +
                parseFloat(style.paddingRight) +
                (cell.offsetWidth - inner.offsetWidth)
        );
    }

    // Narrow lists: Name should keep at least this much room. Below it the
    // speed headers become "↓ Speed" / "↑ Speed", then the other columns
    // give up some width.
    var NAME_MIN = 240;
    var SHRINK_TO = 0.9; // of a column's normal width, at most

    var SPEED_HEADERS = {
        download_payload_rate: '↓ ',
        upload_payload_rate: '↑ ',
        // the details card's Peers tab
        down_speed: '↓ ',
        up_speed: '↑ ',
    };

    function setShortHeaders(view, cm, short) {
        var changed = false;
        Ext.each(cm.config, function (c, i) {
            var arrow = SPEED_HEADERS[c.dataIndex];
            if (!arrow) return;
            if (!c.dhHeader) {
                c.dhHeader = c.header;
                c.tooltip = c.header; // the full name, on hover
            }
            var text = short ? arrow + _('Speed') : c.dhHeader;
            if (c.header !== text) {
                cm.setColumnHeader(i, text);
                changed = true;
            }
        });
        // Changing a header re-renders the header row, losing the sort arrow
        if (changed) view.updateHeaderSortState();
    }

    // The Progress column shouldn't get narrower than its longest label
    // ("Downloading 99.99%", or its translation) needs. A downloading
    // torrent becomes Seeding at 100%.
    var PROGRESS_STATES = ['Downloading', 'Seeding', 'Paused', 'Checking', 'Queued', 'Error', 'Allocating', 'Moving'];
    var PROGRESS_PAD = 12; // around the label, inside the bar

    // The width of text as it would be drawn in el: its font, letter
    // spacing and capitals (which the canvas doesn't apply)
    var measureCanvas;

    function textWidth(el, text) {
        var s = window.getComputedStyle(el);
        measureCanvas = measureCanvas || document.createElement('canvas');
        var ctx = measureCanvas.getContext('2d');
        ctx.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
        if (s.textTransform === 'uppercase') text = text.toUpperCase();
        return ctx.measureText(text).width + (parseFloat(s.letterSpacing) || 0) * text.length;
    }

    function progressMinWidth(view, i) {
        if (!view.hasRows()) return 0;
        var cell = view.getCell(0, i);
        var wrap = cell && Ext.fly(cell).child('.x-progress-wrap', true);
        var label = wrap && Ext.fly(wrap).child('.x-progress-text-back > div', true);
        if (!label) return 0;
        var widest = 0;
        Ext.each(PROGRESS_STATES, function (s) {
            var pct = s === 'Downloading' ? ' 99.99%' : ' 100.00%';
            widest = Math.max(widest, textWidth(label, _(s) + pct));
        });
        // plus the room between the cell's edges and the bar's track
        return Math.ceil(widest + PROGRESS_PAD + (cell.offsetWidth - wrap.clientWidth));
    }

    // Take up to `need` px from the other columns for Name, in proportion
    // to what each can spare (never below its header, its content's
    // minimum, or SHRINK_TO of its normal width). Columns you've sized
    // yourself are left alone.
    function giveNameRoom(view, cm, nameIndex, need, sized) {
        if (need < 1) return;
        var cols = [], room = 0;
        for (var i = 0; i < cm.getColumnCount(); i++) {
            var id = cm.getColumnId(i);
            if (cm.isHidden(i) || i === nameIndex || sized[id]) continue;
            var w = cm.getColumnWidth(i);
            var floor = Math.max(headerWidth(view, i), Math.ceil((w - (stretch[id] || 0)) * SHRINK_TO));
            if (cm.config[i].dataIndex === 'progress') floor = Math.max(floor, progressMinWidth(view, i));
            if (w > floor) {
                cols.push([i, id, w - floor]);
                room += w - floor;
            }
        }
        if (!room) return;
        var share = Math.min(1, need / room);
        Ext.each(cols, function (c) {
            var take = Math.floor(c[2] * share);
            stretch[c[1]] = (stretch[c[1]] || 0) - take;
            cm.setColumnWidth(c[0], cm.getColumnWidth(c[0]) - take, true);
        });
    }

    function stretchColumns(grid) {
        try {
            doStretchColumns(grid);
        } catch (e) {
            if (window.console) console.error('Darkhand: column layout failed', e);
        }
    }

    function doStretchColumns(grid) {
        var view = grid.getView();
        var cm = grid.getColumnModel();
        if (!view.mainBody) return;
        var i, id, n = cm.getColumnCount();

        // Back to the normal widths
        for (i = 0; i < n; i++) {
            id = cm.getColumnId(i);
            if (stretch[id]) cm.setColumnWidth(i, cm.getColumnWidth(i) - stretch[id], true);
        }
        stretch = {};

        var nameIndex = cm.getIndexById(grid.autoExpandColumn);
        var inner = view.getGridInnerWidth();
        var nameRoom = function () {
            return inner - (cm.getTotalWidth(false) - cm.getColumnWidth(nameIndex));
        };

        var sized = getSizedColumns();

        // Widen columns whose header doesn't fit (the theme's spaced
        // capitals make "Down Speed" wider than Deluge's 80px), unless
        // you've sized columns yourself. Name gives up the width.
        var fitHeaders = function () {
            for (i = 0; i < n; i++) {
                id = cm.getColumnId(i);
                if (cm.isHidden(i) || i === nameIndex || sized[id]) continue;
                var needed = headerWidth(view, i);
                if (cm.config[i].dataIndex === 'progress') needed = Math.max(needed, progressMinWidth(view, i));
                var fit = needed - cm.getColumnWidth(i);
                if (fit > 0) {
                    stretch[id] = (stretch[id] || 0) + fit;
                    cm.setColumnWidth(i, cm.getColumnWidth(i) + fit, true);
                }
            }
        };

        // Room Name would have with the full headers. A speed column
        // showing its short header uses the width its full one needed
        // (remembered from when it was shown), so deciding doesn't mean
        // re-rendering the headers.
        var others = 0;
        for (i = 0; i < n; i++) {
            if (cm.isHidden(i) || i === nameIndex) continue;
            var c = cm.config[i], w = cm.getColumnWidth(i);
            if (!sized[cm.getColumnId(i)]) {
                var short = SPEED_HEADERS[c.dataIndex] && c.dhHeader && c.header !== c.dhHeader;
                var need = short ? c.dhFullWidth || 0 : headerWidth(view, i);
                if (SPEED_HEADERS[c.dataIndex] && !short) c.dhFullWidth = need;
                if (c.dataIndex === 'progress') need = Math.max(need, progressMinWidth(view, i));
                w = Math.max(w, need);
            }
            others += w;
        }
        var tight = inner - others < NAME_MIN;

        // Tight: "↓ Speed" / "↑ Speed", and the other columns give up
        // some width
        setShortHeaders(view, cm, tight);
        fitHeaders();
        if (tight) giveNameRoom(view, cm, nameIndex, NAME_MIN - nameRoom(), sized);

        // Ext widens Name up to its cap
        view.autoExpand(true);

        var spare = inner - cm.getTotalWidth(false);
        if (spare >= 1) {
            var cols = [], total = 0;
            for (i = 0; i < n; i++) {
                if (cm.isHidden(i)) continue;
                // Name already has its share
                if (i === nameIndex) continue;
                cols.push(i);
                total += cm.getColumnWidth(i);
            }
            var given = 0;
            Ext.each(cols, function (i, k) {
                var add =
                    k === cols.length - 1
                        ? spare - given
                        : Math.floor((spare * cm.getColumnWidth(i)) / total);
                given += add;
                id = cm.getColumnId(i);
                stretch[id] = (stretch[id] || 0) + add;
                cm.setColumnWidth(i, cm.getColumnWidth(i) + add, true);
            });
        }
        view.updateAllColumnWidths();

        // The last visible column's grab handle sits inside its edge (the
        // others sit just past theirs, over the next column), so mark it.
        // Hidden columns follow it, so CSS can't tell which it is.
        var last = -1;
        for (i = 0; i < n; i++) {
            var cell = view.getHeaderCell(i);
            if (cell) Ext.fly(cell).removeClass('dh-hd-last');
            if (!cm.isHidden(i)) last = i;
        }
        if (last >= 0 && view.getHeaderCell(last)) Ext.fly(view.getHeaderCell(last)).addClass('dh-hd-last');
    }

    function setUpColumnStretch(grid) {
        var view = grid.getView();
        var cm = grid.getColumnModel();
        var busy = false;
        // Deluge draws each progress bar (and centres its label) at the
        // column's width when the row is rendered, and only re-renders rows
        // whose data changed. When the Progress column's width changes,
        // redraw the rows so seeding and paused torrents' bars match it.
        var progressWidth = function () {
            var i = cm.findColumnIndex('progress');
            return i < 0 ? 0 : cm.getColumnWidth(i);
        };
        var drawnWidth = progressWidth();
        view.on('refresh', function () {
            drawnWidth = progressWidth();
        });

        var restretch = function () {
            if (busy) return;
            busy = true;
            stretchColumns(grid);
            if (progressWidth() !== drawnWidth && view.hasRows()) {
                try {
                    view.refresh();
                } catch (e) {
                    if (window.console) console.error('Darkhand: redraw failed', e);
                }
            }
            busy = false;
        };

        // After every layout of the grid (window and card resizes). Hook
        // onLayout, which ends each layout: some resizes (opening the right
        // details card) reach the layout without going through view.layout.
        var onLayout = view.onLayout;
        view.onLayout = function () {
            var result = onLayout.apply(this, arguments);
            restretch();
            return result;
        };

        // Dragging a column's edge: the width you choose becomes that
        // column's normal width. Forget its extra before Ext saves the state.
        // Ext also marks the grid "user resized", which would stop Name
        // filling the list (and the columns following the window's width)
        // for the rest of the session; clear that, so Name keeps taking up
        // whatever the other columns leave.
        var splitterMoved = view.onColumnSplitterMoved;
        view.onColumnSplitterMoved = function (cellIndex) {
            delete stretch[cm.getColumnId(cellIndex)];
            markColumnSized(cm.getColumnId(cellIndex));
            var result = splitterMoved.apply(this, arguments);
            this.userResized = false;
            restretch();
            return result;
        };

        cm.on('hiddenchange', restretch);
        // The sort arrow makes a header wider
        grid.on('sortchange', restretch);

        var getState = grid.getState;
        grid.getState = function () {
            var st = getState.apply(this, arguments);
            Ext.each((st && st.columns) || [], function (c) {
                if (stretch[c.id]) c.width -= stretch[c.id];
            });
            return st;
        };

        restretch();
    }

    // Remember the details card's size when you drag its divider. The
    // region's split handler cancels the bar's own events, but it records
    // the new size and calls the panel's saveState, so hook that.
    function rememberDetailsSize(mode, details) {
        var original = details.saveState;
        details.saveState = function () {
            var layout = details.ownerCt && details.ownerCt.layout;
            var region = layout && layout[mode === 'bottom' ? 'south' : 'east'];
            if (region && region.lastSplitSize) {
                saveSize(mode, region.lastSplitSize);
            }
            return original.apply(this, arguments);
        };
    }

    // The brand in the navigation card opens Deluge's About window, like the
    // "Deluge" toolbar item it replaces. dashboard.css styles the window as
    // a card; its parts are tagged here, since Deluge styles them inline.
    var ABOUT_PARTS = ['logo', 'title', 'comment', 'copyright', 'link'];

    function showAbout() {
        var open = Ext.getCmp('AboutWindow');
        if (open) {
            open.toFront();
            return;
        }
        new Deluge.about.AboutWindow().show();
    }

    // Windows are cards in the dashboard (dashboard.css), with a roomier
    // title bar, footer and side padding than Ext's frame. Deluge gives most
    // of its windows a fixed size, so grow them by that much, or their
    // contents get squashed. Windows are sized when first shown, so the ones
    // Deluge creates before this script loads can still be adjusted.
    var WINDOW_EXTRA_W = 24;
    var WINDOW_EXTRA_H = 36;

    // Preferences grows by more: its tallest page (Interface) needs it with
    // the theme's row spacing (--dh-inset between rows)
    var PREFS_EXTRA_H = 36;

    function growWindow(win) {
        if (win.dhSized || win.rendered) return;
        win.dhSized = true;
        if (typeof win.width === 'number') win.width += WINDOW_EXTRA_W;
        if (typeof win.height === 'number') win.height += WINDOW_EXTRA_H;
        var Prefs = Deluge.preferences && Deluge.preferences.PreferencesWindow;
        if (Prefs && win instanceof Prefs && typeof win.height === 'number') win.height += PREFS_EXTRA_H;
    }

    // Widen a window whose footer buttons don't fit (Remove Torrent's three,
    // or any window in a browser whose fonts run a little wider): measured
    // when it's shown, and again once the web fonts have loaded.
    function fitWindowButtons(win) {
        try {
            var footer = win.el && win.el.child('.x-window-footer', true);
            if (!footer || !win.isVisible()) return;
            var row = footer.querySelector('.x-toolbar-ct');
            if (!row) return;
            var s = window.getComputedStyle(footer);
            var room = footer.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            var need = 0;
            Ext.each(Ext.toArray(row.querySelectorAll('.x-toolbar-left > table, .x-toolbar-right > table')), function (t) {
                need += t.offsetWidth;
            });
            if (need > room) {
                win.setWidth(win.getWidth() + Math.ceil(need - room));
                win.doLayout();
                win.center();
            }
        } catch (e) {}
    }

    // A small window that's just a form (Edit Tracker, Move Storage, Add
    // Connection...) keeps the padding and fixed height Deluge gave it, so
    // each sits its fields a different way inside its frame, with more room
    // below them than above. Lay it out by the theme's spacing instead
    // (dashboard.css): its fields --dh-window-pad inside the frame on every
    // side (the window widening by what the sides gain, so the fields keep
    // their width), its label column fitted to the labels, and its height to
    // the fields. Not for forms whose fields take a share of the height.
    function fitFormWindow(win) {
        try {
            if (win.html && win.items && !win.items.getCount()) {
                fitTextWindow(win);
                return;
            }
            var form = win.items && win.items.getCount() === 1 && win.items.get(0);
            if (!form || !form.isXType('form') || !win.isVisible()) return;
            var tall = false;
            form.getForm().items.each(function (f) {
                if (f.anchor && /\s\S/.test(Ext.util.Format.trim(String(f.anchor)))) tall = true;
            });
            if (tall) return;
            var pad = cssPx(win.el.dom, '--dh-window-pad', 12);
            var edges = formEdges(form);
            if (!edges) return;
            // Once: the room above and beside the fields. Not beside them
            // where the labels are right-aligned (their row is centred).
            if (!form.dhSpaced) {
                form.dhSpaced = true;
                var frame = frameInner(win, form);
                var top = pad - (edges.top - frame.top);
                var side = form.labelAlign === 'right' ? 0 : pad - (edges.left - frame.left);
                var s = window.getComputedStyle(form.body.dom);
                form.body.setStyle({
                    paddingTop: Math.max(0, parseFloat(s.paddingTop) + top) + 'px',
                    paddingLeft: Math.max(0, parseFloat(s.paddingLeft) + side) + 'px',
                    paddingRight: Math.max(0, parseFloat(s.paddingRight) + side) + 'px',
                });
                if (side) win.setWidth(win.getWidth() + 2 * side);
                win.doLayout();
                fitFormLabels(form);
                edges = formEdges(form);
                // A form with its own frame (Copy Magnet URI) grows to its
                // fields itself: the room below goes in its padding, and the
                // window grows by as much
                if (frame.own) {
                    var below = Math.round(edges.bottom + pad - frameInner(win, form).bottom);
                    form.body.setStyle('padding-bottom', Math.max(0, parseFloat(s.paddingBottom) + below) + 'px');
                    win.setHeight(win.getHeight() + below);
                    win.doLayout();
                    edges = formEdges(form);
                }
            }
            // As much room below them
            var delta = Math.round(edges.bottom + pad - frameInner(win, form).bottom);
            if (delta && win.getHeight() + delta <= Ext.lib.Dom.getViewHeight()) {
                win.setHeight(win.getHeight() + delta);
            }
            win.center();
        } catch (e) {}
    }

    // A window that's just text (Remove Torrent's question) the same way:
    // the text --dh-window-pad inside the frame, as much room below
    function fitTextWindow(win) {
        var body = win.body.dom, pad = cssPx(win.el.dom, '--dh-window-pad', 12);
        var range = document.createRange();
        range.selectNodeContents(body);
        var text = range.getBoundingClientRect();
        if (!text.height) return;
        var frame = frameInner(win, null);
        if (!win.dhSpaced) {
            win.dhSpaced = true;
            var s = window.getComputedStyle(body);
            win.body.setStyle({
                paddingTop: Math.max(0, parseFloat(s.paddingTop) + pad - (text.top - frame.top)) + 'px',
                paddingLeft: Math.max(0, parseFloat(s.paddingLeft) + pad - (text.left - frame.left)) + 'px',
                paddingRight: Math.max(0, parseFloat(s.paddingRight) + pad - (text.left - frame.left)) + 'px',
            });
            win.doLayout();
            text = range.getBoundingClientRect();
        }
        var delta = Math.round(text.bottom + pad - frameInner(win, null).bottom);
        if (delta && win.getHeight() + delta <= Ext.lib.Dom.getViewHeight()) win.setHeight(win.getHeight() + delta);
        win.center();
    }

    // The inside edge of the frame round a form window's fields: the form's
    // own, where it has a border (Copy Magnet URI), or the window's. Frames
    // are drawn 1px in, 1px wide (dashboard.css), so 2px inside the element.
    function frameInner(win, form) {
        var own = !!form && form.body.hasClass('x-panel-body') && !form.body.hasClass('x-panel-body-noborder');
        var el = own ? form.bwrap.dom : win.el.child('.x-window-mc', true);
        var r = el.getBoundingClientRect();
        return { own: own, top: r.top + 2, left: r.left + 2, right: r.right - 2, bottom: r.bottom - 2 };
    }

    // Deluge sizes a form's label column for its own font, some roomy, some
    // with a label nearly touching its field (Add Connection's "Username:").
    // Fit the column to the longest label plus --dh-label-gap, so every form
    // leaves the same gap; if it grows, only while the fields still fit.
    function fitFormLabels(form) {
        var layout = form.getLayout();
        if (!layout.labelAdjust || (form.labelAlign && form.labelAlign !== 'left')) return;
        var items = Ext.toArray(form.body.dom.querySelectorAll('.x-form-item'));
        var widest = 0, fieldsRight = 0;
        Ext.each(items, function (item) {
            var label = item.querySelector('label.x-form-item-label');
            if (label && label.offsetWidth) widest = Math.max(widest, textWidth(label, label.textContent));
            var el = item.querySelector('.x-form-element');
            Ext.each(el ? Ext.toArray(el.children) : [], function (c) {
                if (c.offsetWidth) fieldsRight = Math.max(fieldsRight, c.getBoundingClientRect().right);
            });
        });
        if (!widest) return;
        var extra = Math.ceil(widest + cssPx(form.body.dom, '--dh-label-gap', 10) - layout.labelAdjust);
        if (!extra) return;
        var body = form.body.dom, s = window.getComputedStyle(body);
        var room = body.getBoundingClientRect().right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth);
        if (extra > 0 && fieldsRight + extra > room) return;
        Ext.each(items, function (item) {
            var label = item.querySelector('label.x-form-item-label');
            var el = item.querySelector('.x-form-element');
            if (!label || !el) return;
            var ls = window.getComputedStyle(label);
            label.style.width = label.offsetWidth - parseFloat(ls.paddingLeft) - parseFloat(ls.paddingRight) + extra + 'px';
            el.style.paddingLeft = parseFloat(window.getComputedStyle(el).paddingLeft) + extra + 'px';
        });
        layout.labelAdjust += extra;
        // Ext's anchors remember the width they last sized for and skip the
        // same width again: forget them, so the fields take up the new room
        form.items.each(function (c) {
            delete c.anchorSpec;
        });
        form.doLayout();
    }

    // Preferences keeps Deluge's height, and a page taller than that
    // (Interface, with the theme's row spacing; a plugin's) would scroll.
    // Grow the window to the page when it's shown, as far as the screen
    // allows. Never shrink it, so it doesn't jump from page to page.
    function fitPreferences(prefs) {
        var doSelectPage = prefs.doSelectPage;
        prefs.doSelectPage = function (page) {
            var result = doSelectPage.apply(this, arguments);
            Ext.defer(fitPreferencesPage, 1, null, [this, this.pages[page]]);
            return result;
        };
    }

    function fitPreferencesPage(win, page) {
        try {
            if (!page || !page.body || !win.isVisible()) return;
            var body = page.body.dom, over = body.scrollHeight - body.clientHeight;
            if (over <= 1) return;
            var height = Math.min(win.getHeight() + over, Ext.lib.Dom.getViewHeight() - 2 * GAP);
            if (height > win.getHeight()) {
                win.setHeight(height);
                win.center();
            }
        } catch (e) {}
    }

    // Where a form's contents start and end (Ext's clearing divs, below the
    // last margin, have no height)
    function formEdges(form) {
        var edges = null;
        Ext.each(Ext.toArray(form.body.dom.children), function (child) {
            var r = child.getBoundingClientRect();
            if (!r.height) return;
            if (!edges) edges = { top: r.top, left: r.left, bottom: r.bottom };
            edges.left = Math.min(edges.left, r.left);
            edges.bottom = Math.max(edges.bottom, r.bottom);
        });
        return edges;
    }

    // Deluge's FormLayout fix (ext-extensions) renders a field without
    // noting its label, so Ext sizes a labelled field anchored to the full
    // width as if it had none: it runs a label's width past the form (Edit
    // Tracker, Add Tracker). Note it as Ext's own renderItem does, for those
    // only: Deluge's narrower anchors (Add Connection's 75%...) are sized
    // for the way it is.
    function fixFormLabels() {
        var renderItem = Ext.layout.FormLayout.prototype.renderItem;
        Ext.layout.FormLayout.prototype.renderItem = function (c) {
            var result = renderItem.apply(this, arguments);
            if (c && c.formItem && !c.label && /^100%/.test(String(c.anchor || ''))) {
                c.label = c.formItem.child('label.x-form-item-label');
            }
            return result;
        };
    }

    // Widen a window whose title doesn't fit on one line (the status bar's
    // "Set Maximum Download Speed", 210px wide)
    function fitWindowTitle(win) {
        try {
            var header = win.header && win.header.dom;
            var text = header && header.querySelector('.x-window-header-text');
            if (!text || !win.isVisible()) return;
            var s = window.getComputedStyle(header);
            var room = header.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            Ext.each(Ext.toArray(header.querySelectorAll('.x-tool')), function (tool) {
                if (tool.offsetWidth) room -= tool.offsetWidth;
            });
            var need = Math.ceil(textWidth(text, text.textContent)) + 8; // + room before the tools
            if (need > room) {
                win.setWidth(win.getWidth() + need - room);
                win.doLayout();
                win.center();
            }
        } catch (e) {}
    }

    // Everything fitted when a window shows: its title, buttons and height
    function fitWindow(win) {
        fitWindowTitle(win);
        fitWindowButtons(win);
        fitFormWindow(win);
    }

    function sizeWindows() {
        fixFormLabels();
        var initComponent = Ext.Window.prototype.initComponent;
        Ext.Window.prototype.initComponent = function () {
            growWindow(this);
            var result = initComponent.apply(this, arguments);
            this.on('show', function (win) {
                Ext.defer(fitWindow, 1, null, [win]);
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(function () {
                        fitWindowButtons(win);
                    });
                }
            });
            return result;
        };
        Ext.each([deluge.moveStorage, deluge.removeWindow, deluge.copyMagnetWindow], function (win) {
            if (!win) return;
            growWindow(win);
            win.on('show', function () {
                Ext.defer(fitWindow, 1, null, [win]);
            });
        });
    }

    // Login: Deluge centres a short password field under a wide,
    // right-aligned label column, leaving empty space either side of it in
    // the card. Lay it out like the other form dialogs instead: the label on
    // the left, the field filling the rest of the row (not growing as you
    // type), so fitFormWindow gives it the same spacing.
    function styleLoginWindow() {
        var Login = Deluge.LoginWindow;
        if (!Login) return;
        var initComponent = Login.prototype.initComponent;
        Login.prototype.initComponent = function () {
            var result = initComponent.apply(this, arguments);
            if (this.form && this.passwordField) {
                this.form.labelAlign = 'left';
                Ext.apply(this.passwordField, { anchor: '100%', grow: false });
                delete this.passwordField.width;
            }
            return result;
        };
    }

    function styleAboutWindow() {
        var About = Deluge.about && Deluge.about.AboutWindow;
        if (!About) return;
        // Sized for the dashboard already
        Ext.apply(About.prototype, { width: 300, height: 412, dhSized: true });
        var initComponent = About.prototype.initComponent;
        About.prototype.initComponent = function () {
            initComponent.apply(this, arguments);
            this.addClass('dh-about');
            this.items.each(function (item, i) {
                if (ABOUT_PARTS[i]) item.addClass('dh-about-' + ABOUT_PARTS[i]);
            });
        };
    }

    function setUpBrand() {
        var brand = Ext.get(document.querySelector('.dh-brand'));
        if (!brand) return;
        brand.on('click', showAbout);
        brand.on('keydown', function (e) {
            if (e.getKey() === e.ENTER || e.getKey() === e.SPACE) {
                e.preventDefault();
                showAbout();
            }
        });
    }

    // -----------------------------------------------------------------------
    // Lists in windows (Connection Manager, Edit Trackers): columns sized to
    // their text (Deluge's are fixed proportions, which cut it off), the
    // window as wide as that needs, within limits.
    // -----------------------------------------------------------------------

    var LIST_CELL_PAD = 16; // around each column's text

    // How far an inset list's rows sit in from its frame, on each side:
    // dashboard.css's --dh-inset
    function insetOf(el) {
        return cssPx(el, '--dh-inset', 6);
    }

    // A spacing token (dashboard.css) as seen from el, in px
    function cssPx(el, name, fallback) {
        var v = parseFloat(window.getComputedStyle(el).getPropertyValue(name));
        return isNaN(v) ? fallback : v;
    }

    // opts.stretch: the dataIndex of the column that takes the rest of the
    // width. opts.maxWidth: the widest the window gets (never narrower than
    // it first opened); without it the window keeps its size. Text wider
    // than the list allows is cut off, with the full text as its tooltip.
    function fitListColumns(win, list, opts) {
        try {
            doFitListColumns(win, list, opts);
        } catch (e) {
            if (window.console) console.error('Darkhand: list layout failed', e);
        }
    }

    function doFitListColumns(win, list, opts) {
        if (!list || !list.innerHd || !list.innerBody || !list.el.isVisible(true)) return;
        var cols = list.columns;
        var headers = list.innerHd.dom.querySelectorAll('em');
        var rows = list.innerBody.dom.querySelectorAll('dl');
        if (headers.length !== cols.length) return;

        // Widest text in each column, header included
        var need = [], total = 0, stretch = -1;
        Ext.each(cols, function (col, i) {
            if (col.dataIndex === opts.stretch) stretch = i;
            var w = textWidth(headers[i], headers[i].textContent);
            Ext.each(Ext.toArray(rows), function (dl) {
                var dt = dl.querySelectorAll('dt')[i];
                // the text is in the cell's <em>, which has the theme's font
                var text = dt && (dt.querySelector('em') || dt);
                if (text) w = Math.max(w, textWidth(text, text.textContent));
            });
            need[i] = Math.ceil(w) + LIST_CELL_PAD;
            total += need[i];
        });
        var inset = list.el.hasClass('dh-inset') ? 2 * insetOf(list.el.dom) : 0;

        // Size the window to the text (the list fills it)
        var avail = list.innerHd.getWidth() - inset;
        if (win && opts.maxWidth) {
            win.dhBaseWidth = win.dhBaseWidth || win.getWidth();
            var maxWidth = Math.max(win.dhBaseWidth, Math.min(opts.maxWidth, Ext.lib.Dom.getViewWidth() - 48));
            var width = Math.max(win.dhBaseWidth, Math.min(maxWidth, win.getWidth() + total - avail));
            if (Math.abs(width - win.getWidth()) > 1) {
                win.setWidth(width);
                win.doLayout();
                win.center();
                avail = list.innerHd.getWidth() - inset;
            }
        }
        if (avail <= 0) return;

        // Each column gets its width, the stretch column the rest (Ext's list
        // columns are fractions of its width)
        var widths = [], used = 0, changed = false;
        Ext.each(cols, function (col, i) {
            if (i === stretch) return;
            widths[i] = Math.round((need[i] / avail) * 1000) / 1000;
            used += widths[i];
        });
        if (stretch >= 0) widths[stretch] = Math.max(0.2, Math.round((1 - used) * 1000) / 1000);
        Ext.each(cols, function (col, i) {
            if (Math.abs(col.width - widths[i]) > 0.002) changed = true;
        });
        if (changed) {
            Ext.each(cols, function (col, i) {
                col.width = widths[i];
            });
            // Redrawing the list clears its selection: keep it
            var selected = list.getSelectedIndexes();
            list.setHdWidths();
            list.refresh();
            if (selected.length) list.select(selected, false, true);
        }

        // Text still cut off shows in full as a tooltip
        Ext.each(Ext.toArray(list.innerBody.dom.querySelectorAll('dt em')), function (em) {
            if (em.scrollWidth > em.clientWidth) em.title = em.textContent;
            else em.removeAttribute('title');
        });
    }

    // Connection Manager: sized to its hosts, and when there's only one
    // host, select it so Connect is one click.
    var CM_MAX_WIDTH = 640;

    function fitConnectionColumns(cm) {
        fitListColumns(cm, cm.list, { stretch: 'host', maxWidth: CM_MAX_WIDTH });
    }

    function setUpConnectionManager() {
        var cm = deluge.connectionManager;
        if (!cm) return;
        if (cm.list) cm.list.dhSizesWindow = true;
        var autoSelect = false;

        // Each time the window opens it reloads the hosts
        var onGetHosts = cm.onGetHosts;
        cm.onGetHosts = function () {
            autoSelect = true;
            var result = onGetHosts.apply(this, arguments);
            fitConnectionColumns(this);
            return result;
        };

        // A host's status arrives separately, and Deluge's buttons need it,
        // so select the only host then (once per load, so it doesn't fight
        // you if you deselect it)
        var onGetHostStatus = cm.onGetHostStatus;
        cm.onGetHostStatus = function () {
            var result = onGetHostStatus.apply(this, arguments);
            if (autoSelect) {
                autoSelect = false;
                if (this.list.getStore().getCount() === 1 && !this.list.getSelectionCount()) {
                    this.list.select(0);
                }
            }
            fitConnectionColumns(this);
            return result;
        };
    }

    // Edit Trackers: the window as wide as the longest tracker URL, up to
    // 800px.
    var TRACKERS_MAX_WIDTH = 800;

    function setUpEditTrackers() {
        var win = deluge.editTrackers;
        if (!win || !win.list) return;
        win.list.dhSizesWindow = true;
        // The trackers load after the window opens, and change as they're
        // added, edited, moved and removed
        win.list.getStore().on('datachanged', fit);
        win.list.getStore().on('add', fit);
        win.list.getStore().on('update', fit);
        win.list.getStore().on('remove', fit);
        function fit() {
            Ext.defer(fitListColumns, 1, null, [win, win.list, { stretch: 'url', maxWidth: TRACKERS_MAX_WIDTH }]);
        }
        // Its Edit Tracker window as wide as the URL being edited, the same
        // way
        var edit = win.editWindow;
        if (edit) {
            edit.on('show', function () {
                Ext.defer(fitEditTracker, 1, null, [edit]);
            });
        }
    }

    function fitEditTracker(win) {
        try {
            var field = win.form && win.form.getForm().findField('tracker');
            if (!field || !field.el || !win.isVisible()) return;
            win.dhBaseWidth = win.dhBaseWidth || win.getWidth();
            var input = field.el.dom, s = window.getComputedStyle(input);
            var need = Math.ceil(textWidth(input, field.getValue()) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) +
                parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth)) + 2; // + the caret
            var maxWidth = Math.max(win.dhBaseWidth, Math.min(TRACKERS_MAX_WIDTH, Ext.lib.Dom.getViewWidth() - 48));
            // (the field grows with the window)
            var width = Math.max(win.dhBaseWidth, Math.min(maxWidth, win.getWidth() + need - input.offsetWidth));
            if (Math.abs(width - win.getWidth()) > 1) {
                win.setWidth(width);
                win.doLayout();
                win.center();
            }
        } catch (e) {}
    }

    // Every list, grid and tree grid in a window (Add Torrents, the
    // Connection Manager, Edit Trackers, Preferences' Plugins page, plugins'
    // own pages...) inset from its frame (dashboard.css), its columns fitted
    // to the width that leaves. Preferences' page list is a menu instead.
    // Hooked on the prototypes, so lists that plugins add later are included.
    function insetWindowLists() {
        hookInset(Ext.list && Ext.list.ListView, 'dh-inset-list', fitListInPlace);
        hookInset(Ext.grid && Ext.grid.GridPanel, 'dh-inset-grid', function (grid) {
            // Ext fits the columns to the width less its scrollbar; leave
            // room for the inset too
            var view = grid.getView();
            view.scrollOffset = view.getScrollOffset() + 2 * insetOf(grid.el.dom);
        });
        hookInset(Ext.ux && Ext.ux.tree && Ext.ux.tree.TreeGrid, 'dh-inset-tree', function (tree) {
            stretchTreeColumn(tree, true);
        });
        // The details card's grids (Files, Peers) look like the torrent list
        // (dashboard.css), their widest column filling the card
        hookCard(Ext.grid && Ext.grid.GridPanel, function (grid) {
            var view = grid.getView();
            view.emptyText = _('No peers connected');
            view.deferEmptyText = false;
            fitGridColumns(grid);
        });
        hookCard(Ext.ux && Ext.ux.tree && Ext.ux.tree.TreeGrid, function (tree) {
            stretchTreeColumn(tree, false);
        });
    }

    function hookCard(Component, setUp) {
        if (!Component) return;
        var afterRender = Component.prototype.afterRender;
        Component.prototype.afterRender = function () {
            if (this.el.up('#detailsPanel')) {
                this.addClass('dh-card-grid');
                setUp(this);
            }
            return afterRender.apply(this, arguments);
        };
    }

    // Mark each one in a window and let setUp adjust it, before its first
    // layout (which its afterRender starts)
    function hookInset(Component, cls, setUp) {
        if (!Component) return;
        var afterRender = Component.prototype.afterRender;
        Component.prototype.afterRender = function () {
            if (this.el.up('.x-window') && !this.el.hasClass('dh-pref-list')) {
                this.addClass('dh-inset');
                this.addClass(cls);
                setUp(this);
            }
            return afterRender.apply(this, arguments);
        };
    }

    // Columns fitted to their text as the list's items change and it's
    // shown or resized, the window left as it is. The widest column takes
    // the rest. (The Connection Manager and Edit Trackers size their window
    // to their list themselves.)
    function fitListInPlace(list) {
        var stretch, widest = 0;
        Ext.each(list.columns, function (col) {
            if (col.width > widest) {
                widest = col.width;
                stretch = col.dataIndex;
            }
        });
        var fit = function () {
            if (list.dhSizesWindow || list.isDestroyed) return;
            Ext.defer(fitListColumns, 1, null, [null, list, { stretch: stretch }]);
        };
        var store = list.getStore();
        Ext.each(['datachanged', 'add', 'update', 'remove'], function (name) {
            store.on(name, fit);
        });
        // It gets its width (and a page its items) when its page is shown
        var width = 0;
        if (window.ResizeObserver) {
            new ResizeObserver(function () {
                if (list.el.dom.offsetWidth !== width) {
                    width = list.el.dom.offsetWidth;
                    fit();
                }
            }).observe(list.el.dom);
        }
        fit();
    }

    // Hide the Owner column by default, to leave Name more room. Done once
    // per browser; after that, showing it from the column menu sticks (Ext
    // saves the grid's state when a column is shown or hidden).
    var OWNER_KEY = 'darkhand.ownerHidden';

    function hideOwnerOnce(grid) {
        try {
            if (window.localStorage.getItem(OWNER_KEY)) return;
            window.localStorage.setItem(OWNER_KEY, '1');
        } catch (e) {
            return;
        }
        var cm = grid.getColumnModel();
        var i = cm.findColumnIndex('owner');
        if (i >= 0 && !cm.isHidden(i)) {
            cm.setHidden(i, true);
            // Ext saves it 100ms later; save now in case the page is left
            grid.saveState();
        }
    }

    // Toolbar buttons shown with their labels, or as icon-only buttons when
    // the labels don't fit; keep their labels as tooltips.
    var ICON_BUTTONS = ['preferences', 'connectionman', 'help', 'logout'];

    // Show the buttons' labels only while the whole toolbar fits
    function fitToolbar() {
        var card = Ext.get('dh-torrents-card');
        var ct = card && card.child('.x-toolbar-ct');
        var left = ct && ct.child('.x-toolbar-left > table');
        var right = ct && ct.child('.x-toolbar-right > table');
        if (!left || !right) return;
        card.removeClass('dh-toolbar-compact');
        var needed = left.dom.offsetWidth + right.dom.offsetWidth + 16;
        card[needed > ct.dom.offsetWidth ? 'addClass' : 'removeClass']('dh-toolbar-compact');
    }

    // Fitting columns to a width: the stretch column takes what the others
    // leave, at least STRETCH_MIN; when that's too little, the others give
    // up width, in proportion to what each can spare: first down to their
    // content (or header, if wider), then down to their header, their text
    // ending in an ellipsis. Past that, the list scrolls sideways.
    var STRETCH_MIN = 120;

    // cols: [{ base: normal width, want: its content's, min: its header's,
    // full: its whole content's }]. The stretch column asks for its whole
    // content (at least STRETCH_MIN) before the others keep theirs.
    function fitWidths(avail, cols, stretch) {
        var w = [], others = 0, i;
        var target = Math.max(STRETCH_MIN, cols[stretch].full || 0);
        for (i = 0; i < cols.length; i++) {
            w[i] = Math.max(cols[i].base, cols[i].want);
            if (i !== stretch) others += w[i];
        }
        Ext.each(['want', 'min'], function (floor) {
            var short = target - (avail - others), room = 0;
            if (short <= 0) return;
            for (i = 0; i < cols.length; i++) {
                if (i !== stretch) room += Math.max(0, w[i] - cols[i][floor]);
            }
            if (!room) return;
            var share = Math.min(1, short / room);
            for (i = 0; i < cols.length; i++) {
                if (i === stretch) continue;
                var take = Math.floor(Math.max(0, w[i] - cols[i][floor]) * share);
                w[i] -= take;
                others -= take;
            }
        });
        w[stretch] = Math.max(STRETCH_MIN, avail - others);
        return w;
    }

    // Whether the columns fit at their header widths with room for the
    // stretch column
    function fitsHeaders(avail, cols, stretch) {
        var others = 0;
        for (var i = 0; i < cols.length; i++) {
            if (i !== stretch) others += cols[i].min;
        }
        return avail - others >= STRETCH_MIN;
    }

    // Width a cell's content needs: from the cell's left edge to the end of
    // its text and images (indents and icons included), measuring the text
    // itself, which a narrow column clips
    var CELL_END_PAD = 8;

    function cellNeed(td) {
        if (!td) return 0;
        var left = td.getBoundingClientRect().left, right = 0;
        var walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        var range = document.createRange();
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            range.selectNodeContents(node);
            right = Math.max(right, range.getBoundingClientRect().right);
        }
        Ext.each(Ext.toArray(td.querySelectorAll('img')), function (img) {
            right = Math.max(right, img.getBoundingClientRect().right);
        });
        return right ? Math.ceil(right - left) + CELL_END_PAD : 0;
    }

    // A progress bar is drawn at its column's width; it needs room for its
    // label ("100.00%")
    function barNeed(el) {
        var label = el && (el.querySelector('.x-progress-text-back > div') || el);
        return label ? Math.ceil(textWidth(label, '100.00%')) + PROGRESS_PAD + 8 : 60;
    }

    // Each column's widths for fitWidths: its content's (no wider than its
    // normal width) and its header's. A progress bar can't go below its
    // label.
    function columnMins(cols, headerNeed, cells) {
        return cols.map(function (c, i) {
            var content = 0, bar = c.dataIndex === 'progress';
            Ext.each(cells(i), function (td) {
                content = Math.max(content, bar ? barNeed(td) : cellNeed(td));
            });
            var header = headerNeed(i);
            var want = Math.max(header, Math.min(content, c.dhBase));
            return { base: c.dhBase, want: want, min: bar ? want : header, full: Math.max(header, content) };
        });
    }

    // The column to stretch: the widest (the first, of equals), never a
    // progress bar
    function widestColumn(cols) {
        var widest = -1;
        for (var i = 0; i < cols.length; i++) {
            if (cols[i].dataIndex === 'progress') continue;
            if (widest < 0 || cols[i].width > cols[widest].width) widest = i;
        }
        return Math.max(widest, 0);
    }

    // A tree grid (Add Torrents' Files tab, the details card's): its widest
    // column (Filename) takes what the others leave, less the inset in a
    // window. The tree grid sizes its columns (on resize, and when its
    // scrollbar comes or goes) through updateColumnWidths; its Progress
    // bars are drawn at their column's width, so they're redrawn when it
    // changes.
    function stretchTreeColumn(tree, inset) {
        var cols = tree.columns;
        var stretch = widestColumn(cols);
        Ext.each(cols, function (c) {
            c.dhBase = c.width;
        });
        var progress = -1;
        Ext.each(cols, function (c, i) {
            if (c.dataIndex === 'progress') progress = i;
        });
        var update = tree.updateColumnWidths;
        tree.updateColumnWidths = function () {
            var body = this.innerBody && this.innerBody.dom;
            if (body && body.clientWidth) {
                var headers = this.innerHd.dom.querySelectorAll('.x-treegrid-hd-inner');
                var visible = cols.filter(function (c) {
                    return !c.hidden;
                });
                var mins = columnMins(visible, function (i) {
                    var hd = headers[cols.indexOf(visible[i])];
                    if (!hd || !hd.offsetWidth) return 0;
                    var st = window.getComputedStyle(hd);
                    return Math.ceil(textWidth(hd, hd.textContent) + parseFloat(st.paddingLeft) + parseFloat(st.paddingRight)) + 2;
                }, function (i) {
                    var n = cols.indexOf(visible[i]) + 1;
                    return Ext.toArray(body.querySelectorAll('.x-tree-node-el > td:nth-child(' + n + ')'));
                });
                var avail = body.clientWidth - (inset ? 2 * insetOf(body) : 0);
                var widths = fitWidths(avail, mins, visible.indexOf(cols[stretch]));
                var redraw = progress >= 0 && widths[visible.indexOf(cols[progress])] !== cols[progress].width;
                Ext.each(visible, function (c, i) {
                    c.width = widths[i];
                });
                var result = update.apply(this, arguments);
                if (redraw) {
                    this.getRootNode().cascade(function (n) {
                        if (n.ui && n.ui.updateColumns && n.ui.rendered) n.ui.updateColumns();
                    });
                }
                // Names still cut off show in full as a tooltip
                Ext.each(Ext.toArray(body.querySelectorAll('.x-tree-node-el > td:first-child')), function (td) {
                    var text = td.textContent.trim();
                    if (text && td.scrollWidth > td.clientWidth) td.title = text;
                    else td.removeAttribute('title');
                });
                return result;
            }
            return update.apply(this, arguments);
        };
    }

    // A grid in the details card (Peers): its widest column (Address)
    // fills what the others leave, refitted as the card resizes and the
    // rows change. Its Progress bars are drawn at their column's width, so
    // the rows are redrawn when that changes.
    function fitGridColumns(grid) {
        var view = grid.getView();
        var cm = grid.getColumnModel();
        var busy = false;
        Ext.each(cm.config, function (c) {
            c.dhBase = c.width;
        });
        var fit = function () {
            if (busy || !view.mainBody || !grid.el.dom.offsetWidth) return;
            busy = true;
            try {
                var idx = [];
                for (var i = 0; i < cm.getColumnCount(); i++) {
                    if (!cm.isHidden(i)) idx.push(i);
                }
                var cols = idx.map(function (i) {
                    return cm.config[i];
                });
                var cells = function (k) {
                    var list = [];
                    for (var r = 0; r < grid.getStore().getCount(); r++) list.push(view.getCell(r, idx[k]));
                    return list;
                };
                // A header's width with its full text, whichever is showing
                var header = function (k) {
                    var c = cols[k], w = headerWidth(view, idx[k]);
                    var cell = view.getHeaderCell(idx[k]), inner = cell && cell.firstChild;
                    if (!c.dhHeader || c.header === c.dhHeader || !inner) return w;
                    return w + Math.ceil(textWidth(inner, c.dhHeader) - textWidth(inner, c.header));
                };
                var avail = view.getGridInnerWidth(), stretch = widestColumn(cols);
                // Short of room at the full headers: "↓ Speed" / "↑ Speed"
                setShortHeaders(view, cm, !fitsHeaders(avail, columnMins(cols, header, cells), stretch));
                var mins = columnMins(cols, function (k) {
                    return headerWidth(view, idx[k]);
                }, cells);
                var widths = fitWidths(avail, mins, stretch);
                var changed = false, redraw = false;
                Ext.each(idx, function (i, k) {
                    if (Math.abs(cm.getColumnWidth(i) - widths[k]) >= 1) {
                        changed = true;
                        if (cm.config[i].dataIndex === 'progress') redraw = true;
                        cm.setColumnWidth(i, widths[k], true);
                    }
                });
                if (changed) {
                    if (redraw && view.hasRows()) view.refresh();
                    else view.updateAllColumnWidths();
                }
                // Text still cut off shows in full as a tooltip
                Ext.each(Ext.toArray(view.mainBody.dom.querySelectorAll('.x-grid3-cell-inner')), function (el) {
                    var text = el.textContent.trim();
                    if (text && el.scrollWidth > el.clientWidth) el.title = text;
                    else el.removeAttribute('title');
                });
            } catch (e) {
                if (window.console) console.error('Darkhand: column layout failed', e);
            }
            busy = false;
        };
        var onLayout = view.onLayout;
        view.onLayout = function () {
            var result = onLayout.apply(this, arguments);
            fit();
            return result;
        };
        grid.getStore().on('datachanged', fit);
        grid.getStore().on('add', fit);
    }

    function wireUp(mode, details, box) {
        setUpColumnStretch(deluge.torrents);
        hideOwnerOnce(deluge.torrents);
        styleAboutWindow();
        setUpBrand();
        setUpConnectionManager();
        setUpEditTrackers();
        // Add Torrents as two framed sections, the torrent list with its
        // File / Url / Remove bar and the Files / Options tabs, with a gap
        // between (dashboard.css frames them). Its regions are laid out when
        // the window is first shown, so they can still be configured.
        var add = deluge.add;
        if (add && !add.rendered && add.optionsPanel && add.items && add.items.get(0)) {
            add.addClass('dh-add');
            add.items.get(0).addClass('dh-add-section');
            add.optionsPanel.addClass('dh-add-section');
            // The Options tab's form in from the frame like the Preferences
            // pages (Deluge pads it 5px); set before it renders, so Ext
            // sizes the fields to fit
            if (add.optionsPanel.form) add.optionsPanel.form.bodyStyle = 'padding: 5px 15px';
            // The Options tab's form fills Deluge's 265px exactly, so the
            // rounded section would clip its last row: 12px more for it, and
            // 12 more for its six rows of checkboxes, each 2px further apart
            // with the theme's row spacing (--dh-inset, where Ext's is 4px).
            // The window grows by as much, so the torrent list keeps its
            // height.
            var extra = 12 + 12;
            configure(add.optionsPanel, {
                margins: margins(10, 0, 0, 0),
                height: add.optionsPanel.height + extra,
            });
            if (typeof add.height === 'number') add.height += extra;
        }
        // The details card's Details and Options tabs, restyled in
        // dashboard.css
        Ext.each(deluge.details.items.items, function (tab) {
            if (Deluge.details.DetailsTab && tab instanceof Deluge.details.DetailsTab) tab.addClass('dh-details-tab');
            if (Deluge.details.OptionsTab && tab instanceof Deluge.details.OptionsTab) tab.addClass('dh-options');
        });
        // Preferences' page list, styled as a menu (dashboard.css)
        if (deluge.preferences && deluge.preferences.list) deluge.preferences.list.addClass('dh-pref-list');
        if (deluge.preferences && deluge.preferences.doSelectPage) fitPreferences(deluge.preferences);
        rememberDetailsSize(mode, details);

        var refit = function () {
            fitOverview(box);
        };
        // The cards' height also changes without the region's width changing:
        // when the web font arrives, when they switch to the stacked layout,
        // or when a value wraps differently. Refit whenever it does.
        var wrap = box.getEl() && box.getEl().child('.dh-overview-wrap');
        if (wrap && window.ResizeObserver) {
            new ResizeObserver(refit).observe(wrap.dom);
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                refit();
                fitTitle();
            });
        }
        // Room for the chart depends on the column's height (window size,
        // and with the details card at the bottom, that card's size).
        if (box.ownerCt) box.ownerCt.on('resize', refit);

        var plot = document.getElementById('dh-chart-plot');
        if (plot && window.ResizeObserver) {
            new ResizeObserver(drawChart).observe(plot);
        }

        Ext.each(ICON_BUTTONS, function (id) {
            var btn = deluge.toolbar.items.get(id);
            if (btn && btn.setTooltip) btn.setTooltip(btn.text);
        });
        var toolbar = deluge.toolbar.getEl();
        if (toolbar && window.ResizeObserver) {
            new ResizeObserver(fitToolbar).observe(toolbar.dom);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitToolbar);

        // The Stats and Details switches in the header. The layout is built
        // once at startup, so a change reloads the page.
        Ext.get('dh-header').on('click', function (e) {
            var btn = e.getTarget('.dh-seg-btn');
            if (!btn) return;
            var pref = btn.getAttribute('data-pref');
            var value = btn.getAttribute('data-value');
            if (pref === 'details' && value !== state.mode) {
                setMode(value);
            } else if (pref === 'stats' && value !== state.statsPos) {
                setStatsPosition(value);
            } else {
                return;
            }
            window.location.reload();
        });

        // Remember whether you left the details card open or closed
        details.on('expand', function () {
            saveDetailsOpen(true);
        });
        details.on('collapse', function () {
            saveDetailsOpen(false);
        });

        // Keep the page title in step with the selected filters.
        var onUpdate = deluge.ui.onUpdate;
        deluge.ui.onUpdate = function (data) {
            var result = onUpdate.apply(this, arguments);
            try {
                updateTitle(data);
                updateStats(data);
                if (data && data.connected && data.stats) {
                    addSample(data.stats);
                    drawChart();
                }
            } catch (e) {}
            return result;
        };
    }

    var STATE_TITLES = {
        All: 'All Torrents',
        Active: 'Active Torrents',
    };

    function updateTitle(data) {
        var filters = deluge.sidebar.getFilterStates() || {};
        var title = filters.state || 'All';
        title = STATE_TITLES[title] || title;

        var crumb = 'Torrents';
        if (filters.tracker_host) crumb += ' / ' + filters.tracker_host;
        if (filters.owner) crumb += ' / ' + filters.owner;
        if (filters.label) crumb += ' / ' + filters.label;

        // torrents is a map of torrent id -> status for the current filters
        var count = data && data.torrents ? countKeys(data.torrents) : 0;

        var titleEl = Ext.get('dh-title');
        if (titleEl) {
            titleEl.update(
                Ext.util.Format.htmlEncode(title) +
                    ' <span class="dh-title-count">' +
                    count +
                    '</span>'
            );
        }
        var crumbEl = Ext.get('dh-crumb');
        if (crumbEl) crumbEl.update(Ext.util.Format.htmlEncode(crumb));
    }

    function countKeys(obj) {
        var count = 0;
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) count++;
        }
        return count;
    }

    // Take over Viewport creation during initialize(). If the script arrives
    // after the UI is already up (plugin just enabled), this has no effect and
    // the plugin reloads the page into the dashboard (reloadIntoDashboard).
    if (deluge.ui && deluge.ui.initialize && !deluge.ui.Viewport) {
        var initialize = deluge.ui.initialize;
        deluge.ui.initialize = function () {
            var ui = this;
            try {
                sizeWindows(); // before Deluge creates its windows
                styleLoginWindow();
                insetWindowLists();
            } catch (e) {
                if (window.console) console.error('Darkhand: window sizing failed', e);
            }
            var RealViewport = Ext.Viewport;
            Ext.Viewport = function () {
                Ext.Viewport = RealViewport;
                return buildLayout(ui, RealViewport);
            };
            try {
                return initialize.apply(this, arguments);
            } finally {
                Ext.Viewport = RealViewport;
            }
        };
    }

    function askReload(message) {
        Ext.Msg.show({
            title: 'Darkhand',
            msg: message,
            buttons: Ext.Msg.YESNO,
            icon: Ext.MessageBox.QUESTION,
            fn: function (btn) {
                if (btn === 'yes') window.location.reload();
            },
        });
    }

    // Enabling the plugin means you want the dashboard, so reload into it
    // (the layout is built when the page loads). Deluge loads a newly
    // enabled plugin into the running page: after installing, or when you
    // tick it in Preferences > Plugins.
    var RELOAD_KEY = 'darkhand.reloadedAt';

    function reloadIntoDashboard() {
        // If this page was reloaded for the dashboard moments ago and still
        // didn't get it, ask rather than reload again (and again...)
        var last;
        try {
            last = +window.sessionStorage.getItem(RELOAD_KEY) || 0;
        } catch (e) {
            last = null;
        }
        if (last === null || new Date().getTime() - last < 60 * 1000) {
            askReload('Reload the page to switch to the dashboard layout?');
            return;
        }
        var reload = function () {
            try {
                window.sessionStorage.setItem(RELOAD_KEY, String(new Date().getTime()));
            } catch (e) {}
            window.location.reload();
        };
        // Enabled from Preferences: reload once you close it, so any other
        // changes you've made there aren't lost
        var prefs = deluge.preferences;
        if (prefs && prefs.isVisible && prefs.isVisible()) {
            prefs.on('hide', reload, null, { single: true });
        } else {
            reload();
        }
    }

    Deluge.plugins.darkhand.Plugin = Ext.extend(Deluge.Plugin, {
        name: 'Darkhand',

        onEnable: function () {
            if (!state.active) reloadIntoDashboard();
        },

        onDisable: function () {
            if (state.active) {
                askReload('Reload the page to return to the standard layout?');
            }
        },
    });

    Deluge.registerPlugin('Darkhand', Deluge.plugins.darkhand.Plugin);
})();
