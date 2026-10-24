#!/usr/bin/env python3
"""Prototype client for the Orkli / Ingenium cloud (TermoWifi installations).

Reproduces what the Orkli iDomus 3.5.001 app does, step by step:

1. GET https://s2.ingeniumsl.com:8877/api/locate_ethbus?user=<user>
   -> body is the server domain (empty means s2.ingeniumsl.com).
2. GET https://<domain>:8877/login with HTTP Basic auth
   -> 200 + project.zip (or 304), headers x-ident, x-token, x-server-ip, x-server.
3. TLS socket to <x-server>:2041, hello = 19 FA <len16> <DeviceData JSON>.
4. Each command: EE EE <ident 7 bytes>, then FF FF 00 01 FE FE CMD D1 D2.
   Incoming frames are 9 bytes: ?? ?? DST_HI DST_LO ORG_HI ORG_LO CMD D1 D2.

Credentials come from ORKLI_USER / ORKLI_PASS or from a .env file next to the
project root. Nothing is written to the device unless --set is passed.

Usage:
  python3 prototype/orkli_cloud.py                 # login + status dump
  python3 prototype/orkli_cloud.py --listen 60     # keep listening 60 s
  python3 prototype/orkli_cloud.py --set 1 21.5    # zone 1 setpoint 21.5 °C
"""

from __future__ import annotations

import argparse
import base64
import ftplib
import io
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

LOCATE_URL = "https://s2.ingeniumsl.com:8877/api/locate_ethbus?user={user}"
DEFAULT_DOMAIN = "s2.ingeniumsl.com"
S3_DOMAIN = "s3.ingeniumsl.com"
S3_IP = "46.26.48.204"
SOCKET_PORT = 2041
TERMOWIFI_ADDR = 1
APP_ADDR = 0xFE
APP_VERSION = "3.5.001-440"

REGISTER_NAMES = {0: "estado", 1: "modo", 2: "consigna", 3: "ambiente"}


def load_credentials() -> tuple[str, str]:
    user = os.environ.get("ORKLI_USER")
    password = os.environ.get("ORKLI_PASS")
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if (not user or not password) and env_file.exists():
        for line in env_file.read_text().splitlines():
            key, _, value = line.partition("=")
            value = value.strip().strip('"').strip("'")
            if key.strip() == "ORKLI_USER" and not user:
                user = value
            elif key.strip() == "ORKLI_PASS" and not password:
                password = value
    if not user or not password:
        sys.exit("Faltan credenciales: define ORKLI_USER y ORKLI_PASS o crea .env")
    return user, password


def tls_ctx(host: str) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if host != S3_IP:
        return ctx
    # s3 is only reachable by IP, as in the app, so its name cannot be checked.
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def http_get(url: str, user: str, password: str) -> tuple[int, dict, bytes]:
    host = urllib.parse.urlsplit(url).hostname
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    try:
        with urllib.request.urlopen(req, context=tls_ctx(host), timeout=15) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


def locate(user: str) -> str:
    status, _, body = http_get(LOCATE_URL.format(user=urllib.parse.quote(user)), "", "")
    if status == 404:
        sys.exit("[locate] no existe ninguna cuenta con ese usuario")
    if status != 200:
        # The app falls back to s3 here, but s3 no longer answers.
        print(f"[locate] HTTP {status} -> {DEFAULT_DOMAIN}")
        return DEFAULT_DOMAIN
    domain = body.decode(errors="replace").strip() or DEFAULT_DOMAIN
    print(f"[locate] HTTP {status} -> {domain}")
    return domain


def login(domain: str, user: str, password: str) -> dict:
    host = S3_IP if domain == S3_DOMAIN else domain
    status, headers, body = http_get(f"https://{host}:8877/login", user, password)
    print(f"[login] HTTP {status}")
    errors = {401: "usuario o contraseña incorrectos", 403: "cuenta bloqueada",
              423: "fuera de horario de acceso", 500: "error interno del servidor"}
    if status not in (200, 304):
        sys.exit(f"[login] fallo: {errors.get(status, 'desconocido')} {body[:200]!r}")
    info = {k: headers.get(k, "") for k in ("x-ident", "x-token", "x-server-ip", "x-server", "last-modified")}
    for k, v in info.items():
        shown = v[:6] + "…" if k == "x-token" and v else v
        print(f"  {k}: {shown}")
    if not info["x-server-ip"]:
        sys.exit("[login] la pasarela está desconectada (x-server-ip vacío)")
    if domain == S3_DOMAIN:
        info["x-server-ip"] = S3_IP
    info["project"] = {}
    if status == 200 and body:
        try:
            with zipfile.ZipFile(io.BytesIO(body)) as zf:
                for name in zf.namelist():
                    info["project"][name] = zf.read(name)
        except zipfile.BadZipFile:
            print("[login] la respuesta 200 no es un zip")
    return info


def show_project(files: dict[str, bytes]) -> None:
    if not files:
        return
    print(f"[proyecto] {len(files)} ficheros: {', '.join(sorted(files))}")
    for name in ("Instal.dat", "chronos.data", "termowifi.data"):
        if name in files and files[name]:
            print(f"--- {name} ---")
            print(files[name].decode("utf-8", errors="replace").rstrip())


