package es.termozona.app;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPClient;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Network primitives for the Orkli / Ingenium cloud that a WebView cannot do:
 * HTTP without CORS, a raw TLS socket (port 2041), FTP, Wi-Fi scan and the
 * TermoWifi access-point setup. TypeScript side: src/native/capacitorBridge.ts.
 */
@CapacitorPlugin(
    name = "OrkliNet",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class OrkliNetPlugin extends Plugin {

    // s3 is only reachable by IP; its certificate is checked against this name.
    private static final String S3_IP = "46.26.48.204";
    private static final String S3_NAME = "s3.ingeniumsl.com";
    private static final int TIMEOUT_MS = 15000;

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Map<String, SocketEntry> sockets = new ConcurrentHashMap<>();

    private static class SocketEntry {
        final SSLSocket socket;
        final OutputStream out;
        final ExecutorService writer = Executors.newSingleThreadExecutor();

        SocketEntry(SSLSocket socket) throws IOException {
            this.socket = socket;
            this.out = socket.getOutputStream();
        }
    }

    private static String verifyName(String host) {
        return S3_IP.equals(host) ? S3_NAME : host;
    }

    private static String b64(byte[] data) {
        return Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private static byte[] unb64(String data) {
        return data == null ? new byte[0] : Base64.decode(data, Base64.DEFAULT);
    }

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    // ---- HTTP -------------------------------------------------------------

    @PluginMethod
    public void httpGet(PluginCall call) {
        String url = call.getString("url");
        JSObject headers = call.getObject("headers", new JSObject());
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL u = new URL(url);
                conn = (HttpURLConnection) u.openConnection();
                if (conn instanceof HttpsURLConnection && S3_IP.equals(u.getHost())) {
                    HostnameVerifier def = HttpsURLConnection.getDefaultHostnameVerifier();
                    ((HttpsURLConnection) conn).setHostnameVerifier((h, s) -> def.verify(S3_NAME, s));
                }
                conn.setConnectTimeout(TIMEOUT_MS);
                conn.setReadTimeout(TIMEOUT_MS * 2);
                conn.setUseCaches(false);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    conn.setRequestProperty(k, headers.getString(k));
                }
                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] body = readAll(in);
                JSObject h = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && !e.getValue().isEmpty()) h.put(e.getKey().toLowerCase(), e.getValue().get(0));
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("headers", h);
                ret.put("body", b64(body));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ---- TLS socket ---------------------------------------------------------

    @PluginMethod
    public void socketOpen(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 2041);
        io.execute(() -> {
            try {
                SSLSocketFactory f = (SSLSocketFactory) SSLSocketFactory.getDefault();
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, port), TIMEOUT_MS);
                SSLSocket tls = (SSLSocket) f.createSocket(s, verifyName(host), port, true);
                tls.startHandshake();
                // Unlike the official app, refuse servers whose certificate does not match.
                if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(verifyName(host), tls.getSession())) {
                    tls.close();
                    throw new SSLHandshakeException("Certificate does not match " + verifyName(host));
                }
                String id = UUID.randomUUID().toString();
                SocketEntry entry = new SocketEntry(tls);
                sockets.put(id, entry);
                io.execute(() -> readLoop(id, entry));
                JSObject ret = new JSObject();
                ret.put("id", id);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            }
        });
    }

    private void readLoop(String id, SocketEntry entry) {
        String reason = null;
        try {
            InputStream in = entry.socket.getInputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                byte[] chunk = new byte[n];
                System.arraycopy(buf, 0, chunk, 0, n);
                JSObject ev = new JSObject();
                ev.put("id", id);
                ev.put("data", b64(chunk));
                notifyListeners("socketData", ev);
            }
            reason = "eof";
        } catch (IOException e) {
            reason = e.getMessage();
        } finally {
            if (sockets.remove(id) != null) {
                closeQuietly(entry);
                JSObject ev = new JSObject();
                ev.put("id", id);
                ev.put("reason", reason);
                notifyListeners("socketClosed", ev);
            }
        }
    }

    @PluginMethod
    public void socketWrite(PluginCall call) {
        String id = call.getString("id");
        byte[] data = unb64(call.getString("data"));
        SocketEntry entry = sockets.get(id);
        if (entry == null) {
            call.reject("Socket closed");
            return;
        }
        entry.writer.execute(() -> {
            try {
                entry.out.write(data);
                entry.out.flush();
                call.resolve();
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void socketClose(PluginCall call) {
        SocketEntry entry = sockets.remove(call.getString("id"));
        if (entry != null) closeQuietly(entry);
        call.resolve();
    }

    private static void closeQuietly(SocketEntry entry) {
        try {
            entry.socket.close();
        } catch (IOException ignored) {
        }
        entry.writer.shutdown();
    }

    @Override
    protected void handleOnDestroy() {
        for (SocketEntry e : sockets.values()) closeQuietly(e);
        sockets.clear();
        super.handleOnDestroy();
    }

    // ---- FTP ------------------------------------------------------------------

    private FTPClient ftpLogin(String host, String user, String password) throws IOException {
        FTPClient ftp = new FTPClient();
        ftp.setConnectTimeout(TIMEOUT_MS);
        ftp.setDefaultTimeout(TIMEOUT_MS);
        ftp.connect(host, 21);
        if (!ftp.login(user, password)) {
            String reply = ftp.getReplyString();
            ftp.disconnect();
            throw new IOException("FTP login failed: " + reply);
        }
        ftp.setFileType(FTP.BINARY_FILE_TYPE);
        ftp.enterLocalPassiveMode();
        return ftp;
    }

    private static void ftpClose(FTPClient ftp) {
        try {
            ftp.logout();
        } catch (IOException ignored) {
        }
        try {
            ftp.disconnect();
        } catch (IOException ignored) {
        }
    }

    @PluginMethod
    public void ftpStore(PluginCall call) {
        String host = call.getString("host");
        String user = call.getString("user");
        String password = call.getString("password");
        JSArray files = call.getArray("files", new JSArray());
        io.execute(() -> {
            FTPClient ftp = null;
            try {
                ftp = ftpLogin(host, user, password);
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.getJSONObject(i);
                    String name = f.getString("name");
                    // Unlike the official app, check every upload.
                    if (!ftp.storeFile(name, new ByteArrayInputStream(unb64(f.getString("data"))))) {
                        throw new IOException("FTP upload of " + name + " failed: " + ftp.getReplyString());
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            } finally {
                if (ftp != null) ftpClose(ftp);
            }
        });
    }

    @PluginMethod
    public void ftpRetrieve(PluginCall call) {
        String host = call.getString("host");
        String user = call.getString("user");
        String password = call.getString("password");
        String name = call.getString("name");
        io.execute(() -> {
            FTPClient ftp = null;
            try {
                ftp = ftpLogin(host, user, password);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                JSObject ret = new JSObject();
                ret.put("data", ftp.retrieveFile(name, out) ? b64(out.toByteArray()) : JSObject.NULL);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            } finally {
                if (ftp != null) ftpClose(ftp);
            }
        });
    }

    // ---- Wi-Fi ------------------------------------------------------------------

    @PluginMethod
    public void scanWifi(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "scanAfterPermission");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void scanAfterPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) doScan(call);
        else call.reject("Permiso de ubicación denegado: es necesario para ver las redes Wi-Fi cercanas.");
    }

    @SuppressWarnings("deprecation")
    private void doScan(PluginCall call) {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        io.execute(() -> {
            try {
                wifi.startScan(); // throttled on modern Android; cached results are fine
                Thread.sleep(2500);
                Set<String> seen = new HashSet<>();
                JSONArray list = new JSONArray();
                for (ScanResult r : wifi.getScanResults()) {
                    String ssid = r.SSID;
                    if (ssid == null || ssid.isEmpty() || !seen.add(ssid)) continue;
                    JSONObject o = new JSONObject();
                    o.put("ssid", ssid);
                    o.put("level", r.level);
                    list.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("networks", list);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    /** The Wi-Fi network (the TermoWifi access point) even if Android prefers mobile data. */
    private Network wifiNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(n);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return n;
        }
        return null;
    }

    /**
     * Sends the home Wi-Fi SSID and password to a TermoWifi in access-point mode,
     * as ConfigureWifiActivityStep3.sendWifiCredentials() does: one UDP frame per
     * byte to 192.168.4.1:12000, each one acknowledged, then a commit frame.
     */
    @PluginMethod
    public void provisionWifi(PluginCall call) {
        String ssid = call.getString("ssid", "");
        String password = call.getString("password", "");
        io.execute(() -> {
            DatagramSocket sock = null;
            try {
                byte[] data = new byte[96];
                byte[] s = ssid.getBytes(StandardCharsets.ISO_8859_1);
                byte[] p = password.getBytes(StandardCharsets.ISO_8859_1);
                if (s.length > 32 || p.length > 63) throw new IOException("SSID o contraseña demasiado largos");
                System.arraycopy(s, 0, data, 0, s.length);
                System.arraycopy(p, 0, data, 33, p.length);

                sock = new DatagramSocket(null);
                sock.setReuseAddress(true);
                sock.setSoTimeout(1000);
                sock.bind(new InetSocketAddress(12000));
                Network net = wifiNetwork();
                if (net != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) net.bindSocket(sock);
                InetAddress ap = InetAddress.getByName("192.168.4.1");
                DatagramPacket reply = new DatagramPacket(new byte[7], 7);

                for (int i = 0; i < data.length; i++) {
                    byte[] frame = configFrame(i, data[i]);
                    boolean acked = false;
                    for (int attempt = 0; attempt < 10 && !acked; attempt++) {
                        sock.send(new DatagramPacket(frame, 7, ap, 12000));
                        try {
                            sock.receive(reply);
                            acked = ap.equals(reply.getAddress());
                        } catch (SocketTimeoutException ignored) {
                        }
                    }
                    if (!acked) throw new IOException("El TermoWifi no responde");
                    JSObject ev = new JSObject();
                    ev.put("percent", (i * 100) / data.length);
                    notifyListeners("provisionProgress", ev);
                }
                sock.send(new DatagramPacket(configFrame(97, (byte) 0), 7, ap, 12000));
                JSObject ev = new JSObject();
                ev.put("percent", 100);
                notifyListeners("provisionProgress", ev);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            } finally {
                if (sock != null) sock.close();
            }
        });
    }

    private static byte[] configFrame(int index, byte value) {
        byte[] f = { 0x3B, (byte) 0xFE, (byte) 0xFE, (byte) 0x8C, (byte) index, value, 0 };
        f[6] = (byte) (f[1] + f[2] + f[3] + f[4] + f[5]);
        return f;
    }
}
