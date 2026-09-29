"""Daemon side of the plugin.

Deluge only offers web plugins that also have a core part, so this exists to
make the plugin show up under Preferences > Plugins. It does nothing.
"""

from deluge.plugins.pluginbase import CorePluginBase


class Core(CorePluginBase):
    def enable(self):
        pass

    def disable(self):
        pass

    def update(self):
        pass
