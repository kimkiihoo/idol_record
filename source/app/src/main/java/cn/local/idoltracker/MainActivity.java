package cn.local.idoltracker;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.AtomicFile;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Offline UI. Only packaged assets are reachable from the bridge-enabled WebView. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://idol.local";
    private static final int MAX_BYTES = 10 * 1024 * 1024;
    private static final int IMPORT_REQUEST = 101;
    private static final int EXPORT_REQUEST = 102;
    private static final Set<String> IMAGE_FIELDS = new HashSet<>(Arrays.asList(
        "image", "image_name", "photo", "photo_name", "images", "photos", "image_files",
        "image_data", "photo_data", "image_url", "photo_url", "image_path", "photo_path"));
    private static final Pattern IMAGE_DATA = Pattern.compile(
        "^[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*data:image/", Pattern.CASE_INSENSITIVE);
    private final Object storageLock = new Object();
    private final ArrayList<String> pendingCallbacks = new ArrayList<>();
    private WebView webView;
    private boolean pageReady;
    private boolean chooserPending;
    private AtomicFile stateFile;
    private AtomicFile previousFile;
    private AtomicFile exportFile;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        stateFile = new AtomicFile(new File(getFilesDir(), "state.json"));
        previousFile = new AtomicFile(new File(getFilesDir(), "previous-state.json"));
        exportFile = new AtomicFile(new File(getFilesDir(), "pending-export.json"));
        // Upgrade only app-owned JSON files. External backups and desktop data stay untouched.
        cleanStoredFile(stateFile, true);
        cleanStoredFile(previousFile, true);
        cleanStoredFile(exportFile, false);
        chooserPending = savedInstanceState != null && savedInstanceState.getBoolean("chooserPending");
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(255,249,245));
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1,-1));
        // Android 15 enforces edge-to-edge. Keep system bars and keyboard outside the form.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isEntry(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isEntry(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetResponse(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!isEntry(Uri.parse(url))) return;
                pageReady = true;
                for (String callback : new ArrayList<>(pendingCallbacks)) view.evaluateJavascript(callback, null);
                pendingCallbacks.clear();
            }
        });
        webView.loadUrl(ORIGIN + "/index.html");
    }

    private boolean isEntry(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && "idol.local".equals(uri.getHost())
            && uri.getPort() == -1 && ("/".equals(path) || "/index.html".equals(path));
    }

    private WebResourceResponse assetResponse(Uri uri) {
        try {
            String path = uri.getPath();
            if (!"https".equals(uri.getScheme()) || !"idol.local".equals(uri.getHost()) || uri.getPort() != -1
                || path == null || path.contains("..") || path.contains("\\") || path.contains("\0")) return denied();
            if ("/".equals(path)) path = "/index.html";
            String type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" :
                path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" :
                path.endsWith(".png") ? "image/png" : path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                + "img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            return new WebResourceResponse(type, "UTF-8", 200, "OK", headers, getAssets().open("www" + path));
        } catch (IOException error) { return denied(); }
    }

    private WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<>(),
            new ByteArrayInputStream(new byte[0]));
    }

    private static String readUtf8(InputStream stream) throws IOException {
        if (stream == null) throw new IOException("无法打开文件");
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_BYTES) throw new IOException("文件超过 10 MB，无法读取");
                output.write(buffer, 0, count);
            }
            try {
                String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
                return text.startsWith("\uFEFF") ? text.substring(1) : text;
            } catch (CharacterCodingException error) { throw new IOException("请选择 UTF-8 编码的 JSON 文件"); }
        }
    }

    private static void writeAtomic(AtomicFile target, byte[] payload) throws IOException {
        FileOutputStream output = null;
        try {
            output = target.startWrite();
            output.write(payload);
            target.finishWrite(output);
        } catch (IOException error) {
            target.failWrite(output);
            throw error;
        }
    }

    private static boolean existsAtomic(AtomicFile file) {
        return file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists();
    }

    private static boolean imageData(Object value) {
        return value instanceof String && IMAGE_DATA.matcher((String) value).find();
    }

    private static void removeImages(Object value, JSONObject rootAssets, boolean[] changed, int depth) throws Exception {
        if (depth > 80) throw new IOException("数据嵌套过深");
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = array.length() - 1; index >= 0; index--) {
                Object child = array.get(index);
                if (imageData(child)) { array.remove(index); changed[0] = true; }
                else removeImages(child, rootAssets, changed, depth + 1);
            }
        } else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            ArrayList<String> keys = new ArrayList<>();
            object.keys().forEachRemaining(keys::add);
            for (String key : keys) {
                Object child = object.get(key);
                // Keep the existing empty schema-2 compatibility container without rewriting it.
                if (object == rootAssets && "images".equals(key) && child instanceof JSONObject
                    && ((JSONObject) child).length() == 0) continue;
                if (IMAGE_FIELDS.contains(key.toLowerCase(Locale.ROOT)) || imageData(child)) {
                    object.remove(key);
                    changed[0] = true;
                } else removeImages(child, rootAssets, changed, depth + 1);
            }
        }
    }

    private static byte[] jsonBytes(String json, boolean requireState) throws Exception {
        if (json == null) throw new IOException("数据为空");
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_BYTES) throw new IOException("数据超过 10 MB");
        String value = json.trim();
        Object parsed;
        if (value.startsWith("{")) {
            JSONObject object = new JSONObject(value);
            if (requireState && !(object.opt("records") instanceof JSONArray)) throw new IOException("记录格式不正确");
            parsed = object;
        } else if (!requireState && value.startsWith("[")) { parsed = new JSONArray(value); }
        else throw new IOException("不是有效的 JSON 备份");
        JSONObject rootAssets = parsed instanceof JSONObject ? ((JSONObject) parsed).optJSONObject("assets") : null;
        boolean[] changed = {false};
        removeImages(parsed, rootAssets, changed, 0);
        if (rootAssets != null && !rootAssets.has("images")) {
            rootAssets.put("images", new JSONObject());
            changed[0] = true;
        }
        return changed[0] ? parsed.toString().getBytes(StandardCharsets.UTF_8) : payload;
    }

    private void cleanStoredFile(AtomicFile file, boolean requireState) {
        if (!existsAtomic(file)) return;
        synchronized (storageLock) {
            try {
                String original = readUtf8(file.openRead());
                byte[] clean = jsonBytes(original, requireState);
                if (!original.equals(new String(clean, StandardCharsets.UTF_8))) writeAtomic(file, clean);
            } catch (Exception ignored) {
                // Preserve damaged originals for the existing recovery path; never clear the ledger.
            }
        }
    }

    private static String result(boolean ok, String error) {
        try { return new JSONObject().put("ok", ok).put("error", error == null ? "" : error).toString(); }
        catch (JSONException ignored) { return "{\"ok\":false,\"error\":\"操作失败\"}"; }
    }

    private void callback(String script) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (pageReady) webView.evaluateJavascript(script, null); else pendingCallbacks.add(script);
        });
    }

    private void notice(String message, boolean success) {
        callback("if(window.onNativeNotice)window.onNativeNotice(" + JSONObject.quote(message) + "," + success + ");");
    }

    public final class Bridge {
        @JavascriptInterface public String readState() {
            synchronized (storageLock) {
                if (!existsAtomic(stateFile)) return existsAtomic(previousFile)
                    ? "{\"__storageError\":\"主数据缺失，请从上一次保存的数据或外部备份恢复\"}" : "";
                try {
                    String state = readUtf8(stateFile.openRead());
                    jsonBytes(state, true);
                    return state;
                } catch (Exception error) {
                    // Nonempty sentinel prevents a damaged database from becoming a fresh installation.
                    try { return new JSONObject().put("__storageError", "本机数据读取失败，请从备份恢复：" + error.getMessage()).toString(); }
                    catch (JSONException ignored) { return "{\"__storageError\":\"本机数据读取失败\"}"; }
                }
            }
        }

        @JavascriptInterface public String readPreviousState() {
            synchronized (storageLock) {
                if (!existsAtomic(previousFile)) return "";
                try { return readUtf8(previousFile.openRead()); }
                catch (Exception error) { notice("无法读取上一次保存的数据：" + error.getMessage(), false); return ""; }
            }
        }

        @JavascriptInterface public String writeState(String json) {
            synchronized (storageLock) {
                try {
                    byte[] payload = jsonBytes(json, true);
                    if (existsAtomic(stateFile)) {
                        String old = null;
                        try { old = readUtf8(stateFile.openRead()); jsonBytes(old, true); }
                        catch (Exception invalidOld) { old = null; }
                        if (old != null) writeAtomic(previousFile, jsonBytes(old, true));
                        else {
                            // Preserve damaged bytes separately; never replace the last known previous copy with them.
                            java.nio.file.Files.copy(stateFile.getBaseFile().toPath(),
                                new File(getFilesDir(), "damaged-state-" + System.currentTimeMillis() + ".json").toPath());
                        }
                    }
                    writeAtomic(stateFile, payload);
                    return result(true, null);
                } catch (Exception error) { return result(false, "保存失败：" + error.getMessage()); }
            }
        }

        @JavascriptInterface public String getSeed() {
            try { return readUtf8(getAssets().open("seed-backup.json")); }
            catch (IOException error) {
                notice("内置迁移数据读取失败：" + error.getMessage(), false);
                return "";
            }
        }

        @JavascriptInterface public void exportBackup(String json) {
            final byte[] payload;
            final boolean desktopRecords = json != null && json.trim().startsWith("[");
            try { payload = jsonBytes(json, false); }
            catch (Exception error) { notice("无法导出：" + error.getMessage(), false); return; }
            runOnUiThread(() -> {
                if (chooserPending) { notice("请先完成当前文件选择", false); return; }
                try {
                    synchronized (storageLock) { writeAtomic(exportFile, payload); }
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, desktopRecords ? "records.json" : "偶像活动备份-"
                        + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()) + ".json");
                    chooserPending = true;
                    startActivityForResult(intent, EXPORT_REQUEST);
                } catch (Exception error) {
                    chooserPending = false;
                    exportFile.delete();
                    notice("无法打开保存位置：" + error.getMessage(), false);
                }
            });
        }

        @JavascriptInterface public void importBackup() {
            runOnUiThread(() -> {
                if (chooserPending) { notice("请先完成当前文件选择", false); return; }
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                    chooserPending = true;
                    startActivityForResult(intent, IMPORT_REQUEST);
                } catch (ActivityNotFoundException error) {
                    chooserPending = false;
                    notice("系统未提供文件选择器", false);
                }
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != IMPORT_REQUEST && requestCode != EXPORT_REQUEST) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            chooserPending = false;
            if (requestCode == EXPORT_REQUEST) exportFile.delete();
            notice(requestCode == EXPORT_REQUEST ? "已取消导出" : "已取消导入", false);
            return;
        }
        final Uri uri = data.getData();
        new Thread(() -> {
            try {
                if (requestCode == IMPORT_REQUEST) {
                    String content = new String(jsonBytes(readUtf8(getContentResolver().openInputStream(uri)), false), StandardCharsets.UTF_8);
                    callback("if(window.onNativeImport)window.onNativeImport(" + JSONObject.quote(content) + ");");
                } else {
                    byte[] payload;
                    synchronized (storageLock) { payload = jsonBytes(readUtf8(exportFile.openRead()), false); }
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("无法打开目标文件");
                        output.write(payload);
                        output.flush();
                    }
                    synchronized (storageLock) { exportFile.delete(); }
                    notice("备份已导出", true);
                }
            } catch (Exception error) {
                notice((requestCode == IMPORT_REQUEST ? "导入失败：" : "导出失败：") + error.getMessage(), false);
            } finally {
                runOnUiThread(() -> chooserPending = false);
            }
        }, "backup-file-io").start();
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean("chooserPending", chooserPending);
        super.onSaveInstanceState(outState);
    }

    @Override public void onBackPressed() {
        if (!pageReady) { super.onBackPressed(); return; }
        webView.evaluateJavascript("typeof window.onNativeBack==='function' ? !!window.onNativeBack() : false", value -> {
            if (!"true".equals(value)) new AlertDialog.Builder(this).setMessage("退出偶像活动手账？已保存的数据会保留。")
                .setNegativeButton("继续使用", null).setPositiveButton("退出", (dialog, which) -> finish()).show();
        });
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        super.onDestroy();
    }
}
