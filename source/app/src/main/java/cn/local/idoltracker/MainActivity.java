package cn.local.idoltracker;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.util.Base64;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private static final int IMPORT_REQUEST = 101;
    private static final int EXPORT_REQUEST = 102;
    private static final int AVATAR_REQUEST = 103;
    private static final int PHOTO_REQUEST = 104;
    private static final int SAVE_PHOTO_REQUEST = 105;
    private String photoToken = "";
    private String avatarToken = "";
    private byte[] pendingSaveBytes;
    private String pendingSaveMime = "";
    private static final Set<String> IMAGE_FIELDS = new HashSet<>(Arrays.asList(
        "image", "image_name", "photo", "photo_name", "images", "photos", "image_files",
        "image_data", "photo_data", "image_url", "photo_url", "image_path", "photo_path"));
    private static final Pattern IMAGE_DATA = Pattern.compile(
        "^[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*data:image/", Pattern.CASE_INSENSITIVE);
    private final Object storageLock = new Object();
    private final ArrayList<String> pendingCallbacks = new ArrayList<>();
    private WebView webView;
    private BackupArchive media;
    private boolean pageReady;
    private boolean chooserPending;
    private AtomicFile stateFile;
    private AtomicFile previousFile;
    private AtomicFile exportFile;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try { media=new BackupArchive(getFilesDir()); } catch(IOException error) { throw new IllegalStateException("无法初始化照片存储",error); }
        stateFile = new AtomicFile(new File(getFilesDir(), "state.json"));
        previousFile = new AtomicFile(new File(getFilesDir(), "previous-state.json"));
        exportFile = new AtomicFile(new File(getFilesDir(), "pending-export.json"));
        // Upgrade only app-owned JSON files. External backups and desktop data stay untouched.
        cleanStoredFile(stateFile, true);
        cleanStoredFile(previousFile, true);
        cleanStoredFile(exportFile, false);
        chooserPending = savedInstanceState != null && savedInstanceState.getBoolean("chooserPending");
        if (savedInstanceState != null) {avatarToken = savedInstanceState.getString("avatarToken", "");photoToken=savedInstanceState.getString("photoToken", "");}
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
            if(path.startsWith("/photos/")){String photoUrl=ORIGIN+path;if(!BackupArchive.isPhotoUrl(photoUrl))return denied();String mime=path.endsWith(".png")?"image/png":path.endsWith(".webp")?"image/webp":"image/jpeg";return new WebResourceResponse(mime,null,media.open(photoUrl));}
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
                if (output.size() + count > MAX_BYTES) throw new IOException("文件超过 50 MB，无法读取");
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
                if ("attachments".equals(key)) { validatePhotos(child); continue; }
                if ("avatar".equals(key) && child instanceof String && ((String) child).length() <= 250000
                    && ((String) child).matches("data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}")) continue;
                if (IMAGE_FIELDS.contains(key.toLowerCase(Locale.ROOT)) || imageData(child)) {
                    object.remove(key);
                    changed[0] = true;
                } else removeImages(child, rootAssets, changed, depth + 1);
            }
        }
    }

    private static void validatePhotos(Object value) throws Exception {
        if (!(value instanceof JSONArray) || ((JSONArray)value).length() > 20) throw new IOException("照片列表无效");
        Set<String> ids = new HashSet<>();
        JSONArray photos=(JSONArray)value;
        for(int index=0;index<photos.length();index++){
            JSONObject photo=photos.getJSONObject(index);
            String id=photo.optString("id", ""),data=photo.optString("data", "");
            if(id.isEmpty()||id.length()>300||!ids.add(id)||data.length()>700000||!(data.matches("data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}")||BackupArchive.isPhotoUrl(data))||photo.optString("caption", "").length()>500)throw new IOException("照片内容无效");
        }
    }

    private static byte[] jsonBytes(String json, boolean requireState) throws Exception {
        if (json == null) throw new IOException("数据为空");
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_BYTES) throw new IOException("数据超过 50 MB");
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
                byte[] clean = jsonBytes(media.externalize(original), requireState);
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
                    byte[] payload = jsonBytes(media.externalize(json), true);
                    media.commitStaged(new String(payload,StandardCharsets.UTF_8));
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
                    JSONObject response=new JSONObject();response.put("ok",true);response.put("state",new JSONObject(new String(payload,StandardCharsets.UTF_8)));return response.toString();
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
            try { payload = jsonBytes(media.externalize(json), false); }
            catch (Exception error) { notice("无法导出：" + error.getMessage(), false); return; }
            runOnUiThread(() -> {
                if (chooserPending) { notice("请先完成当前文件选择", false); return; }
                try {
                    synchronized (storageLock) { writeAtomic(exportFile, payload); }
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(desktopRecords?"application/json":"application/zip");
                    intent.putExtra(Intent.EXTRA_TITLE, desktopRecords ? "records.json" : "偶像活动备份-"
                        + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()) + ".zip");
                    chooserPending = true;
                    startActivityForResult(intent, EXPORT_REQUEST);
                } catch (Exception error) {
                    chooserPending = false;
                    exportFile.delete();
                    notice("无法打开保存位置：" + error.getMessage(), false);
                }
            });
        }

        @JavascriptInterface public void pickAvatar(String token) {
            runOnUiThread(() -> {
                if (chooserPending) { notice("请先完成当前文件选择", false); return; }
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                    avatarToken = token;
                    chooserPending = true;
                    startActivityForResult(intent, AVATAR_REQUEST);
                } catch (Exception error) {
                    chooserPending = false;
                    notice("无法选择头像：" + error.getMessage(), false);
                }
            });
        }

        @JavascriptInterface public long lastExportTime() {
            return getSharedPreferences("backup-info",MODE_PRIVATE).getLong("lastExport",0);
        }
        @JavascriptInterface public void pickPhoto(String token) {
            runOnUiThread(()->{
                if(chooserPending){callback("if(window.onNativePhoto)window.onNativePhoto("+JSONObject.quote(token)+",null);");notice("请先完成当前文件选择",false);return;}
                try{
                    Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");intent.putExtra(Intent.EXTRA_LOCAL_ONLY,true);
                    photoToken=token;chooserPending=true;startActivityForResult(intent,PHOTO_REQUEST);
                }catch(Exception error){chooserPending=false;callback("if(window.onNativePhoto)window.onNativePhoto("+JSONObject.quote(token)+",null);");notice("无法选择照片："+error.getMessage(),false);}
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

        @JavascriptInterface public void savePhotoToGallery(String source) {
            final String trimmed = source == null ? "" : source.trim();
            if (trimmed.isEmpty()) { notice("没有可保存的照片", false); return; }
            new Thread(() -> {
                try {
                    byte[] bytes;
                    String mime;
                    String ext;
                    if (BackupArchive.isPhotoUrl(trimmed)) {
                        try (InputStream input = media.open(trimmed)) {
                            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                            byte[] chunk = new byte[16384];
                            int read;
                            int total = 0;
                            while ((read = input.read(chunk)) != -1) {
                                total += read;
                                if (total > MAX_BYTES) throw new IOException("照片体积超过限制");
                                buffer.write(chunk, 0, read);
                            }
                            bytes = buffer.toByteArray();
                        }
                        String lowerUrl = trimmed.toLowerCase(Locale.ROOT);
                        if ((bytes.length >= 8 && bytes[0] == (byte) 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) || lowerUrl.endsWith(".png")) {
                            mime = "image/png"; ext = "png";
                        } else if ((bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') || lowerUrl.endsWith(".webp")) {
                            mime = "image/webp"; ext = "webp";
                        } else {
                            mime = "image/jpeg"; ext = "jpg";
                        }
                    } else if (IMAGE_DATA.matcher(trimmed).find()) {
                        String lower = trimmed.toLowerCase(Locale.ROOT);
                        int colon = lower.indexOf("data:image/");
                        int prefixEnd = lower.indexOf(";base64,", colon);
                        if (colon < 0 || prefixEnd < colon) throw new IOException("不支持的照片编码格式");
                        String sub = lower.substring(colon + "data:image/".length(), prefixEnd);
                        if ("png".equals(sub)) { mime = "image/png"; ext = "png"; }
                        else if ("webp".equals(sub)) { mime = "image/webp"; ext = "webp"; }
                        else if ("jpeg".equals(sub) || "jpg".equals(sub)) { mime = "image/jpeg"; ext = "jpg"; }
                        else throw new IOException("不支持的照片格式：" + sub);
                        bytes = Base64.decode(trimmed.substring(prefixEnd + ";base64,".length()), Base64.DEFAULT);
                    } else {
                        throw new IOException("不支持的照片来源");
                    }
                    if (bytes == null || bytes.length == 0) throw new IOException("照片数据为空");
                    String fileName = "idol-recorder-" + new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(new Date()) + "." + ext;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
                        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/IdolRecorder");
                        values.put(MediaStore.Images.Media.IS_PENDING, 1);
                        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                        Uri inserted = getContentResolver().insert(collection, values);
                        if (inserted == null) throw new IOException("无法写入系统相册");
                        try {
                            try (OutputStream out = getContentResolver().openOutputStream(inserted)) {
                                if (out == null) throw new IOException("无法打开相册输出流");
                                out.write(bytes);
                                out.flush();
                            }
                            ContentValues ready = new ContentValues();
                            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
                            getContentResolver().update(inserted, ready, null, null);
                        } catch (Exception writeError) {
                            getContentResolver().delete(inserted, null, null);
                            throw writeError;
                        }
                        notice("已保存到系统相册 Pictures/IdolRecorder", true);
                    } else {
                        runOnUiThread(() -> {
                            if (chooserPending) { notice("请先完成当前文件操作", false); return; }
                            try {
                                pendingSaveBytes = bytes;
                                pendingSaveMime = mime;
                                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                                intent.addCategory(Intent.CATEGORY_OPENABLE);
                                intent.setType(mime);
                                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                                intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                                chooserPending = true;
                                startActivityForResult(intent, SAVE_PHOTO_REQUEST);
                            } catch (Exception error) {
                                chooserPending = false;
                                pendingSaveBytes = null;
                                notice("无法打开保存窗口：" + error.getMessage(), false);
                            }
                        });
                    }
                } catch (Exception error) {
                    notice("保存照片失败：" + error.getMessage(), false);
                }
            }, "photo-save").start();
        }
    }

    private String avatarData(Uri uri) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("无法读取图片，请选择 JPG、PNG 或 WebP");
        BitmapFactory.Options options = new BitmapFactory.Options();
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > 1024) sample *= 2;
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap source;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            source = BitmapFactory.decodeStream(input, null, options);
        }
        if (source == null) throw new IOException("无法解码头像");
        Bitmap target = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(target);
            canvas.drawColor(Color.WHITE);
            int size = Math.min(source.getWidth(), source.getHeight());
            int left = (source.getWidth() - size) / 2, top = (source.getHeight() - size) / 2;
            android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(source, new Rect(left, top, left + size, top + size), new Rect(0, 0, 256, 256), paint);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            target.compress(Bitmap.CompressFormat.JPEG, 85, output);
            return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } finally { source.recycle(); target.recycle(); }
    }

    private String photoData(Uri uri) throws IOException {
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        try(InputStream input=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(input,null,bounds);}
        if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IOException("无法读取图片");
        BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
        while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
        options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        Bitmap source;
        try(InputStream input=getContentResolver().openInputStream(uri)){source=BitmapFactory.decodeStream(input,null,options);}
        if(source==null)throw new IOException("无法解码照片");
        Bitmap rotated=source,target=null;
        try{
            int orientation=1;
            try(InputStream input=getContentResolver().openInputStream(uri)){orientation=new android.media.ExifInterface(input).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,1);}catch(IOException ignored){}
            android.graphics.Matrix matrix=new android.graphics.Matrix();
            switch(orientation){case 2:matrix.setScale(-1,1);break;case 3:matrix.setRotate(180);break;case 4:matrix.setScale(1,-1);break;case 5:matrix.setRotate(90);matrix.postScale(-1,1);break;case 6:matrix.setRotate(90);break;case 7:matrix.setRotate(270);matrix.postScale(-1,1);break;case 8:matrix.setRotate(270);break;default:break;}
            if(!matrix.isIdentity())rotated=Bitmap.createBitmap(source,0,0,source.getWidth(),source.getHeight(),matrix,true);
            double scale=Math.min(1.0,1280.0/Math.max(rotated.getWidth(),rotated.getHeight()));
            int width=Math.max(1,(int)Math.round(rotated.getWidth()*scale)),height=Math.max(1,(int)Math.round(rotated.getHeight()*scale));
            target=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(target);canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(rotated,null,new Rect(0,0,width,height),new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG));
            ByteArrayOutputStream output=new ByteArrayOutputStream();int quality=85;
            do{output.reset();target.compress(Bitmap.CompressFormat.JPEG,quality,output);quality-=10;}while(output.size()>450000&&quality>=35);
            if(output.size()>500000)throw new IOException("照片压缩后仍过大，请选择较小的图片");
            return "data:image/jpeg;base64,"+Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP);
        }finally{if(target!=null)target.recycle();if(rotated!=source)rotated.recycle();source.recycle();}
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != IMPORT_REQUEST && requestCode != EXPORT_REQUEST && requestCode != AVATAR_REQUEST && requestCode != PHOTO_REQUEST && requestCode != SAVE_PHOTO_REQUEST) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            chooserPending = false;
            if (requestCode == EXPORT_REQUEST) exportFile.delete();
            if (requestCode == SAVE_PHOTO_REQUEST) { pendingSaveBytes = null; pendingSaveMime = ""; }
            if (requestCode == PHOTO_REQUEST) callback("if(window.onNativePhoto)window.onNativePhoto("+JSONObject.quote(photoToken)+",null);");
            notice(requestCode == SAVE_PHOTO_REQUEST ? "已取消保存照片" : requestCode == PHOTO_REQUEST ? "已取消选择照片" : requestCode == AVATAR_REQUEST ? "已取消选择头像" : requestCode == EXPORT_REQUEST ? "已取消导出" : "已取消导入", false);
            return;
        }
        final Uri uri = data.getData();
        new Thread(() -> {
            try {
                if (requestCode == SAVE_PHOTO_REQUEST) {
                    byte[] bytes = pendingSaveBytes;
                    pendingSaveBytes = null;
                    pendingSaveMime = "";
                    if (bytes == null || bytes.length == 0) throw new IOException("没有待保存的照片数据");
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("无法打开目标文件");
                        output.write(bytes);
                        output.flush();
                    }
                    notice("照片已保存到本地", true);
                } else if(requestCode==PHOTO_REQUEST){
                    String photo=media.savePhoto(photoData(uri));
                    callback("if(window.onNativePhoto)window.onNativePhoto("+JSONObject.quote(photoToken)+","+JSONObject.quote(photo)+");");
                } else if (requestCode == AVATAR_REQUEST) {
                    String avatar = avatarData(uri);
                    callback("if(window.onNativeAvatar)window.onNativeAvatar(" + JSONObject.quote(avatarToken) + "," + JSONObject.quote(avatar) + ");");
                } else if (requestCode == IMPORT_REQUEST) {
                    String content = new String(jsonBytes(media.importBackup(getContentResolver().openInputStream(uri),getCacheDir()), false), StandardCharsets.UTF_8);
                    callback("if(window.onNativeImport)window.onNativeImport(" + JSONObject.quote(content) + ");");
                } else {
                    byte[] payload;
                    synchronized (storageLock) { payload = jsonBytes(readUtf8(exportFile.openRead()), false); }
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("无法打开目标文件");
                        if(payload.length>0&&payload[0]=='{')media.exportArchive(new String(payload,StandardCharsets.UTF_8),output);else output.write(payload);
                        output.flush();
                    }
                    synchronized (storageLock) { exportFile.delete(); }
                    if(payload.length>0&&payload[0]=='{'){
                        long exportedAt=System.currentTimeMillis();getSharedPreferences("backup-info",MODE_PRIVATE).edit().putLong("lastExport",exportedAt).apply();
                        callback("if(window.onNativeExported)window.onNativeExported("+exportedAt+");");
                    }
                    notice("备份已导出", true);
                }
            } catch (Exception error) {
                if (requestCode == SAVE_PHOTO_REQUEST) { pendingSaveBytes = null; pendingSaveMime = ""; }
                if(requestCode==PHOTO_REQUEST)callback("if(window.onNativePhoto)window.onNativePhoto("+JSONObject.quote(photoToken)+",null);");
                notice((requestCode == SAVE_PHOTO_REQUEST ? "保存照片失败：" : requestCode == PHOTO_REQUEST ? "照片读取失败：" : requestCode == AVATAR_REQUEST ? "头像读取失败：" : requestCode == IMPORT_REQUEST ? "导入失败：" : "导出失败：") + error.getMessage(), false);
            } finally {
                runOnUiThread(() -> chooserPending = false);
            }
        }, "backup-file-io").start();
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean("chooserPending", chooserPending);
        outState.putString("avatarToken", avatarToken);
        outState.putString("photoToken",photoToken);
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
