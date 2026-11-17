package com.dschat.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
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
import java.util.ArrayList;
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
    /** 取消标记：前端点「取消下载」时置位，下载线程每轮检查后中止 */
    private volatile boolean updateCancelled = false;
    private volatile Thread downloadThread = null;
    /** 缓存目录里已有的完整安装包是否已经扫过盘（进程重启后要认回来，避免重复下载） */
    private volatile boolean restoredDownload = false;
    /** 已下载完成、等待安装的包名，供前端判断能否直接安装 */
    private volatile String downloadedApkName = "";

    /**
     * 进程被杀掉再进来时，内存里的 downloadedApkFile 会丢，
     * 但缓存目录里的安装包还在。这里把它认回来，前端就不会又下一次。
     */
    private void restoreDownloadedApkIfNeeded() {
        if (restoredDownload) {
            return;
        }
        restoredDownload = true;
        try {
            File updateDir = new File(getCacheDir(), "updates");
            if (!updateDir.exists()) {
                return;
            }
            File[] files = updateDir.listFiles();
            if (files == null) {
                return;
            }
            File newest = null;
            for (File file : files) {
                if (!file.isFile() || !file.getName().toLowerCase(Locale.US).endsWith(".apk")) {
                    continue;
                }
                // 空文件或明显不完整的不算
                if (file.length() < 1024 * 1024) {
                    continue;
                }
                if (newest == null || file.lastModified() > newest.lastModified()) {
                    newest = file;
                }
            }
            if (newest != null) {
                downloadedApkFile = newest;
                downloadedApkName = newest.getName();
                updateStatus = "idle";
                updateProgress = 100;
                updateDownloaded = newest.length();
                updateTotal = newest.length();
            }
        } catch (Exception ignored) {
        }
    }

    /** 清掉缓存目录里所有安装包（装完或用户明确不要了） */
    private void clearDownloadedApks() {
        try {
            File updateDir = new File(getCacheDir(), "updates");
            File[] files = updateDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    // 保留 .part，那是没下完的，还能续传
                    if (file.isFile() && file.getName().toLowerCase(Locale.US).endsWith(".apk")) {
                        file.delete();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        downloadedApkFile = null;
        downloadedApkName = "";
    }

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
        public void downloadAndInstallApk(String apkUrl, String fileName, String mirrorsJson) {
            if ("downloading".equals(updateStatus)) {
                return;
            }
            if (apkUrl == null || !(apkUrl.startsWith("https://") || apkUrl.startsWith("http://"))) {
                updateStatus = "error";
                updateError = "Invalid APK URL";
                return;
            }

            final String safeName = (fileName != null && !fileName.trim().isEmpty())
                ? fileName.replaceAll("[^a-zA-Z0-9._-]", "_")
                : "DSchat-update.apk";

            File updateDir = new File(getCacheDir(), "updates");
            if (!updateDir.exists()) {
                updateDir.mkdirs();
            }
            final File tempFile = new File(updateDir, safeName + ".part");
            final File finalFile = new File(updateDir, safeName);

            // 已经下好了同一个包：直接装，不再重下（退出应用再进来会走到这里）
            restoreDownloadedApkIfNeeded();
            if (finalFile.exists() && finalFile.length() > 1024 * 1024) {
                downloadedApkFile = finalFile;
                downloadedApkName = safeName;
                updateStatus = "idle";
                updateProgress = 100;
                updateDownloaded = finalFile.length();
                updateTotal = finalFile.length();
                updateError = "";
                runOnUiThread(() -> triggerApkInstall(finalFile));
                return;
            }

            updateCancelled = false;
            updateStatus = "downloading";
            updateProgress = 0;
            updateDownloaded = tempFile.exists() ? tempFile.length() : 0;
            updateTotal = 0;
            updateError = "";
            downloadedApkFile = null;

            downloadThread = new Thread(() -> {
                // 直连失败时依次换镜像：国内网络直连 release-assets 常被阻断。
                // 直连放最后，镜像优先，这样国内不会先卡在必然失败的直连上。
                List<String> candidates = new ArrayList<>();
                if (mirrorsJson != null && !mirrorsJson.isEmpty()) {
                    try {
                        JSONArray array = new JSONArray(mirrorsJson);
                        for (int i = 0; i < array.length(); i++) {
                            String mirror = array.optString(i, "");
                            if (!mirror.isEmpty()) {
                                candidates.add(mirror);
                            }
                        }
                    } catch (Exception ignored) {
                    }
                }
                candidates.add(apkUrl);

                String lastError = "";
                for (String candidate : candidates) {
                    if (updateCancelled) {
                        break;
                    }
                    HttpURLConnection conn = null;
                    try {
                        URL currentUrl = new URL(candidate);
                        int redirects = 0;
                        while (true) {
                            conn = (HttpURLConnection) currentUrl.openConnection();
                            conn.setInstanceFollowRedirects(false);
                            // 连接超时压短：镜像不通时尽快换下一个，而不是干等
                            conn.setConnectTimeout(6000);
                            conn.setReadTimeout(30000);
                            conn.setRequestProperty("User-Agent", "DSchat-Android");
                            // 断点续传：有残留 .part 就接着要
                            long existing = tempFile.exists() ? tempFile.length() : 0;
                            if (existing > 0) {
                                conn.setRequestProperty("Range", "bytes=" + existing + "-");
                            }
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
                            if (code == 416) {
                                // 残留比远端还长，说明这个 .part 是坏的，重头来
                                if (tempFile.exists()) {
                                    tempFile.delete();
                                }
                                conn.disconnect();
                                throw new IOException("HTTP 416");
                            }
                            if (code < 200 || code >= 300) {
                                throw new IOException("HTTP " + code);
                            }
                            break;
                        }

                        boolean resumed = tempFile.exists() && tempFile.length() > 0;
                        long existing = resumed ? tempFile.length() : 0;
                        long total = conn.getContentLengthLong();
                        updateTotal = total > 0 ? total + existing : 0;
                        try (
                            InputStream in = new BufferedInputStream(conn.getInputStream());
                            FileOutputStream fileOut = new FileOutputStream(tempFile, resumed)
                        ) {
                            byte[] buf = new byte[16384];
                            long downloaded = existing;
                            int n;
                            while ((n = in.read(buf)) != -1) {
                                if (updateCancelled) {
                                    throw new IOException("cancelled");
                                }
                                fileOut.write(buf, 0, n);
                                downloaded += n;
                                updateDownloaded = downloaded;
                                if (updateTotal > 0) {
                                    updateProgress = (int) Math.min(100, (downloaded * 100L) / updateTotal);
                                }
                            }
                            fileOut.flush();
                        }
                        // APK 是 zip，必须以 PK\x03\x04 开头。部分镜像挂掉时会返回
                        // 200 + 广告跳转页，旧版把它当成安装包存下来，安装必失败还占着缓存。
                        // 校验魔数，不对就当这次下载失败，换下一个镜像。
                        if (!looksLikeApk(tempFile)) {
                            tempFile.delete();
                            throw new IOException("Not a valid APK payload");
                        }
                        if (finalFile.exists()) {
                            finalFile.delete();
                        }
                        if (!tempFile.renameTo(finalFile)) {
                            throw new IOException("Failed to prepare APK file");
                        }
                        downloadedApkFile = finalFile;
                        downloadedApkName = safeName;
                        updateProgress = 100;
                        updateStatus = "downloading";
                        runOnUiThread(() -> triggerApkInstall(finalFile));
                        return;
                    } catch (Exception e) {
                        if (updateCancelled) {
                            lastError = "";
                            break;
                        }
                        lastError = e.getMessage() != null ? e.getMessage() : "Download failed";
                        // 保留 .part 以便换镜像后续传；内容不可用（垃圾页/空文件）时清掉
                        if (tempFile.exists()) {
                            long len = tempFile.length();
                            if (len == 0 || !looksLikeApk(tempFile)) {
                                tempFile.delete();
                            }
                        }
                        updateProgress = 0;
                    } finally {
                        if (conn != null) {
                            conn.disconnect();
                        }
                    }
                }
                if (updateCancelled) {
                    updateStatus = "idle";
                    updateError = "";
                } else {
                    updateStatus = "error";
                    updateError = lastError.isEmpty() ? "Download failed" : lastError;
                }
            }, "DSchatApkDownloader");
            downloadThread.setDaemon(true);
            downloadThread.start();
        }

        @JavascriptInterface
        public String getUpdateDownloadState() {
            restoreDownloadedApkIfNeeded();
            return "{\"status\":\"" + escapeJson(updateStatus) + "\""
                + ",\"progress\":" + updateProgress
                + ",\"downloaded\":" + updateDownloaded
                + ",\"total\":" + updateTotal
                + ",\"error\":\"" + escapeJson(updateError) + "\""
                + ",\"apkName\":\"" + escapeJson(downloadedApkName) + "\""
                + ",\"hasDownloadedFile\":" + (downloadedApkFile != null && downloadedApkFile.exists())
                + "}";
        }

        /** 检查文件开头是不是 APK/zip 的魔数 PK\x03\x04，挡住镜像返回的广告页 */
        private static boolean looksLikeApk(File file) {
            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(file, "r")) {
                if (raf.length() < 4) {
                    return false;
                }
                return raf.read() == 0x50 && raf.read() == 0x4B
                    && raf.read() == 0x03 && raf.read() == 0x04;
            } catch (Exception e) {
                return false;
            }
        }

        /** 已经下好、直接装（不再重下） */
        @JavascriptInterface
        public boolean installDownloadedApk() {
            restoreDownloadedApkIfNeeded();
            final File file = downloadedApkFile;
            if (file == null || !file.exists()) {
                return false;
            }
            runOnUiThread(() -> triggerApkInstall(file));
            return true;
        }

        /** 丢掉已下载的包，下次重新下（安装包损坏时用） */
        @JavascriptInterface
        public void discardDownloadedApk() {
            updateCancelled = true;
            Thread t = downloadThread;
            if (t != null) {
                t.interrupt();
            }
            File updateDir = new File(getCacheDir(), "updates");
            File[] files = updateDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isFile()) {
                        file.delete();
                    }
                }
            }
            downloadedApkFile = null;
            downloadedApkName = "";
            updateStatus = "idle";
            updateProgress = 0;
            updateDownloaded = 0;
            updateTotal = 0;
            updateError = "";
        }

        @JavascriptInterface
        public void cancelUpdateDownload() {
            updateCancelled = true;
            Thread t = downloadThread;
            if (t != null) {
                t.interrupt();
            }
            updateStatus = "idle";
            updateProgress = 0;
            updateDownloaded = 0;
            updateTotal = 0;
            updateError = "";
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
        handleOAuthIntent(getIntent());
    }

    /**
     * DeepSeek 账号登录回调：浏览器授权后跳回 dschat://oauth/callback?code=...，
     * 这里把完整地址交给前端去换 token。
     */
    private void handleOAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) {
            return;
        }
        Uri data = intent.getData();
        if (!"dschat".equals(data.getScheme()) || !"oauth".equals(data.getHost())) {
            return;
        }
        final String url = data.toString();
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            return;
        }
        webView.post(() -> webView.evaluateJavascript(
            "(function(){try{window.__DSCHAT_OAUTH_CALLBACK__ && window.__DSCHAT_OAUTH_CALLBACK__("
                + jsString(url) + ")}catch(e){}})()",
            null
        ));
    }

    /** 把 Java 字符串转成 JS 字符串字面量 */
    private static String jsString(String value) {
        StringBuilder out = new StringBuilder("'");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '\'': out.append("\\'"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                default: out.append(c);
            }
        }
        return out.append("'").toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
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

            // DeepSeek 账号登录回调（OAUTH_CALLBACK_ROUTE）：
            // 平台只接受 loopback HTTP 回调地址，所以由本地代理接住 /oauth/callback，
            // 把 query 转给前端，然后返回一个简单的完成页。
            if (parts.length >= 2 && parts[1].startsWith("/oauth/callback")) {
                int q = parts[1].indexOf('?');
                final String query = q >= 0 ? parts[1].substring(q + 1) : "";
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && !query.isEmpty()) {
                    final String jsUrl = "dschat://oauth/callback?" + query;
                    webView.post(() -> webView.evaluateJavascript(
                        "(function(){try{window.__DSCHAT_OAUTH_CALLBACK__ && window.__DSCHAT_OAUTH_CALLBACK__("
                            + jsString(jsUrl) + ")}catch(e){}})()",
                        null
                    ));
                }
                byte[] page = ("<!doctype html><meta charset=utf-8><title>DSchat</title>"
                    + "<body style=\"font-family:sans-serif;padding:32px;text-align:center\">"
                    + "<h3>\u6388\u6743\u5b8c\u6210</h3>"
                    + "<p>\u8bf7\u56de\u5230 DSchat\uff0c\u767b\u5f55\u4f1a\u81ea\u52a8\u7ee7\u7eed\u3002</p></body>")
                    .getBytes(StandardCharsets.UTF_8);
                String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: text/html; charset=utf-8\r\n"
                    + "Content-Length: " + page.length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.ISO_8859_1));
                out.write(page);
                out.flush();
                return;
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
