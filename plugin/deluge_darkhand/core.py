"""Daemon side of the plugin.

Records the session's download and upload speeds, so the dashboard's speed
chart can show anything from the last few minutes to the last 90 days, and
show it full even when no browser was watching: a page in a background tab
gets Deluge's updates only now and then (browsers throttle its timers), and
a closed one gets none.

Kept in tiers, each averaged from the one before, so a long history stays
small: a sample every 2 seconds for an hour, one a minute for two days, one
every 15 minutes for 90 days (about 13,000 in all). The tiers are saved to
a file in Deluge's config folder every few minutes and when the plugin
stops, and loaded when it starts, so the history outlives a daemon restart
(the time the daemon was down shows as a gap).

The chart asks for a time span and about as many points as it has room
for (darkhand.js), and gets them from the finest tier that covers it.
"""

import json
import logging
import os
import time
from array import array
from bisect import bisect_right

from twisted.internet import task

import deluge.configmanager
from deluge import component
from deluge.core.rpcserver import export
from deluge.plugins.pluginbase import CorePluginBase

log = logging.getLogger(__name__)

INTERVAL = 2  # seconds between samples, as often as the Web UI updates
# (name, seconds per sample, seconds kept)
TIERS = (
    ('raw', INTERVAL, 60 * 60),
    ('minute', 60, 2 * 24 * 60 * 60),
    ('quarter', 15 * 60, 90 * 24 * 60 * 60),
)
SAVE_EVERY = 5 * 60  # seconds between saves
HISTORY_FILE = 'darkhand_history.json'
FORMAT = 1


class Series:
    """Samples (time in ms, download bytes/s, upload bytes/s), oldest first,
    in plain arrays: a tuple per sample would take several times the room."""

    def __init__(self, step, keep):
        self.step = step * 1000
        self.keep = keep * 1000
        self.t, self.down, self.up = array('q'), array('q'), array('q')

    def append(self, t, down, up):
        self.t.append(int(t))
        self.down.append(int(down))
        self.up.append(int(up))

    def trim(self, now):
        # Older than kept: drop them (all at once, a cheap move)
        n = bisect_right(self.t, now - self.keep)
        if n:
            del self.t[:n], self.down[:n], self.up[:n]

    def since(self, start):
        """From the sample before `start` (so a chart's lines run off its
        left edge) to the newest, as lists."""
        i = max(0, bisect_right(self.t, start) - 1)
        return [list(s) for s in zip(self.t[i:], self.down[i:], self.up[i:])]

    def dump(self):
        return [list(self.t), list(self.down), list(self.up)]

    def load(self, data, now):
        t, down, up = data
        if not (len(t) == len(down) == len(up)):
            return
        for s in sorted(zip(t, down, up)):
            if now - self.keep < s[0] <= now:
                self.append(*s)


class Bucket:
    """The average of the samples in one step of a tier, clock-aligned (a
    minute tier's from :00 to :59), until the step is over."""

    def __init__(self):
        self.key = None
        self.n = self.down = self.up = 0

    def add(self, key, down, up):
        self.key = key
        self.n += 1
        self.down += down
        self.up += up

    def average(self, step):
        # Timed at the middle of its step
        return (
            self.key * step + step // 2,
            round(self.down / self.n),
            round(self.up / self.n),
        )


class Core(CorePluginBase):
    def enable(self):
        self.series = [Series(step, keep) for _name, step, keep in TIERS]
        # The step under way in each tier after the first, averaged from the
        # tier before
        self.buckets = [Bucket() for _tier in TIERS[1:]]
        self.path = deluge.configmanager.get_config_dir(HISTORY_FILE)
        self._load()
        self.timer = task.LoopingCall(self._sample)
        self.timer.start(INTERVAL, now=False)
        self.saver = task.LoopingCall(self._save)
        self.saver.start(SAVE_EVERY, now=False)

    def disable(self):
        for loop in (self.timer, self.saver):
            if loop.running:
                loop.stop()
        self._save()

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
            self._add(
                int(time.time() * 1000),
                int(status.get('payload_download_rate', 0)),
                int(status.get('payload_upload_rate', 0)),
            )
        except Exception:
            pass

    def _add(self, now, down, up):
        self.series[0].append(now, down, up)
        self.series[0].trim(now)
        # Into each longer tier's step under way; a step that's over goes
        # into its tier, and on into the next tier's step
        sample = (now, down, up)
        for i, bucket in enumerate(self.buckets):
            series = self.series[i + 1]
            key = sample[0] // series.step
            if bucket.key is None or key == bucket.key:
                bucket.add(key, sample[1], sample[2])
                break
            done = bucket.average(series.step)
            self.buckets[i] = Bucket()
            self.buckets[i].add(key, sample[1], sample[2])
            series.append(*done)
            series.trim(now)
            sample = done

    def _load(self):
        try:
            with open(self.path) as f:
                data = json.load(f)
            if data.get('format') != FORMAT:
                return
            now = int(time.time() * 1000)
            for (name, _step, _keep), series in zip(TIERS, self.series):
                if name in data:
                    series.load(data[name], now)
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning('Darkhand: speed history not loaded: %s', e)

    def _save(self):
        # Written beside the old file and moved over it, so a crash mid-write
        # leaves the old one whole
        try:
            data = {'format': FORMAT}
            for (name, _step, _keep), series in zip(TIERS, self.series):
                data[name] = series.dump()
            tmp = self.path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(data, f, separators=(',', ':'))
            os.replace(tmp, self.path)
        except Exception as e:
            log.warning('Darkhand: speed history not saved: %s', e)

    @export
    def get_speed_history(self, since=0, span=0, points=0):
        """Speeds as [time ms, download bytes/s, upload bytes/s], oldest
        first, with the daemon's clock (`now`, ms) to line the times up with
        the caller's and `interval`, the ms between samples.

        With `span` (ms), the last that long, from the finest tier that
        covers it, averaged down to about `points` samples if it has many
        more. Without, the 2-second samples after `since` (ms since the
        epoch), as the plugin's first version returned."""
        now = int(time.time() * 1000)
        since, span = int(since), int(span)
        if not span:
            raw = self.series[0]
            return {
                'now': now,
                'interval': raw.step,
                'samples': [s for s in raw.since(0) if s[0] > since],
            }
        # Within what's kept, and no more points than any chart could use
        span = max(0, min(span, self.series[-1].keep))
        points = max(0, min(int(points), 5000))
        series = self.series[-1]
        for i, s in enumerate(self.series):
            if s.keep >= span:
                series = s
                break
        samples = series.since(now - span)
        # The step under way, so the chart reaches the present
        i = self.series.index(series)
        if i and self.buckets[i - 1].n:
            t, down, up = self.buckets[i - 1].average(series.step)
            # (its middle can be still to come)
            samples.append([min(t, now), down, up])
        step = series.step
        if points > 0 and len(samples) > points * 1.5:
            step = max(step, span // points)
            samples = average(samples, step)
        return {'now': now, 'interval': step, 'samples': samples}


def average(samples, step):
    """Samples averaged in clock-aligned steps of `step` ms."""
    out, key, group = [], None, None
    for t, down, up in samples:
        k = t // step
        if k != key:
            key, group = k, [0, 0, 0, 0]
            out.append(group)
        group[0] += t
        group[1] += down
        group[2] += up
        group[3] += 1
    return [[g[0] // g[3], round(g[1] / g[3]), round(g[2] / g[3])] for g in out]
