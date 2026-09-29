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
 *   +---------+------------------------------------------+
 *   |  brand  |  breadcrumb / page title        controls |
 *   |         |  +------------------------------------+  |  +--------+
 *   | filters |  | toolbar                            |  |  |details |
 *   |  (nav)  |  | torrent list                       |  |  |drawer  |
 *   |         |  +------------------------------------+  |  |(or card|
 *   |         |  status bar                              |  | below) |
 *   +---------+------------------------------------------+  +--------+
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
        return mode === 'card' ? 'card' : 'drawer';
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
            '<div class="dh-header-inner">' +
            '<div class="dh-heading">' +
            '<div class="dh-breadcrumb">Deluge <span>/</span> ' +
            '<span id="dh-crumb">Torrents</span></div>' +
            '<h1 id="dh-title">All Torrents</h1>' +
            '</div>' +
            '<div class="dh-header-tools">' +
            '<span class="dh-seg-label">Details</span>' +
            '<div class="dh-seg">' +
            btn('drawer', 'Drawer') +
            btn('card', 'Card') +
            '</div>' +
            '</div>' +
            '</div>'
        );
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
            height: 108,
            html: headerHtml(mode),
        });

        // Let the Name column take up the spare width in the wider card.
        deluge.torrents.autoExpandColumn = 'name';

        var tableCard = new Ext.Panel({
            id: 'dh-torrents-card',
            region: 'center',
            layout: 'fit',
            border: false,
            margins: mode === 'card' ? '0 24 0 24' : '0 24 16 24',
            tbar: deluge.toolbar,
            items: [deluge.torrents],
        });

        var details = ui.detailsPanel;
        var mainItems = [header, tableCard];
        var viewportItems = [nav];

        if (mode === 'card') {
            configure(details, {
                region: 'south',
                height: 250,
                minSize: 140,
                split: true,
                collapsible: true,
                margins: '0 24 16 24',
                cmargins: '0 24 16 24',
            });
            mainItems.push(details);
        } else {
            configure(details, {
                region: 'east',
                width: 400,
                minSize: 320,
                maxSize: 720,
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
            bbar: deluge.statusbar,
        });
        viewportItems.push(main);
        if (mode === 'drawer') viewportItems.push(details);

        var viewport = new Viewport({
            layout: 'border',
            items: viewportItems,
        });

        state.active = true;
        wireUp(mode, details);
        return viewport;
    }

    // Toolbar buttons shown as round icon buttons; keep their labels as
    // tooltips.
    var ICON_BUTTONS = ['preferences', 'connectionman', 'help', 'logout'];

    function wireUp(mode, details) {
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

        if (mode === 'drawer') {
            // Open the drawer when a torrent is selected, close it when the
            // selection is cleared.
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
