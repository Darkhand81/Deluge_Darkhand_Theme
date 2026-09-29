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
 * card sits on the right (opening when a torrent is selected) or below the
 * list; the header switch flips between the two.
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
        mode: null,
    };

    function getMode() {
        var mode = null;
        try {
            mode = window.localStorage.getItem(MODE_KEY);
        } catch (e) {}
        // "card" was the earlier name of the bottom layout
        return mode === 'bottom' || mode === 'card' ? 'bottom' : 'right';
    }

    function setMode(mode) {
        try {
            window.localStorage.setItem(MODE_KEY, mode);
        } catch (e) {}
    }

    function headerHtml(mode) {
        var btn = function (value, label) {
            return (
                '<button type="button" class="dh-seg-btn' +
                (mode === value ? ' dh-seg-active' : '') +
                '" data-mode="' +
                value +
                '">' +
                label +
                '</button>'
            );
        };
        return (
            '<div class="dh-header-wrap">' +
            '<div class="dh-header-inner">' +
            '<div class="dh-heading">' +
            '<div class="dh-breadcrumb">Deluge <span>/</span> ' +
            '<span id="dh-crumb">Torrents</span></div>' +
            '<h1 id="dh-title">All Torrents</h1>' +
            '</div>' +
            '<div class="dh-header-tools">' +
            '<span class="dh-seg-label">Details</span>' +
            '<div class="dh-seg">' +
            btn('right', 'Right') +
            btn('bottom', 'Bottom') +
            '</div>' +
            '</div>' +
            '</div>' +
            statsHtml() +
            '</div>'
        );
    }

    // Stat cards shown under the page title. Values come from the regular
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
        setStat(
            'space',
            stats.free_space >= 0 ? fsize(stats.free_space, true) : 'n/a',
            'Download folder'
        );
    }

    /**
     * Lay out the stat cards and size the header region to fit them. Six
     * columns when there's room, three otherwise; with the details card on
     * the right the column's width changes as the card opens and closes, so
     * it stays at three to keep the torrent list from jumping.
     */
    function fitHeader(header) {
        var el = header.getEl();
        if (!el) return;
        var wrap = el.child('.dh-header-wrap');
        var grid = el.child('.dh-stats');
        if (!wrap || !grid) return;

        // A stacked card needs about 160px for "1023.9 MiB/s"; a card with
        // the icon beside the text needs about 230px.
        var width = grid.getWidth();
        var fits = function (n, min) {
            return (width - (n - 1) * GAP) / n >= min;
        };
        var cols = fits(6, 160) ? 6 : fits(3, 160) ? 3 : 2;
        if (state.mode === 'right') cols = Math.min(cols, 3);
        grid.setStyle('grid-template-columns', 'repeat(' + cols + ', minmax(0, 1fr))');
        grid[fits(cols, 230) ? 'removeClass' : 'addClass']('dh-stats-compact');

        var height = wrap.getHeight();
        if (height && height !== header.getHeight()) {
            header.setHeight(height);
            // Often called while Ext is already laying out the column (the
            // details card opening, a window resize), when a nested
            // doLayout() is silently ignored; lay out again right after.
            Ext.defer(function () {
                if (header.ownerCt) header.ownerCt.doLayout();
            }, 1);
        }
    }

    // Spacing between cards and around the window edge. Where a resize bar
    // (Ext's 5px split bar) sits between two cards, the margin next to it is
    // reduced so the visible gap is still GAP.
    var GAP = 16;
    var SPLIT = 5;

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
        state.mode = mode;

        Ext.getBody().addClass(['dh-dashboard', 'dh-details-' + mode]);

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
                        '<div class="dh-brand">' +
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
            // Resized to fit the stat cards once rendered (fitHeader)
            height: 280,
            html: headerHtml(mode),
            listeners: {
                resize: function (header) {
                    fitHeader(header);
                },
            },
        });

        // Let the Name column take up the spare width in the wider card.
        deluge.torrents.autoExpandColumn = 'name';

        var tableCard = new Ext.Panel({
            id: 'dh-torrents-card',
            region: 'center',
            layout: 'fit',
            border: false,
            margins:
                mode === 'bottom'
                    ? margins(0, GAP, 0, GAP)
                    : margins(0, GAP - SPLIT, GAP, GAP),
            tbar: deluge.toolbar,
            items: [deluge.torrents],
        });

        var details = ui.detailsPanel;
        var mainItems = [header, tableCard];
        var viewportItems = [nav];

        if (mode === 'bottom') {
            configure(details, {
                region: 'south',
                height: 250,
                minSize: 140,
                split: true,
                collapsible: true,
                margins: margins(GAP - SPLIT, GAP, GAP, GAP),
                cmargins: margins(GAP - SPLIT, GAP, GAP, GAP),
            });
            mainItems.push(details);
        } else {
            configure(details, {
                region: 'east',
                width: 400,
                minSize: 320,
                maxSize: 720,
                margins: margins(GAP, GAP, GAP, 0),
                cmargins: margins(GAP, GAP, GAP, 0),
                split: true,
                collapsible: true,
                collapsed: true,
                collapseMode: 'mini',
                animCollapse: false,
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
        wireUp(mode, details, header);
        return viewport;
    }

    // Toolbar buttons shown as round icon buttons; keep their labels as
    // tooltips.
    var ICON_BUTTONS = ['preferences', 'connectionman', 'help', 'logout'];

    function wireUp(mode, details, header) {
        // The cards' height also changes without the header's width changing:
        // when the web font arrives, when they switch to the stacked layout,
        // or when a value wraps differently. Refit whenever it does.
        var wrap = header.getEl() && header.getEl().child('.dh-header-wrap');
        if (wrap && window.ResizeObserver) {
            new ResizeObserver(function () {
                fitHeader(header);
            }).observe(wrap.dom);
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                fitHeader(header);
            });
        }

        Ext.each(ICON_BUTTONS, function (id) {
            var btn = deluge.toolbar.items.get(id);
            if (btn && btn.setTooltip) btn.setTooltip(btn.text);
        });

        // Details mode switch in the header.
        Ext.get('dh-header').on('click', function (e) {
            var btn = e.getTarget('.dh-seg-btn');
            if (!btn) return;
            var value = btn.getAttribute('data-mode');
            if (value && value !== state.mode) {
                setMode(value);
                window.location.reload();
            }
        });

        if (mode === 'right') {
            // Open the details card when a torrent is selected, close it when
            // the selection is cleared.
            var sm = deluge.torrents.getSelectionModel();
            sm.on('selectionchange', function (sm) {
                if (sm.getCount() > 0) {
                    if (details.collapsed) details.expand(false);
                } else if (!details.collapsed) {
                    details.collapse(false);
                }
            });
        }

        // Keep the page title in step with the selected filters.
        var onUpdate = deluge.ui.onUpdate;
        deluge.ui.onUpdate = function (data) {
            var result = onUpdate.apply(this, arguments);
            try {
                updateTitle(data);
                updateStats(data);
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
    // the plugin asks for a reload instead.
    if (deluge.ui && deluge.ui.initialize && !deluge.ui.Viewport) {
        var initialize = deluge.ui.initialize;
        deluge.ui.initialize = function () {
            var ui = this;
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

    Deluge.plugins.darkhand.Plugin = Ext.extend(Deluge.Plugin, {
        name: 'Darkhand',

        onEnable: function () {
            if (!state.active) {
                askReload('Reload the page to switch to the dashboard layout?');
            }
        },

        onDisable: function () {
            if (state.active) {
                askReload('Reload the page to return to the standard layout?');
            }
        },
    });

    Deluge.registerPlugin('Darkhand', Deluge.plugins.darkhand.Plugin);
})();
