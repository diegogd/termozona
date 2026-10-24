# Orkli / Ingenium cloud protocol

How Orkli iDomus 3.5.001 (`com.orkli.orkliapp`) reaches a TermoWifi through
the Ingenium cloud. Complements `PROTOCOL.md` in the Home Assistant integration,
which documents the 7-byte local frames and the register map.

Sources: decompiled app (class names below) and a live session against
`s2.ingeniumsl.com` on 2026-10-24 (`prototype/orkli_cloud.py`, read-only).

## Hosts

| Host | Port | Use |
|------|------|-----|
| `s2.ingeniumsl.com` (85.152.52.212) | 8877 HTTPS | `locate_ethbus`, `login` |
| same | 2041 TLS | Live socket with the installation |
| same | 21 FTP (plain) | Project files: `Instal.dat`, `chronos.data`, … |
| 85.152.52.212 | 8080 HTTP (plain) | Account creation |
| `s3.ingeniumsl.com` (46.26.48.204) | same ports | Fallback server, reached by IP. **Does not answer** (2026-10-24) |

`s2.ingeniumsl.com` has a valid Let's Encrypt certificate on 8877 and 2041.
The app connects by IP and disables host name checks
(`SSLSocketFactoryConfigurator`, `Globals.createRemoteSocket` builds an
exception and never throws it). TermoZona connects by name and verifies.

## 1. Locate the server

```
GET https://s2.ingeniumsl.com:8877/api/locate_ethbus?user=<user>
Authorization: Basic Og==            (empty user and password)
```

200 with the domain in the body (empty body = `s2.ingeniumsl.com`). 404 = unknown user. Any error:
the app falls back to `s3.ingeniumsl.com` (`MainActivity.locateEthbus`).
An unknown user answers 404.

## 2. Login

```
GET https://<domain>:8877/login
Authorization: Basic base64(user:password)
If-Modified-Since: <last-modified of the previous login>   (optional)
```

| Status | Meaning (`MainActivity.processCode`) |
|--------|---------|
| 200 | Body is `project.zip`; headers below |
| 304 | Project unchanged; headers below |
| 401 | Wrong user or password |
| 403 | Banned (too many attempts) |
| 423 | Outside the allowed access schedule (slave users) |
| 500 | Server error |

Headers: `x-ident` (installation id, `W` + the 6 characters of the TermoWifi
`Ing_XXXXXX` access point), `x-token` (socket token), `x-server-ip` (empty =
the installation is offline), `x-server` (TLS name for the socket),
`x-users`, `last-modified`.

`project.zip` for a TermoWifi contains `Instal.dat`, `chronos.data`,
`termowifi.data` (empty, marks a TermoWifi project), `Plano0.jpg`, icon
sheets, `scenes.data`, `tempos.data`, `themes*.json` and `sync`.

## 3. Socket

TLS to `<x-server>:2041`. First message (`Globals.createRemoteSocket`):

```
19 FA <len hi> <len lo> <JSON DeviceData>
{"deviceName":…,"info":…,"osVersion":…,"token":"<x-token>","brand":…,"model":…,"appVersion":"3.5.001-440"}
```

Every command is two 9-byte writes, 300 ms apart (`Comunicacion.enviarTelegrama`):

```
EE EE <x-ident, 7 ASCII bytes>
FF FF <dst hi> <dst lo> FE FE <cmd> <d1> <d2>
```

The TermoWifi is `dst = 0x0001`. Incoming frames are 9 bytes:

```
FE FE <dst hi> <dst lo> <org hi> <org lo> <cmd> <d1> <d2>
```

Observed after `04 23 00` (full dump):

```
fe fe 00 01 00 fe 04 23 00   echo of our command (org FE)
fe fe 00 fe 00 01 01 00 00   ACK from the TermoWifi
fe fe 00 01 00 01 04 35 8d   status report (dst == org == 1): available modes
fe fe 00 01 00 01 04 00 02   zone 1 state off
…
```

Status reports have `dst == org == 1` and use the register map of `PROTOCOL.md`.
Commands sent by other clients of the same installation are echoed too.

## 4. Schedule (`chronos.data`)

Plain text, uploaded by FTP with the account credentials, then a `sync` file
and two telegrams to `dst = 254`: `cmd 122 (0x7A), d1 12, d2 0` and
`cmd 122, d1 255, d2 255` (`ChronothermostatsActivity.syncChronothermostats`).
The cloud runs it, so it works with the phone off.

