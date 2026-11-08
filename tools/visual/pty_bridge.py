"""JSONL <-> real POSIX PTY. No third-party Python dependencies."""
import codecs
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios


def resize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


pid, master = pty.fork()
if pid == 0:
    resize(0, int(os.environ.get("VISUAL_COLS", "100")), int(os.environ.get("VISUAL_ROWS", "30")))
    os.environ.update(TERM="xterm-256color", COLORTERM="truecolor")
    os.execvp(sys.argv[1], sys.argv[1:])


def stop(*_):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ, "pty")
selector.register(sys.stdin.fileno(), selectors.EVENT_READ, "input")
pending = b""
decoder = codecs.getincrementaldecoder("utf-8")("replace")
try:
    while True:
        for key, _ in selector.select():
            if key.data == "pty":
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    chunk = b""
                if not chunk:
                    raise SystemExit(0)
                print(json.dumps({"type": "data", "data": decoder.decode(chunk)}), flush=True)
            else:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if not chunk:
                    stop()
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    message = json.loads(line)
                    if message["type"] == "input":
                        os.write(master, message["data"].encode())
                    elif message["type"] == "resize":
                        resize(master, max(16, min(240, int(message["cols"]))), max(12, min(100, int(message["rows"]))))
finally:
    os.close(master)
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
