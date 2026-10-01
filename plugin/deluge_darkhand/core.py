"""Daemon side of the plugin.

Records the session's download and upload speeds every couple of seconds,
so the dashboard's speed chart can show the last few minutes even when no
browser was watching: a page in a background tab gets Deluge's updates only
now and then (browsers throttle its timers), and a closed one gets none.
The chart fetches the history when it loads and after any gap in its own
updates (darkhand.js). Kept in memory: it starts again with the daemon.
"""

import time
from collections import deque

from twisted.internet import task

from deluge import component
from deluge.core.rpcserver import export
from deluge.plugins.pluginbase import CorePluginBase

INTERVAL = 2  # seconds between samples, as often as the Web UI updates
KEEP = 10 * 60  # seconds of history kept (the chart shows five minutes)


class Core(CorePluginBase):
    def enable(self):
        # (time in ms, download bytes/s, upload bytes/s)
        self.history = deque(maxlen=KEEP // INTERVAL)
        self.timer = task.LoopingCall(self._sample)
        self.timer.start(INTERVAL, now=False)

    def disable(self):
        if self.timer.running:
            self.timer.stop()

    def update(self):
        pass

    def _sample(self):
        # The same rates the Web UI's stats show; Deluge refreshes them on
        # its own timer, so reading them costs nothing. Never let an error
        # end the loop.
        try:
            status = component.get('Core').get_session_status(
                ['payload_download_rate', 'payload_upload_rate']
            )
            self.history.append(
                (
                    int(time.time() * 1000),
                    int(status.get('payload_download_rate', 0)),
                    int(status.get('payload_upload_rate', 0)),
                )
            )
        except Exception:
            pass

    @export
    def get_speed_history(self, since=0):
        """The speeds recorded after `since` (ms since the epoch), oldest
        first, as [time ms, download bytes/s, upload bytes/s], with the
        daemon's clock (`now`, ms) to line the times up with the caller's."""
        return {
            'now': int(time.time() * 1000),
            'interval': INTERVAL * 1000,
            'samples': [list(s) for s in self.history if s[0] > since],
        }
