"""Helper for test-server.sh; runs under the test server's own Python.

    test_server.py make-data <dir>            sample torrents and their data
    test_server.py add-torrents <config> <dir> <daemon port>
    test_server.py default-daemon <config> <daemon port>
    test_server.py plugin <on|off> <config> <daemon port>
    test_server.py status <config> <daemon port>
"""

import base64
import os
import shutil
import sys

# Eight small torrents: the odd ones lose their data, so they show as
# downloading (three of them; the fourth queued); the two videos are folders
# of files.
NAMES = [
    'ubuntu-24.04.2-desktop-amd64.iso',
    'debian-12.9.0-amd64-netinst.iso',
    'Fedora-Workstation-Live-41.iso',
    'archlinux-2025.01.01-x86_64.iso',
    'big_buck_bunny_1080p',
    'Sintel.2010.4K',
    'linuxmint-22.1-cinnamon-64bit.iso',
    'openSUSE-Tumbleweed-DVD.iso',
]


def make_data(root):
    import libtorrent as lt

    dl, tor = os.path.join(root, 'dl'), os.path.join(root, 'torrents')
    if os.path.isdir(tor) and len(os.listdir(tor)) == len(NAMES):
        print('sample torrents already made')
        return
    os.makedirs(dl, exist_ok=True)
    os.makedirs(tor, exist_ok=True)
    for i, name in enumerate(NAMES):
        path = os.path.join(dl, name)
        if name.startswith(('big', 'Sintel')):
            os.makedirs(path, exist_ok=True)
            for j in range(3):
                with open(os.path.join(path, f'part{j}.mkv'), 'wb') as f:
                    f.write(os.urandom(300000 * (j + 1)))
        else:
            with open(path, 'wb') as f:
                f.write(os.urandom(500000 * (i + 1)))
        fs = lt.file_storage()
        lt.add_files(fs, path)
        # v1 only: libtorrent's hybrid torrents add padding files, which
        # would show in the Files tabs (as a .pad folder)
        t = lt.create_torrent(fs, 16384 * 4, flags=lt.create_torrent.v1_only)
        t.add_tracker(f'udp://tracker{i % 3}.example.org:1337/announce')
        lt.set_piece_hashes(t, dl)
        with open(os.path.join(tor, name + '.torrent'), 'wb') as f:
            f.write(lt.bencode(t.generate()))
    for name in NAMES[1::2]:
        path = os.path.join(dl, name)
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
    print(f'made {len(NAMES)} sample torrents')


def rpc(config, port, job):
    """Run job(client) against the daemon, then stop."""
    from twisted.internet import defer, reactor
    from deluge.ui.client import client

    result = {}

    @defer.inlineCallbacks
    def main():
        try:
            user, pw = open(os.path.join(config, 'auth')).read().split(':')[:2]
            yield client.connect('127.0.0.1', int(port), user, pw)
            result['value'] = yield job(client)
            client.disconnect()
        except Exception as e:  # reported below
            result['error'] = e
        reactor.stop()

    reactor.callWhenRunning(main)
    reactor.run()
    if 'error' in result:
        sys.exit(f'daemon: {result["error"]!r}')
    return result.get('value')


def add_torrents(config, root, port):
    from twisted.internet import defer

    dl, tor = os.path.abspath(os.path.join(root, 'dl')), os.path.join(root, 'torrents')

    @defer.inlineCallbacks
    def job(client):
        # Count idle torrents as active, so with Deluge's limit of 3 active
        # downloads the fourth always shows as queued (whatever the timing)
        yield client.core.set_config({'max_active_downloading': 3, 'dont_count_slow_torrents': False})
        have = yield client.core.get_session_state()
        if have:
            return f'daemon already has {len(have)} torrents'
        ids = []
        for f in sorted(os.listdir(tor)):
            data = base64.b64encode(open(os.path.join(tor, f), 'rb').read()).decode()
            tid = yield client.core.add_torrent_file(f, data, {'download_location': dl, 'add_paused': False})
            ids.append(tid)
        return f'added {len(ids)} torrents'

    print(rpc(config, port, job))


def default_daemon(config, port):
    """Point the web UI at the local daemon so it connects on its own, and
    skip its first-login "Change Default Password" prompt (a test server
    keeps the default)."""
    from deluge.config import Config

    hosts = Config('hostlist.conf', config_dir=config)
    host = list(hosts['hosts'][0])
    host[2] = int(port)
    hosts['hosts'] = [host] + list(hosts['hosts'][1:])
    hosts.save()
    web = Config('web.conf', config_dir=config)
    web['default_daemon'] = host[0]
    web['first_login'] = False
    web.save()
    print(f'web UI connects to 127.0.0.1:{port} on start')


def plugin(state, config, port):
    from twisted.internet import defer

    @defer.inlineCallbacks
    def job(client):
        yield client.core.rescan_plugins()
        if state == 'on':
            yield client.core.enable_plugin('Darkhand')
        else:
            yield client.core.disable_plugin('Darkhand')
        enabled = yield client.core.get_enabled_plugins()
        return 'Darkhand plugin ' + ('on' if 'Darkhand' in enabled else 'off') + ' (reload the page)'

    print(rpc(config, port, job))


def status(config, port):
    from twisted.internet import defer

    @defer.inlineCallbacks
    def job(client):
        torrents = yield client.core.get_session_state()
        enabled = yield client.core.get_enabled_plugins()
        return f'daemon: {len(torrents)} torrents, Darkhand plugin ' + ('on' if 'Darkhand' in enabled else 'off')

    print(rpc(config, port, job))


if __name__ == '__main__':
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else (None, [])
    commands = {
        'make-data': make_data,
        'add-torrents': add_torrents,
        'default-daemon': default_daemon,
        'plugin': plugin,
        'status': status,
    }
    if cmd not in commands:
        sys.exit(__doc__)
    commands[cmd](*args)
