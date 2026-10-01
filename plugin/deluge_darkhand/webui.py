"""Web UI side of the plugin: serves the dashboard layout script."""

from deluge.plugins.pluginbase import WebPluginBase

from .common import get_resource


class WebUI(WebPluginBase):
    scripts = [get_resource('darkhand.js')]
    debug_scripts = scripts

    def enable(self):
        pass

    def disable(self):
        pass
