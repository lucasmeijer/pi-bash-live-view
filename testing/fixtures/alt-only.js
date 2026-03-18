process.stdout.write('\x1b[?1049hALT ONLY\n');
setTimeout(() => process.stdout.write('\x1b[?1049l'), 200);
