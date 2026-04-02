# pi-bash-live-view

When agents emit tool calls calls for build systems, those calls can take a long time.
Often they have really nice visualizations of progress.
I cannot see those in pi, making me blind to what is happening.

This extension upgrades model-initiated `bash` calls with an optional PTY-backed live terminal view, and routes interactive `!` and `!!` commands through the same PTY live view.

[![Demo](assets/demo.gif)](https://github.com/lucasmeijer/pi-bash-live-view/releases/download/readme-assets/Screen.Recording.2026-03-20.at.22.27.36.web.mp4)

_Open the full demo video:_
https://github.com/lucasmeijer/pi-bash-live-view/releases/download/readme-assets/Screen.Recording.2026-03-20.at.22.27.36.web.mp4

## Install

```bash
pi install npm:pi-bash-live-view
```