```
TZ:Europe/Madrid
<days>       bit 0 enabled, bits 1..7 Monday..Sunday
<epoch s>    only the local hour and minute (in TZ) matter
<zones>      bit (z + 1) for zone z (0-based)
<setpoint>   °C, "21.5"
… 30 records in total; unused = 0 / 0 / 0 / 18.0
```

A record only changes the setpoint; it does not turn zones on or off.

Checked against the real cloud on 2026-10-24 (files uploaded, zones monitored,
original file restored afterwards):

- multi-zone records, several records at the same minute, disabled records,
  single-day and every-day masks all behave as described; changes were applied
  within ~40 s of the minute, in local time (Europe/Madrid);
- zones that are off stay off: only the setpoint changes;
- **the 30-record limit is not enforced by the cloud**: a 40-record file was
  accepted and record 36 was executed. The official app always writes 30
  records (and fills 30 when the file is missing), which is where the limit in
  its UI comes from. The real upper bound is unknown.

## 5. Account creation

```
GET http://85.152.52.212:8080/WebServices/Altas/add_filezilla_user.php
    ?user_name=…&user_password=…&user_ident=W<6 chars>&pass_ident=<crc>
```

`pass_ident` (`ConfigureTermowifiUserActivity.getCrcAlta`): for i in 0..6,
`'A'` if user or password is shorter than i+1, else
`chr(((user[i] ^ password[i] ^ ident[i]) & 0x77) | 0x41)`.

Body contains `Error(-1)` invalid, `Error(-2)` user exists, `Error(-3..-5)` and
`Error(-100)` generic errors; anything else is success, with `x-token`.

The official app then discovers zones over the socket (reads `z*4+3` for
z = 0..7, two passes, 3 s apart; a zone exists if it reports a non-zero
setpoint) and uploads by FTP `Instal.dat`, `Plano0.jpg`, `iconos_t0.png` and an
empty `termowifi.data`.

Defects of the official flow that explain failed sign-ups:

- user and password are not URL-encoded (spaces, `&`, `+`, `#`, `ñ` break it);
- an HTTP error shows a generic message; with no network the error handler
  dereferences a null response and crashes;
- account creation and the FTP upload are not one step: if the upload fails,
  retrying hits "user exists" and there is no way to resume;
- `ftp.login()` and `storeFile()` results are ignored, so "success" is shown
  even when nothing was uploaded.

## 6. Wi-Fi setup of a TermoWifi (access-point mode)

Phone joined to the `Ing_XXXXXX` network. UDP from local port 12000 to
`192.168.4.1:12000`, one frame per byte of a 96-byte buffer (SSID at 0..32,
password at 33..95, zero padded), each acknowledged by the device:

```
3B FE FE 8C <index> <byte> <(FE+FE+8C+index+byte) & FF>
```

then the commit frame with index `0x61`. Optionally, a new access-point
password is written over TCP 12345 at indexes `0x62..0x72`, committed with
`0x73` (`ConfigureWifiActivityStep3`).

## 7. Scenes and timers (`scenes.data`, `tempos.data`, PnP timers)

From the decompiled app only (nothing sent to the cloud):

- `tempos.data` (64 timers × 3076 B, little-endian) is never written or uploaded
  for installations whose id starts with `W` ("Center Link"), which is every
  TermoWifi. It is not a way to schedule anything here.
- `scenes.data` holds user scenes whose orders are raw telegrams
  `(address, cmd, d1, d2)` (`Globals.get_scenes/save_scenes`). For a TermoWifi
  zone, turning it on or off is the order `(1, 4, z*4, 3)` / `(1, 4, z*4, 2)`;
  the official scene editor already generates that for type-49 objects.
- On Center Link installations scenes and day/time timers ("timers PnP",
  64 × 4 B: `enabled<<7 | days`, hour, minute, scene) are programmed with
  telegrams to `dst 254`: scenes with `cmd 190+i`, timers with `cmd 99`
  (`Globals.programCenterLink`). The Orkli UI hides these screens.
- **Unconfirmed**: whether the TermoWifi or the cloud accept and run them. If
  they do, they would allow scheduling on/off, which `chronos.data` cannot.
