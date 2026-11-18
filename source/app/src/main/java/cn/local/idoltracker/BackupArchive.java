package cn.local.idoltracker;

import android.util.Base64;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Content-addressed photos and bounded, streaming portable archives. */
final class BackupArchive {
    static final long MAX_BACKUP_BYTES = 10L * 1024 * 1024 * 1024;
    static final String PHOTO_ORIGIN = "https://idol.local/photos/";
    private static final int MAX_METADATA_BYTES = 50 * 1024 * 1024;
    static final long MAX_VIDEO_BYTES = 512L * 1024 * 1024;
    private static final String VIDEO_NAME = "[0-9a-f]{64}\\.(?:mp4|webm|mov|mkv|3gp|m4v)";
    private static final String PHOTO_NAME = "[0-9a-f]{64}\\.(?:jpg|png|webp|mp4|webm|mov|mkv|3gp|m4v)";
    private final File photos;
    private final File staging;
    BackupArchive(File files) throws IOException {
        photos = new File(files,"photos"); staging = new File(files,"photo-import-staging");
        if(!photos.isDirectory()&&!photos.mkdirs())throw new IOException("无法创建照片目录");
        if(!staging.isDirectory()&&!staging.mkdirs())throw new IOException("无法创建备份暂存目录");
    }
    static long checkedTotal(long total,long added) throws IOException {
        if(added<0||total<0||total>MAX_BACKUP_BYTES-added)throw new IOException("备份超过 10 GB 限制");
        return total+added;
    }
    static boolean isPhotoUrl(String url){return url!=null&&url.startsWith(PHOTO_ORIGIN)&&url.substring(PHOTO_ORIGIN.length()).matches(PHOTO_NAME);}
    static boolean isVideoUrl(String url){return url!=null&&url.startsWith(PHOTO_ORIGIN)&&url.substring(PHOTO_ORIGIN.length()).matches(VIDEO_NAME);}
    File resolveMediaFile(String url) throws IOException { return photoFile(url); }
    private File photoFile(String url) throws IOException {
        if(!isPhotoUrl(url))throw new IOException("照片地址无效");
        String name=url.substring(PHOTO_ORIGIN.length());File file=new File(photos,name);
        return file.isFile()?file:new File(staging,name);
    }
    InputStream open(String url) throws IOException {return new FileInputStream(photoFile(url));}
    private static String digest(byte[] bytes) throws Exception {
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder value=new StringBuilder();
        for(byte b:hash)value.append(String.format(Locale.US,"%02x",b&255));return value.toString();
    }
    private static String normalizeVideoExt(String ext) {
        if (ext == null) return "mp4";
        String lower = ext.trim().toLowerCase(Locale.US);
        if (lower.startsWith(".")) lower = lower.substring(1);
        if ("webm".equals(lower) || "mov".equals(lower) || "mkv".equals(lower) || "3gp".equals(lower) || "m4v".equals(lower) || "mp4".equals(lower)) return lower;
        if ("quicktime".equals(lower)) return "mov";
        if ("x-matroska".equals(lower)) return "mkv";
        if ("3gpp".equals(lower)) return "3gp";
        return "mp4";
    }
    String saveVideo(InputStream source, String extension, File tempDir) throws Exception {
        if (source == null) throw new IOException("无法读取所选视频");
        String safeExt = normalizeVideoExt(extension);
        File temp = File.createTempFile("video-", ".tmp", photos);
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream in = source) {
            try (FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_VIDEO_BYTES) throw new IOException("单个视频不能超过 512 MB");
                    hash.update(buffer, 0, count);
                    out.write(buffer, 0, count);
                }
                out.flush();
            }
            if (total == 0) throw new IOException("视频文件为空");
            StringBuilder value = new StringBuilder();
            for (byte b : hash.digest()) value.append(String.format(Locale.US, "%02x", b & 255));
            String name = value.toString() + "." + safeExt;
            File target = new File(photos, name);
            if (!target.isFile()) {
                if (!temp.renameTo(target)) throw new IOException("无法保存视频文件");
            } else {
                temp.delete();
            }
            return PHOTO_ORIGIN + name;
        } catch (Exception error) {
            temp.delete();
            throw error;
        }
    }
    String savePhoto(String data) throws Exception {
        if(isPhotoUrl(data)){if(!photoFile(data).isFile())throw new IOException("备份缺少照片或视频文件");return data;}
        if(data==null)throw new IOException("媒体数据无效");
        boolean isInlineVideo = data.matches("data:video/(?:mp4|webm|quicktime|x-matroska|3gpp);base64,[A-Za-z0-9+/]+={0,2}");
        if(isInlineVideo){
            if(data.length()>15000000)throw new IOException("内联视频数据过大");
            String sub=data.substring("data:video/".length(),data.indexOf(';'));
            byte[] bytes=Base64.decode(data.substring(data.indexOf(',')+1),Base64.DEFAULT);
            return saveVideo(new java.io.ByteArrayInputStream(bytes), sub, photos);
        }
        if(data.length()>700000||!data.matches("data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}"))throw new IOException("照片数据无效");
        String extension=data.startsWith("data:image/png;")?"png":data.startsWith("data:image/webp;")?"webp":"jpg";
        byte[] bytes=Base64.decode(data.substring(data.indexOf(',')+1),Base64.DEFAULT);String name=digest(bytes)+"."+extension;
        File file=new File(photos,name);
        if(!file.isFile()){
            AtomicFile atomic=new AtomicFile(file);FileOutputStream out=null;
            try{out=atomic.startWrite();out.write(bytes);atomic.finishWrite(out);}catch(IOException error){atomic.failWrite(out);throw error;}
        }
        return PHOTO_ORIGIN+name;
    }
    private void normalize(Object value) throws Exception {
        if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int n=0;n<array.length();n++)normalize(array.get(n));}
        else if(value instanceof JSONObject){JSONObject object=(JSONObject)value;ArrayList<String> keys=new ArrayList<>();object.keys().forEachRemaining(keys::add);
            for(String key:keys){Object child=object.get(key);if("attachments".equals(key)){
                if(!(child instanceof JSONArray)||((JSONArray)child).length()>20)throw new IOException("照片列表无效");
                JSONArray array=(JSONArray)child;for(int n=0;n<array.length();n++){JSONObject photo=array.getJSONObject(n);photo.put("data",savePhoto(photo.getString("data")));}
            }else normalize(child);}
        }
    }
    String externalize(String json) throws Exception {
        Object value=json.trim().startsWith("[")?new JSONArray(json):new JSONObject(json);normalize(value);return value.toString();
    }
    private static void references(Object value,Set<String> urls) throws Exception {
        if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int n=0;n<array.length();n++)references(array.get(n),urls);}
        else if(value instanceof JSONObject){JSONObject object=(JSONObject)value;Iterator<String> keys=object.keys();while(keys.hasNext()){String key=keys.next();Object child=object.get(key);if("attachments".equals(key)){
            if(!(child instanceof JSONArray))throw new IOException("照片列表无效");JSONArray array=(JSONArray)child;for(int n=0;n<array.length();n++){String data=array.getJSONObject(n).getString("data");if(!isPhotoUrl(data))throw new IOException("照片引用无效");urls.add(data);}
        }else references(child,urls);}}
    }
    private static Set<String> references(String json) throws Exception {Set<String> urls=new LinkedHashSet<>();references(new JSONObject(json),urls);return urls;}
    void commitStaged(String json) throws Exception {
        for(String url:references(json)){File source=photoFile(url);if(!source.isFile())throw new IOException("备份缺少照片文件");if(source.getParentFile().equals(staging)){
            File target=new File(photos,source.getName());if(!target.isFile()&&!source.renameTo(target))throw new IOException("无法保存备份照片");
        }}
    }
    private static long copy(InputStream input,OutputStream output,long total) throws IOException {
        byte[] buffer=new byte[64*1024];int count;
        while((count=input.read(buffer))!=-1){total=checkedTotal(total,count);output.write(buffer,0,count);}return total;
    }
    void exportArchive(String json,OutputStream output) throws Exception {
        Set<String> urls=references(json);byte[] metadata=json.getBytes(java.nio.charset.StandardCharsets.UTF_8);long expected=metadata.length;
        for(String url:urls)expected=checkedTotal(expected,photoFile(url).length());
        CountingOutputStream counted=new CountingOutputStream(output);
        try(ZipOutputStream zip=new ZipOutputStream(counted)){
            zip.putNextEntry(new ZipEntry("state.json"));zip.write(metadata);zip.closeEntry();
            for(String url:urls){zip.putNextEntry(new ZipEntry("photos/"+url.substring(PHOTO_ORIGIN.length())));try(InputStream input=open(url)){copy(input,zip,0);}zip.closeEntry();}
        }
    }
    private static final class CountingOutputStream extends FilterOutputStream {
        private long count;
        CountingOutputStream(OutputStream output){super(output);}
        @Override public void close()throws IOException{flush();}
        @Override public void write(int value)throws IOException{count=checkedTotal(count,1);out.write(value);}
        @Override public void write(byte[] bytes,int offset,int length)throws IOException{count=checkedTotal(count,length);out.write(bytes,offset,length);}
    }
    private static String metadata(InputStream input) throws IOException {
        try(InputStream stream=input;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(output.size()>MAX_METADATA_BYTES-count)throw new IOException("文字记录过大，请分批导入");output.write(buffer,0,count);}return output.toString("UTF-8");
        }
    }
    private void clearStaging() throws IOException {
        File[] files=staging.listFiles();if(files==null)return;String parent=staging.getCanonicalPath();
        for(File file:files)if(file.isFile()&&file.getCanonicalFile().getParentFile().getPath().equals(parent)&&!file.delete())throw new IOException("无法清理上次导入的临时照片");
    }
    synchronized String importBackup(InputStream source,File cache) throws Exception {
        clearStaging();
        try(BufferedInputStream input=new BufferedInputStream(source)){
            input.mark(4);int first=input.read(),second=input.read();input.reset();
            if(first!='P'||second!='K')return externalize(metadata(input));
            File archive=File.createTempFile("idol-backup-", ".zip",cache);
            try{
                try(OutputStream file=new FileOutputStream(archive)){copy(input,file,0);}
                try(ZipFile zip=new ZipFile(archive)){
                    ZipEntry state=zip.getEntry("state.json");if(state==null)throw new IOException("备份缺少记录文件");
                    String json=metadata(zip.getInputStream(state));JSONObject parsed=new JSONObject(json);if(!"idol-tracker-backup".equals(parsed.optString("format")))throw new IOException("不是本软件的完整备份");
                    Set<String> refs=references(json);long total=state.getSize()<0?json.getBytes("UTF-8").length:state.getSize();
                    HashSet<String> seen=new HashSet<>();Enumeration<? extends ZipEntry> entries=zip.entries();
                    while(entries.hasMoreElements()){ZipEntry entry=entries.nextElement();String name=entry.getName();if(!seen.add(name)||!(name.equals("state.json")||name.matches("photos/"+PHOTO_NAME)))throw new IOException("备份包含无效或重复文件");}
                    ArrayList<File> created=new ArrayList<>();
                    try{
                        for(String url:refs){String name=url.substring(PHOTO_ORIGIN.length());ZipEntry entry=zip.getEntry("photos/"+name);if(entry==null)throw new IOException("备份缺少媒体文件："+name);
                            long entryLimit=isVideoUrl(url)?MAX_VIDEO_BYTES:500000L;
                            if(entry.getSize()>entryLimit)throw new IOException(isVideoUrl(url)?"备份视频过大":"备份照片过大");
                            File temp=File.createTempFile("photo-", ".tmp",staging);created.add(temp);MessageDigest hash=MessageDigest.getInstance("SHA-256");long imageBytes=0;
                            try(InputStream photo=zip.getInputStream(entry);OutputStream out=new FileOutputStream(temp)){byte[] buffer=new byte[65536];int count;while((count=photo.read(buffer))!=-1){total=checkedTotal(total,count);imageBytes+=count;if(imageBytes>entryLimit)throw new IOException(isVideoUrl(url)?"备份视频过大":"备份照片过大");hash.update(buffer,0,count);out.write(buffer,0,count);}}
                            StringBuilder digest=new StringBuilder();for(byte b:hash.digest())digest.append(String.format(Locale.US,"%02x",b&255));if(!name.startsWith(digest.toString()+"."))throw new IOException("照片校验失败");
                            File target=new File(staging,name);if(target.isFile()||new File(photos,name).isFile())temp.delete();else if(!temp.renameTo(target))throw new IOException("无法暂存备份照片");else{created.remove(temp);created.add(target);}
                        }
                        return json;
                    }catch(Exception error){for(File file:created)file.delete();throw error;}
                }
            }finally{archive.delete();}
        }
    }
}
