# pi-bash-live-view examples

## Manual PTY run inside pi

```text
/bash-pty htop
```

## Tool-call examples

```ts
bash({ command: 'htop', timeout: 3, usePTY: true })
bash({ command: 'ffmpeg -i in.mov out.mp4', usePTY: true })
bash({ command: 'curl -L https://example.com/file -o /tmp/file', usePTY: true })
```

## Ordinary bash examples

```ts
bash({ command: 'git status' })
bash({ command: 'npm test' })
```
