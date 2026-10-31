"""Boot the real bundled kernel in a narrow TTY without credentials or API calls."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

root = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='dsh-tui-boot-') as temporary:
    home = Path(temporary) / 'home'
    project = Path(temporary) / 'project'
    project.mkdir()
    env = {**os.environ, 'DSH_HOME': str(home), 'HOME': str(home), 'TERM': 'xterm-256color', 'DSH_TELEMETRY_MODE': 'DISABLED'}
    for key in ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']:
        env.pop(key, None)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 22, 68, 0, 0))
    original = termios.tcgetattr(slave)
    def session():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    child = subprocess.Popen([sys.argv[1], str(root / 'bin/dsh-tui.js')], cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=session)
    output = b''
    ready = False
    sent_exit = False
    deadline = time.monotonic() + 35
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                output += os.read(master, 65536)
            text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output.decode(errors='replace'))
            if 'startup failed' in text or 'did not activate' in text:
                raise AssertionError(text[-3000:])
            if 'Ready' in text and 'Configureamodel' in re.sub(r'\s', '', text) and not ready:
                ready = True
                os.write(master, b'/help\r')
            if ready and 'PgUp/PgDn' in text and not sent_exit:
                os.write(master, b'\x1b')
                time.sleep(0.1)
                os.write(master, b'/exit\r')
                sent_exit = True
            if child.poll() is not None:
                break
        assert ready, 'The bundled TUI never rendered its ready/configuration state: ' + text[-3000:]
        assert sent_exit, 'The help command never rendered: ' + text[-3000:]
        assert child.poll() == 0, 'The exit command did not stop cleanly: ' + text[-3000:]
        assert 'Resume: dsh-tui --resume' in text, 'Exit did not write its resume hint after terminal cleanup'
        restored = termios.tcgetattr(slave)
        flags = termios.ICANON | termios.ECHO
        assert restored[3] & flags == original[3] & flags, 'Terminal input modes were not restored'
        print('Runtime boot passed: bundled dsh, 68-column TTY, help, clean exit and terminal restoration')
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        os.close(master)
        os.close(slave)
