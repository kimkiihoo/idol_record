# 偶像活动手账 Android 源码（v1.3.3）

本目录包含离线 Android 应用的完整原生 Java 代码、Web 前端界面、自动化测试脚本及本地构建脚本。

## 构建说明

需安装 Python 3.11、Node.js、JDK 17 及 Android SDK（Platform 35 + Build Tools 35.0.0），并将 `IDOL_ANDROID_TOOLS` 指向包含 `jdk17/` 与 `sdk/` 的工具目录：

```powershell
node --test tests/core.test.js tests/app.test.js
py -3.11 prepare_seed.py
py -3.11 build.py
```

内置种子文件为空库，不包含任何个人数据或签名私钥。
