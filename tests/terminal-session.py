"""Drive an actual 4w TUI session in a Linux pseudoterminal."""
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

master, slave = pty.openpty()
original = termios.tcgetattr(slave)
output = bytearray()


def resize(cols, rows):
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


resize(105, 26)
process = subprocess.Popen(
    sys.argv[1:], stdin=slave, stdout=slave, stderr=slave,
    env={**os.environ, "TERM": "xterm-256color"},
)


def send(text):
    os.write(master, text.encode())


def expect(text, start=0, wait=5):
    deadline = time.monotonic() + wait
    needle = text.encode()
    while needle not in output[start:]:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
            raise AssertionError(f"Missing {text!r}. Last frame: {output[-3500:].decode(errors='replace')}")
        try:
            output.extend(os.read(master, 65536))
        except OSError as err:
            if err.errno == errno.EIO:
                raise AssertionError("Terminal closed unexpectedly") from err
            raise
    return len(output)


try:
    mark = expect("F O U R W O R D S")
    assert "│" in output.decode()
    send("?")
    mark = expect("Guia do painel", mark)
    send("\x1b")
    mark = expect("Publicar texto", mark)
    send("\r")
    mark = expect("Texto ou Markdown", mark)
    send("\x1b[200~Olá 🌊\n# Markdown\x1b[201~")
    mark = expect("# Markdown", mark)
    assert b"CONFIRMAR OPERA" not in output
    send("\t ")
    mark = expect("Desativada", mark)
    send(" ")
    mark = expect("Ativada", mark)
    send("\x13")
    mark = expect("CONFIRMAR OPERAÇÃO", mark)
    send("\r")
    mark = expect("lua-gato-sol-rio-123456789", mark)
    expect("[oculto]")
    assert b"fwadm_00000000" not in output
    send("v")
    mark = expect("fwadm_00000000", mark)
    send("y")
    mark = expect("\x1b]52;c;", mark)

    # Back to the main menu, then exercise the compact layout and MCP catalog.
    send("\x1b")
    mark = expect("Texto ou Markdown", mark)
    send("\x1b")
    mark = expect("Publicar texto", mark)
    resize(40, 16)
    process.send_signal(signal.SIGWINCH)
    mark = expect("? Ajuda  Esc", mark)
    frame = output[output.rfind(b"\x1b[H"):]
    assert "│" not in frame.decode()
    send("j" * 8 + "\r")
    mark = expect("Explorador MCP · 1 ferramentas", mark)
    send("\r")
    mark = expect("Argumentos JSON", mark)
    send("\x1bOP")
    mark = expect("Ajuda do comando", mark)
    send("\x1b")
    mark = expect("Argumentos JSON", mark)
    send("\x13\r")
    mark = expect('"ready": true', mark)

    send("\x1b")
    mark = expect("Argumentos JSON", mark)
    send("\x1b")
    mark = expect("Explorador MCP · 1 ferramentas", mark)
    send("\x1b")
    mark = expect("? Ajuda  Esc", mark)
    send("kk\r")
    mark = expect("Sala *", mark)
    send("lua-gato-sol-rio-123456789\x13")
    mark = expect("Revisão 17", mark)
    send("e")
    mark = expect("Revisão de origem", mark)
    send("\x1b[200~\n## Novo\x1b[201~")
    mark = expect("## Novo", mark)
    send("\x13\r")
    mark = expect('"saved": true', mark)

    send("\x03")
    expect("\x1b[?1049l", mark)
    assert process.wait(timeout=5) == 0
    assert termios.tcgetattr(slave) == original
    assert re.search(rb"\x1b\[\?2004l.*\x1b\[\?25h", output, re.DOTALL)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(slave)
    os.close(master)
