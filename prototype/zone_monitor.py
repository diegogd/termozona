#!/usr/bin/env python3
"""Polls every zone through the cloud and prints setpoint/state changes with timestamps.

Read-only: only sends read requests (z*4+3 = 0). Used to check that the cloud
runs a schedule at the right time.

  python3 prototype/zone_monitor.py --zones 3 --minutes 12 --every 15
"""

import argparse
import datetime
import time

import orkli_cloud as oc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zones", type=int, default=3)
    ap.add_argument("--minutes", type=float, default=10)
    ap.add_argument("--every", type=float, default=15)
    ap.add_argument("--once", action="store_true", help="print the current state and exit")
    args = ap.parse_args()

    user, password = oc.load_credentials()
    domain = oc.locate(user)
    info = oc.login(domain, user, password)
    host = oc.S3_IP if domain == oc.S3_DOMAIN else (info["x-server"] or info["x-server-ip"])
    cloud = oc.CloudSocket(host, info["x-ident"], info["x-token"])

    zones: dict = {}
    last: dict = {}
    deadline = time.time() + args.minutes * 60
    while True:
        for z in range(args.zones):
            cloud.send(0x04, z * 4 + 3, 0)
        for frame in cloud.frames(4):
            oc.decode(frame, zones)
        now = datetime.datetime.now().strftime("%H:%M:%S")
        for z in sorted(zones):
            cur = (zones[z].get("estado"), zones[z].get("consigna"))
            if last.get(z) != cur:
                print(f"{now} zona {z} estado={cur[0]} consigna={cur[1]}", flush=True)
                last[z] = cur
        if args.once or time.time() > deadline:
            break
        time.sleep(max(0, args.every - 4))


if __name__ == "__main__":
    main()
