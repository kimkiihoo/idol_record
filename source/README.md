# 偶像活动手账 Android 源码（1.1.1）

此目录包含生成同目录发布 APK 所用的 Android 原生壳、离线 Web 界面、空白安装数据、构建脚本和通用测试。首次安装为空白；升级与备份导入会保留非图片数据，旧图片内容会被忽略。

## 目录

- `app/src/main/`：Android 清单、原生 Java、图标和 APK 内页面资源。
- `tests/`：核心逻辑及界面回归测试，使用匿名示例数据，不读取维护者的个人记录。
- `build.py`：使用 Android SDK、Build Tools 和 JDK 构建并验证 APK。
- `prepare_seed.py`：生成空白初始化数据和通用离线拼音字典。

## 检查与构建

需要 Python 3.11、Node.js、Android SDK 平台 35、Build Tools 35.0.0 和 JDK 17。工具不在源码目录内；如未放在脚本默认位置，请设置 `IDOL_ANDROID_TOOLS` 指向同时含有 `sdk/` 和 `jdk17/` 的工具目录。

在此目录运行：

```powershell
node --test tests/core.test.js tests/app.test.js
py -3.11 prepare_seed.py
py -3.11 build.py --native-only
```

生成正式的可覆盖升级 APK 还需要维护者本地保管的原始签名密钥，以及原始 1.0.0 APK 用于核对签名。它们不随源码发布；缺少时构建脚本会拒绝签出不兼容的安装包。将原密钥放在本机 `private-signing/release.p12`、密码放在 `private-signing/storepass.txt`，把原始 APK 临时放在 `release/偶像活动手账_Android_v1.0.0.apk`。源码中的 `.gitignore` 会排除这些密钥和 APK。准备好后运行 `py -3.11 build.py`。

本源码目录没有附加许可证文件。需要为代码添加使用许可时，请由仓库维护者按实际意图决定并添加。
