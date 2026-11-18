# 偶像活动手账 Android 源码 v1.3.0

本目录包含正式 APK 使用的 Android Java 外壳、离线界面、图标、空白初始化数据、构建脚本和匿名回归测试。

## 构建环境

需要 Python 3.11、Node.js、JDK 17、Android SDK 平台 35 和 Build Tools 35.0.0。环境变量 `IDOL_ANDROID_TOOLS` 指向包含 `sdk/` 与 `jdk17/` 的工具目录。

```powershell
node --test tests/core.test.js tests/app.test.js
py -3.11 prepare_seed.py
py -3.11 build.py --native-only
```

正式构建执行 `py -3.11 build.py`，输出版本 1.3.0、版本代码 14 的签名安装包。包名 cn.local.idoltracker，最低 API 26，目标 API 35，与 `release/1.0.0` 至 `release/1.2.5` 签名一致。

## 主要模块

- `MainActivity.java` / `BackupArchive.java`：本地原子存储、`pickMedia` 图库照片/视频混合选择、WebView `HTTP 206 Range` 分段视频流响应、System `MediaStore` 图片（`Pictures/IdolRecorder`）与视频（`Movies/IdolRecorder`）保存、以及支持大视频的 10 GiB ZIP 完整备份。
- `index.html` / `style.css` / `stats.css`：淡粉色手账主题、实体花费进度条卡片、视频角标缩略图与全屏播放器样式、以及全模块暗色模式 / 1.3 倍字号兼容样式。
- `core.js`：格式版本 7 迁移与 `v1.2.0`+ 兼容、`entitySpendingSummary`（成员 / 团体 / 事务所实付分摊及降序汇总）与附件多格式视频校验。
- `stats-ui.js` / `people.js` / `photos.js` / `app.js`：总览“对象花费”及降序布局、记录/成员/拍切筛选搜索框重排、以及手机合影常见视频格式支持。