class CloudSocket:
    def __init__(self, host: str, ident: str, token: str):
        self.ident = ident
        raw = socket.create_connection((host, SOCKET_PORT), timeout=15)
        self.sock = tls_ctx(host).wrap_socket(raw, server_hostname=host)
        hello = json.dumps({
            "deviceName": "orkli-prototype",
            "info": "start comunicacion",
            "osVersion": "34",
            "token": token,
            "brand": "prototype",
            "model": "python",
            "appVersion": APP_VERSION,
        }, separators=(",", ":")).encode()
        self.sock.sendall(bytes([0x19, 0xFA, len(hello) >> 8, len(hello) & 0xFF]) + hello)
        self.buf = b""
        print(f"[socket] conectado a {host}:{SOCKET_PORT}")

    def send(self, cmd: int, d1: int, d2: int, dest: int = TERMOWIFI_ADDR) -> None:
        ident = self.ident.encode()[:7].ljust(7, b"\0")
        self.sock.sendall(b"\xEE\xEE" + ident)
        time.sleep(0.3)
        frame = bytes([0xFF, 0xFF, dest >> 8, dest & 0xFF, APP_ADDR, APP_ADDR, cmd, d1, d2])
        self.sock.sendall(frame)
        print(f"[tx] {frame.hex(' ')}")

    def frames(self, seconds: float):
        deadline = time.time() + seconds
        self.sock.settimeout(1.0)
        while time.time() < deadline:
            try:
                chunk = self.sock.recv(4096)
            except (socket.timeout, TimeoutError):
                continue
            if not chunk:
                print("[socket] cerrado por el servidor")
                return
            self.buf += chunk
            while len(self.buf) >= 9:
                frame, self.buf = self.buf[:9], self.buf[9:]
                yield frame


def decode(frame: bytes, zones: dict) -> str:
    dst = (frame[2] << 8) | frame[3]
    org = (frame[4] << 8) | frame[5]
    cmd, d1, d2 = frame[6], frame[7], frame[8]
    head = f"{frame.hex(' ')}  dst={dst} org={org} cmd=0x{cmd:02X}"
    if cmd != 0x04 or dst != org:
        return head
    if d1 < 32:
        zone, reg = divmod(d1, 4)
        z = zones.setdefault(zone + 1, {})
        if reg == 2:
            value = d2 / 2 if d2 else None
            z["consigna"] = value
        elif reg == 3:
            value = (162 - d2) / 2 if d2 >= 62 else None
            z["ambiente"] = value
        elif reg == 0:
            value = "on" if d2 & 1 else "off"
            z["estado"] = value
        else:
            mode = d2 & 0x0F
            value = f"{mode} ({'frío' if mode % 2 else 'calor'}) fan=0x{d2 & 0xF0:02X}"
            z["modo"] = value
        return f"{head}  zona {zone + 1} {REGISTER_NAMES[reg]} = {value}"
    if 0x64 <= d1 < 0x6C:
        hum = None if d2 in (0, 255) else round(d2 / 2.55, 1)
        zones.setdefault(d1 - 0x64 + 1, {})["humedad"] = hum
        return f"{head}  zona {d1 - 0x64 + 1} humedad = {hum}"
    return f"{head}  registro 0x{d1:02X} = {d2}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", type=float, default=15, help="segundos escuchando")
    parser.add_argument("--set", nargs=2, metavar=("ZONA", "TEMP"), help="cambia consigna")
    parser.add_argument("--dump-project", type=Path, help="guarda el zip del proyecto aquí")
    parser.add_argument("--upload-chronos", type=Path, help="sube este chronos.data y pide a la nube que lo recargue")
    args = parser.parse_args()

    user, password = load_credentials()
    domain = locate(user)
    info = login(domain, user, password)
    show_project(info["project"])
    if args.dump_project and info["project"]:
        args.dump_project.mkdir(parents=True, exist_ok=True)
        for name, data in info["project"].items():
            (args.dump_project / name).write_bytes(data)

    # x-server is the TLS name of the socket server; s3 only works by IP.
    host = S3_IP if domain == S3_DOMAIN else (info["x-server"] or info["x-server-ip"])
    cloud = CloudSocket(host, info["x-ident"], info["x-token"])
    if args.upload_chronos:
        data = args.upload_chronos.read_bytes()
        ftp = ftplib.FTP(info["x-server-ip"], timeout=15)
        ftp.login(user, password)
        ftp.storbinary("STOR chronos.data", io.BytesIO(data))
        ftp.storbinary("STOR sync", io.BytesIO(b"sync"))
        ftp.quit()
        print(f"[ftp] chronos.data subido ({len(data)} bytes)")
        # Same reload request as ChronothermostatsActivity.syncChronothermostats().
        cloud.send(122, 12, 0, dest=254)
        cloud.send(122, 255, 255, dest=254)
    cloud.send(0x04, 0x23, 0x00)  # full status dump
    if args.set:
        zone, temp = int(args.set[0]), float(args.set[1])
        if not 1 <= zone <= 8 or not 15 <= temp <= 35:
            sys.exit("zona 1..8, temperatura 15..35")
        cloud.send(0x04, (zone - 1) * 4 + 2, round(temp * 2))
        cloud.send(0x04, (zone - 1) * 4 + 3, 0)

    zones: dict = {}
    for frame in cloud.frames(args.listen):
        print("[rx]", decode(frame, zones))

    print("\n=== Resumen ===")
    for zone in sorted(zones):
        print(f"Zona {zone}: {zones[zone]}")


if __name__ == "__main__":
    main()
