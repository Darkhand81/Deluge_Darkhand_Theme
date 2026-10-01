# Darkhand: notes for Claude

## Commits and pull requests

- Don't add attribution to commit messages: no `Co-Authored-By:` lines and
  no `Claude-Session:` (or any other claude.ai session) links.
- Don't put claude.ai session links in pull request descriptions or GitHub
  comments either.

## The project

- `theme/`: the Darkhand theme (an ExtJS xtheme for the Deluge Web UI) and,
  in `theme/darkhand/dashboard.css`, the dashboard's styles.
- `plugin/`: the Darkhand dashboard plugin; its script is
  `plugin/deluge_darkhand/data/darkhand.js`.
- `darkhand.sh`: the Linux installer.
- `docs/STYLE_GUIDE.md`: design tokens, layout rules, and the Deluge and
  ExtJS gotchas worked around. Read it before changing the theme or plugin.
- `tools/test/`: a throwaway test server, screenshot regression and
  cut-off text checks (see `tools/test/README.md`), and the README
  screenshot script.
- The plugin's version (shown on Deluge's Plugins page) is the `Version:`
  in `plugin/EGG-INFO/PKG-INFO`. Bump it before a release; the release
  workflow fails if it doesn't match the tag.
- `.github/workflows/release.yml`: a `v*` tag publishes a release with the
  plugin egg and a theme zip.
