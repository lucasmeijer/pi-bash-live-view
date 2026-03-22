# pi-bash-live-view

When agents emit tool calls calls for build systems, those calls can take a long time.
Often they have really nice visualizations of progress.
I cannot see those in pi, making me blind to what is happening.

This extension upgrades model-initiated `bash` calls with an optional PTY-backed live terminal view.

[![Demo](assets/demo.gif)](https://github.com/lucasmeijer/pi-bash-live-view/releases/download/readme-assets/Screen.Recording.2026-03-20.at.22.27.36.web.mp4)

_Open the full demo video:_
https://github.com/lucasmeijer/pi-bash-live-view/releases/download/readme-assets/Screen.Recording.2026-03-20.at.22.27.36.web.mp4

## Install

```bash
pi install npm:pi-bash-live-view
```

## Interactive commands

`usePTY=true` is a live, PTY-backed **output view** for the `bash` tool. It does not hand terminal input back to the user or the model.

If a command appears to stop on an interactive prompt such as a password request, a `[Y/n]` confirmation, or `Press enter to continue`, the extension now aborts that run and returns a clear error instead of hanging forever.

When possible, prefer non-interactive flags and environment variables for PTY runs.

