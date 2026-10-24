package es.termozona.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.PatternMatcher;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.FileProvider;

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
import java.io.File;
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
import java.util.concurrent.atomic.AtomicBoolean;
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
        releaseAp();
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
                    o.put("frequency", r.frequency);
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
                Network net = apNetwork != null ? apNetwork : wifiNetwork();
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

    // ---- TermoWifi access point ------------------------------------------------

    /** Every TermoWifi in setup mode broadcasts "Ing_XXXXXX" with this fixed password. */
    private static final String AP_PASSWORD = "1234567890";
    private ConnectivityManager.NetworkCallback apCallback;
    private volatile Network apNetwork;

    private ConnectivityManager connectivity() {
        return (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    /** The SSID the phone is connected to, or null when Android hides it. */
    @SuppressWarnings("deprecation")
    private String connectedSsid() {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        String ssid = wifi.getConnectionInfo() == null ? null : wifi.getConnectionInfo().getSSID();
        if (ssid == null || ssid.equals(WifiManager.UNKNOWN_SSID) || ssid.isEmpty()) return null;
        return ssid.startsWith("\"") && ssid.endsWith("\"") ? ssid.substring(1, ssid.length() - 1) : ssid;
    }

    @PluginMethod
    public void currentWifi(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "currentWifiAfterPermission");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ssid", connectedSsid());
        call.resolve(ret);
    }

    @PermissionCallback
    private void currentWifiAfterPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ssid", getPermissionState("location") == PermissionState.GRANTED ? connectedSsid() : null);
        call.resolve(ret);
    }

    /**
     * Joins the TermoWifi's own network without leaving the app (Android 10+):
     * the system asks the user to confirm, and the connection lasts until
     * leaveDeviceWifi(), when the phone goes back to the home Wi-Fi by itself.
     * Rejects with UNSUPPORTED on older Android and UNAVAILABLE when the user
     * cancels or no "Ing_" network shows up in time.
     */
    @PluginMethod
    public void joinDeviceWifi(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Esta versión de Android no permite conectarse desde la app", "UNSUPPORTED");
            return;
        }
        releaseAp();
        String ssid = call.getString("ssid");
        WifiNetworkSpecifier.Builder spec = new WifiNetworkSpecifier.Builder().setWpa2Passphrase(AP_PASSWORD);
        if (ssid != null && !ssid.isEmpty()) spec.setSsid(ssid);
        else spec.setSsidPattern(new PatternMatcher("Ing_", PatternMatcher.PATTERN_PREFIX));
        NetworkRequest request = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .setNetworkSpecifier(spec.build())
            .build();
        AtomicBoolean answered = new AtomicBoolean(false);
        ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                apNetwork = network;
                if (!answered.compareAndSet(false, true)) return;
                String joined = connectedSsid();
                JSObject ret = new JSObject();
                ret.put("ssid", joined != null && joined.startsWith("Ing_") ? joined : ssid);
                call.resolve(ret);
            }

            @Override
            public void onUnavailable() {
                if (apCallback == this) apCallback = null;
                if (answered.compareAndSet(false, true)) call.reject("No se ha podido conectar con el TermoWifi", "UNAVAILABLE");
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(apNetwork)) apNetwork = null;
            }
        };
        apCallback = cb;
        try {
            connectivity().requestNetwork(request, cb, 120000);
        } catch (Exception e) {
            apCallback = null;
            call.reject(e.getMessage(), "UNAVAILABLE", e);
        }
    }

    @PluginMethod
    public void leaveDeviceWifi(PluginCall call) {
        releaseAp();
        call.resolve();
    }

    private void releaseAp() {
        ConnectivityManager.NetworkCallback cb = apCallback;
        apCallback = null;
        apNetwork = null;
        if (cb != null) {
            try {
                connectivity().unregisterNetworkCallback(cb);
            } catch (IllegalArgumentException ignored) {
            }
        }
    }

    /** Android's Wi-Fi settings: a panel over the app on Android 10+. */
    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        try {
            String action = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS;
            Intent intent = new Intent(action);
            if (getActivity() != null) getActivity().startActivity(intent);
            else getContext().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    // ---- updates -----------------------------------------------------------------

    /** Opens a link in the phone's browser (not an in-app tab, which cannot download APKs). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /**
     * Downloads a release APK into the cache and hands it to the system
     * installer. The installer itself checks that the signature matches the
     * installed app. Rejects with code "INSTALL_PERMISSION" after opening the
     * "install unknown apps" setting when TermoZona is not allowed yet.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(settings);
            call.reject("Falta permiso para instalar aplicaciones", "INSTALL_PERMISSION");
            return;
        }
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(ctx.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("No se puede crear " + dir);
                File apk = new File(dir, "TermoZona-update.apk");
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(TIMEOUT_MS);
                conn.setReadTimeout(TIMEOUT_MS * 2);
                conn.setInstanceFollowRedirects(true);
                int status = conn.getResponseCode();
                if (status != 200) throw new IOException("HTTP " + status);
                long total = conn.getContentLengthLong();
                try (InputStream in = conn.getInputStream(); java.io.FileOutputStream out = new java.io.FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int lastPct = -1;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject ev = new JSObject();
                            ev.put("percent", pct);
                            notifyListeners("updateProgress", ev);
                        }
                    }
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(install);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static byte[] configFrame(int index, byte value) {
        byte[] f = { 0x3B, (byte) 0xFE, (byte) 0xFE, (byte) 0x8C, (byte) index, value, 0 };
        f[6] = (byte) (f[1] + f[2] + f[3] + f[4] + f[5]);
        return f;
    }
}
