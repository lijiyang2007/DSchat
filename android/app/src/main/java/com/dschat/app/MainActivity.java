package com.dschat.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebSettings;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    private static final Set<String> HOP_BY_HOP = new HashSet<>(Arrays.asList(
        "host",
        "origin",
        "referer",
        "connection",
        "content-length",
        "transfer-encoding",
        "x-proxy-target",
        "accept-encoding",
        "cookie"
    ));

    private volatile ServerSocket proxyServer;
    private volatile int proxyPort = -1;
    private ExecutorService proxyPool;

    private volatile String updateStatus = "idle";
    private volatile int updateProgress = 0;
    private volatile long updateDownloaded = 0;
    private volatile long updateTotal = 0;
    private volatile String updateError = "";
    private volatile File downloadedApkFile = null;

    public class ProxyBridge {
        @JavascriptInterface
        public String getProxyOrigin() {
            return proxyPort > 0 ? "http://127.0.0.1:" + proxyPort : "";
        }

        @JavascriptInterface
        public String getAppInfo() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
                String versionName = info.versionName != null ? info.versionName : "1.0.0";
                return "{\"isAndroid\":true,\"versionCode\":" + versionCode
                    + ",\"versionName\":\"" + escapeJson(versionName) + "\"}";
            } catch (Exception e) {
                return "{\"isAndroid\":true,\"versionCode\":1,\"versionName\":\"1.0.0\"}";
            }
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String apkUrl, String fileName) {
            if ("downloading".equals(updateStatus)) {
                return;
            }
            if (apkUrl == null || !(apkUrl.startsWith("https://") || apkUrl.startsWith("http://"))) {
                updateStatus = "error";
                updateError = "Invalid APK URL";
                return;
            }
            updateStatus = "downloading";
            updateProgress = 0;
            updateDownloaded = 0;
            updateTotal = 0;
            updateError = "";
            downloadedApkFile = null;

            final String safeName = (fileName != null && !fileName.trim().isEmpty())
                ? fileName.replaceAll("[^a-zA-Z0-9._-]", "_")
                : "DSchat-update.apk";

            Thread downloadThread = new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    File updateDir = new File(getCacheDir(), "updates");
                    if (!updateDir.exists()) {
                        updateDir.mkdirs();
                    }
                    File tempFile = new File(updateDir, safeName + ".part");
                    File finalFile = new File(updateDir, safeName);

                    URL currentUrl = new URL(apkUrl);
                    int redirects = 0;
                    while (true) {
                        conn = (HttpURLConnection) currentUrl.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(60000);
                        conn.setRequestProperty("User-Agent", "DSchat-Android");
                        int code = conn.getResponseCode();
                        if (code >= 300 && code < 400 && redirects < 8) {
                            String loc = conn.getHeaderField("Location");
                            conn.disconnect();
                            if (loc == null || loc.isEmpty()) {
                                throw new IOException("Redirect without location");
                            }
                            currentUrl = new URL(currentUrl, loc);
                            redirects++;
                            continue;
                        }
                        if (code < 200 || code >= 300) {
                            throw new IOException("HTTP " + code);
                        }
                        break;
                    }

                    long total = conn.getContentLengthLong();
                    updateTotal = Math.max(0, total);
                    try (
                        InputStream in = new BufferedInputStream(conn.getInputStream());
                        FileOutputStream fileOut = new FileOutputStream(tempFile)
                    ) {
                        byte[] buf = new byte[16384];
                        long downloaded = 0;
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            fileOut.write(buf, 0, n);
                            downloaded += n;
                            updateDownloaded = downloaded;
                            if (total > 0) {
                                updateProgress = (int) Math.min(100, (downloaded * 100L) / total);
                            }
                        }
                        fileOut.flush();
                    }
                    if (finalFile.exists()) {
                        finalFile.delete();
                    }
                    if (!tempFile.renameTo(finalFile)) {
                        throw new IOException("Failed to prepare APK file");
                    }
                    downloadedApkFile = finalFile;
                    updateProgress = 100;
                    runOnUiThread(() -> triggerApkInstall(finalFile));
                } catch (Exception e) {
                    updateStatus = "error";
                    updateError = e.getMessage() != null ? e.getMessage() : "Download failed";
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }, "DSchatApkDownloader");
            downloadThread.setDaemon(true);
            downloadThread.start();
        }

        @JavascriptInterface
        public String getUpdateDownloadState() {
            return "{\"status\":\"" + escapeJson(updateStatus) + "\""
                + ",\"progress\":" + updateProgress
                + ",\"downloaded\":" + updateDownloaded
                + ",\"total\":" + updateTotal
                + ",\"error\":\"" + escapeJson(updateError) + "\""
                + ",\"hasDownloadedFile\":" + (downloadedApkFile != null && downloadedApkFile.exists())
                + "}";
        }

        @JavascriptInterface
        public void retryInstallDownloadedApk() {
            final File file = downloadedApkFile;
            if (file != null && file.exists()) {
                runOnUiThread(() -> triggerApkInstall(file));
            }
        }
    }

    private void triggerApkInstall(File apkFile) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                updateStatus = "permission_required";
                Intent permIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(permIntent);
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            updateStatus = "installing";
            startActivity(installIntent);
        } catch (Exception e) {
            updateStatus = "error";
            updateError = e.getMessage() != null ? e.getMessage() : "Install failed";
        }
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", " ")
            .replace("\n", " ");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        startLocalProxy();
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new ProxyBridge(), "__DEEPCHAT_ANDROID_BRIDGE__");
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    /**
     * 返回键先交给前端处理（关弹窗 / 关抽屉 / 退出图片查看 / 回到会话列表），
     * 前端返回 false 时才交给系统默认行为，避免在任意界面按返回就直接退出应用。
     */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return window.__DSCHAT_HANDLE_BACK__ ? window.__DSCHAT_HANDLE_BACK__() : false}catch(e){return false}})()",
            value -> {
                if (!"true".equals(value)) {
                    runOnUiThread(() -> {
                        if (!isFinishing()) {
                            moveTaskToBack(true);
                        }
                    });
                }
            }
        );
    }

    @Override
    public void onDestroy() {
        stopLocalProxy();
        super.onDestroy();
    }

    private void startLocalProxy() {
        try {
            ServerSocket server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            proxyServer = server;
            proxyPort = server.getLocalPort();
            proxyPool = Executors.newCachedThreadPool();
            Thread acceptThread = new Thread(() -> {
                while (!server.isClosed()) {
                    try {
                        Socket client = server.accept();
                        proxyPool.submit(() -> handleClient(client));
                    } catch (IOException ignored) {
                        break;
                    }
                }
            }, "DSchatLocalProxy");
            acceptThread.setDaemon(true);
            acceptThread.start();
        } catch (IOException ignored) {
            proxyPort = -1;
        }
    }

    private void stopLocalProxy() {
        try {
            if (proxyServer != null) {
                proxyServer.close();
            }
        } catch (IOException ignored) {
        }
        if (proxyPool != null) {
            proxyPool.shutdownNow();
        }
    }

    private void handleClient(Socket client) {
        try (Socket socket = client) {
            socket.setSoTimeout(30000);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = socket.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0].toUpperCase(Locale.ROOT) : "GET";

            Map<String, String> headers = new LinkedHashMap<>();
            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String name = line.substring(0, colon).trim();
                    String value = line.substring(colon + 1).trim();
                    headers.put(name, value);
                    if ("content-length".equalsIgnoreCase(name)) {
                        try {
                            contentLength = Math.max(0, Integer.parseInt(value));
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }

            if ("OPTIONS".equals(method)) {
                String cors = "HTTP/1.1 204 No Content\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: *\r\n"
                    + "Access-Control-Expose-Headers: *\r\n"
                    + "Access-Control-Max-Age: 86400\r\n"
                    + "x-local-proxy: 1\r\n"
                    + "Connection: close\r\n\r\n";
                out.write(cors.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                return;
            }

            byte[] body = new byte[contentLength];
            int offset = 0;
            while (offset < contentLength) {
                int read = in.read(body, offset, contentLength - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
            if (offset < contentLength) {
                body = Arrays.copyOf(body, offset);
            }

            String targetUrl = null;
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if ("x-proxy-target".equalsIgnoreCase(entry.getKey())) {
                    targetUrl = entry.getValue();
                    break;
                }
            }
            if (targetUrl == null || !(targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
                sendJsonError(out, 400, "Missing or invalid x-proxy-target header");
                return;
            }

            HttpURLConnection conn = (HttpURLConnection) new URL(targetUrl).openConnection();
            conn.setRequestMethod(method);
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.setRequestProperty("Accept-Encoding", "identity");

            for (Map.Entry<String, String> entry : headers.entrySet()) {
                String keyLower = entry.getKey().toLowerCase(Locale.ROOT);
                if (!HOP_BY_HOP.contains(keyLower)) {
                    conn.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }

            if (body.length > 0) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(body.length);
                try (OutputStream reqOut = conn.getOutputStream()) {
                    reqOut.write(body);
                    reqOut.flush();
                }
            }

            int status = conn.getResponseCode();
            String reason = conn.getResponseMessage();
            if (reason == null || reason.isEmpty()) {
                reason = "OK";
            }

            boolean noBody = "HEAD".equals(method) || status == 204 || status == 304 || (status >= 100 && status < 200);
            StringBuilder respHeaders = new StringBuilder();
            respHeaders.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
            respHeaders.append("Access-Control-Allow-Origin: *\r\n");
            respHeaders.append("Access-Control-Expose-Headers: *\r\n");
            respHeaders.append("x-local-proxy: 1\r\n");
            respHeaders.append("Connection: close\r\n");

            for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                String key = entry.getKey();
                if (key == null) {
                    continue;
                }
                String lower = key.toLowerCase(Locale.ROOT);
                if (
                    "transfer-encoding".equals(lower)
                    || "content-length".equals(lower)
                    || "content-encoding".equals(lower)
                    || "connection".equals(lower)
                    || lower.startsWith("access-control-")
                ) {
                    continue;
                }
                for (String value : entry.getValue()) {
                    respHeaders.append(key).append(": ").append(value).append("\r\n");
                }
            }
            if (!noBody) {
                respHeaders.append("Transfer-Encoding: chunked\r\n");
            }
            respHeaders.append("\r\n");
            out.write(respHeaders.toString().getBytes(StandardCharsets.ISO_8859_1));
            out.flush();

            if (!noBody) {
                InputStream upstream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (upstream == null && status < 400) {
                    upstream = conn.getErrorStream();
                }
                if (upstream != null) {
                    try (InputStream stream = upstream) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = stream.read(buf)) != -1) {
                            if (n > 0) {
                                out.write((Integer.toHexString(n) + "\r\n").getBytes(StandardCharsets.US_ASCII));
                                out.write(buf, 0, n);
                                out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                                out.flush();
                            }
                        }
                    }
                }
                out.write("0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
            }
        } catch (Exception e) {
            try {
                sendJsonError(client.getOutputStream(), 502, e.getMessage() != null ? e.getMessage() : "Proxy failed");
            } catch (IOException ignored) {
            }
        }
    }

    private static String readLine(BufferedInputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') {
                break;
            }
            if (b != '\r') {
                buf.write(b);
            }
        }
        if (b == -1 && buf.size() == 0) {
            return null;
        }
        return buf.toString(StandardCharsets.ISO_8859_1.name());
    }

    private static void sendJsonError(OutputStream out, int status, String message) throws IOException {
        String safeMsg = message.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
        byte[] payload = ("{\"error\":{\"message\":\"" + safeMsg + "\"}}").getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 " + status + " Error\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + payload.length + "\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Expose-Headers: *\r\n"
            + "x-local-proxy: 1\r\n"
            + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.ISO_8859_1));
        out.write(payload);
        out.flush();
    }
}
