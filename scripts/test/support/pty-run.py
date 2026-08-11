#!/usr/bin/env python3
"""テスト専用ヘルパ: 疑似端末 (pty) 経由でコマンドを起動し、指定した文字列を
起動から少し待ってから送り込んでから出力を回収する。

akari.sh の `read -rp ... </dev/tty` は stdin ではなく制御端末を直接読むため、
子プロセスの stdin をパイプで差し替えるだけでは対話分岐（Y/n 応答）を
決定論的に再現できない。pty.fork() で本物の擬似端末を割り当てることで、
実端末なしで対話分岐を検証する。

Usage: pty-run.py <input-to-send-after-spawn> -- <cmd> [args...]

Exit code はそのまま子プロセスの終了コードを返す。子プロセスが端末越しに
出力した内容（標準出力・標準エラーの両方が同じ pty 経由で混ざる）はこの
ラッパー自身の標準出力へ書き出す。
"""
import os
import pty
import select
import sys
import time


def main():
    argv = sys.argv[1:]
    if '--' not in argv:
        print('usage: pty-run.py <input> -- <cmd> [args...]', file=sys.stderr)
        return 2
    sep = argv.index('--')
    input_str = argv[0] if sep > 0 else ''
    cmd = argv[sep + 1:]
    if not cmd:
        print('usage: pty-run.py <input> -- <cmd> [args...]', file=sys.stderr)
        return 2

    pid, fd = pty.fork()
    if pid == 0:
        # 子プロセス側: pty.fork() が setsid + 制御端末の割り当てを済ませている。
        os.execvp(cmd[0], cmd)
        os._exit(127)  # execvp が失敗したときだけ到達

    out = bytearray()
    input_sent = False
    send_at = time.time() + 0.3
    deadline = time.time() + 40.0
    child_done = False
    status = 1

    while time.time() < deadline:
        if not input_sent and time.time() >= send_at:
            try:
                os.write(fd, input_str.encode('utf-8'))
            except OSError:
                pass
            input_sent = True

        try:
            r, _, _ = select.select([fd], [], [], 0.1)
        except OSError:
            break
        if r:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b''
            if chunk:
                out.extend(chunk)
            else:
                break

        wpid, wstatus = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            child_done = True
            status = _exit_code(wstatus)
            # 子終了後にバッファへ残っている出力を吸い切る。
            try:
                while True:
                    r, _, _ = select.select([fd], [], [], 0.1)
                    if not r:
                        break
                    chunk = os.read(fd, 4096)
                    if not chunk:
                        break
                    out.extend(chunk)
            except OSError:
                pass
            break

    if not child_done:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
        _, wstatus = os.waitpid(pid, 0)
        status = _exit_code(wstatus)

    sys.stdout.buffer.write(bytes(out))
    sys.stdout.flush()
    return status


def _exit_code(wstatus):
    if hasattr(os, 'waitstatus_to_exitcode'):
        return os.waitstatus_to_exitcode(wstatus)
    return wstatus >> 8


if __name__ == '__main__':
    sys.exit(main())
