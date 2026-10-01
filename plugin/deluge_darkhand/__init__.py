"""Darkhand dashboard: a layout companion for the Darkhand Web UI theme."""

from deluge.plugins.init import PluginInitBase


class CorePlugin(PluginInitBase):
    def __init__(self, plugin_name):
        from .core import Core as _pluginCls

        self._plugin_cls = _pluginCls
        super().__init__(plugin_name)


class WebUIPlugin(PluginInitBase):
    def __init__(self, plugin_name):
        from .webui import WebUI as _pluginCls

        self._plugin_cls = _pluginCls
        super().__init__(plugin_name)
