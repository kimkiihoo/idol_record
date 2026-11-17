# 偶像活动手账 Android 源码 1.1.5

本目录包含发布 APK 使用的 Android Java 外壳、离线页面、图标、空白安装数据、构建脚本和通用测试。

## 构建

需要 Python 3.11、Node.js、Android SDK 平台 35、Build Tools 35.0.0 和 JDK 17。通过环境变量 `IDOL_ANDROID_TOOLS` 指定同时包含 `sdk/` 与 `jdk17/` 的工具目录。

```powershell
node --test tests/core.test.js tests/app.test.js
py -3.11 prepare_seed.py
py -3.11 build.py --native-only
```

正式构建执行 `py -3.11 build.py`，输出版本 1.1.5、版本代码 7 的签名 APK，包名为 cn.local.idoltracker。最低 API 26，目标 API 35。

维护者的正式构建沿用本地 `private-signing/release.p12` 和 `private-signing/storepass.txt`，并与本地 `release/偶像活动手账_Android_v1.0.0.apk` 核对签名。公开源码中的 `.gitignore` 排除这些维护材料。自行发布时需配置自己的签名和证书校验基准。

## 代码目录

- `app/src/main/java/` 保存本机状态，提供系统备份文件选择器和成员头像选择与压缩。
- `app/src/main/assets/www/app.js` 连接活动、消费编辑、备份及页面导航。
- `core.js` 处理金额、格式迁移、逐人身份、成员和团体查询。
- `people.js` 提供拍切记录、成员资料、排行和团体互动界面。
- `stats-ui.js` 提供支出、趋势、月度汇总和足迹。
- `tests/` 使用匿名样例验证真实页面控制、历史格式、金额和统计。

## 数据格式

数据格式版本为 5，兼容读取旧格式 1、2、3、4。完整状态包含 `records`、`members`、`config` 及旧附件兼容容器 `assets.images`。全新安装的活动和成员列表为空，预算为 0。

活动的 `organizers` 保存联合主办名称数组，`organizer` 保留兼容展示字符串。`performing_groups` 保存参演团体。`member_roles` 为成员本场身份数组，条目结构为 `{member, group}`，一个活动中的每位成员有一个代表团体，空字符串表示明确未指定。

多人合影通过 `cheki_type: multi` 和 `members` 保存参与名单。`participant_groups` 保存逐人成员身份，活动级 `member_roles` 在规范化时同步至相关明细。旧的 `affiliated_groups` 和 `affiliated_group` 兼容读取，身份解析优先使用已保存的活动身份，再读取逐人明细及旧归属字段。

`benefit_format: theme` 表示主题切。旧宿题格式仅在活动名称或备注明确包含主题切关键词时兼容归类，原始明细字段继续保留。成员排行统计全部特典，按所选日期筛选并隐藏零记录成员。

成员以姓名关联历史记录。保存改名时统一更新单人特典、多人合影和两个层级的身份信息。多人合影的全局费用与数量计算一次，成员金额按整数分均摊。团体排行按去重后的互动条数降序。

消费总览按活动日期统计。成员、拍切与团体互动按拍摄日期筛选，未填写时使用活动日期。统计切换标签时，总览默认月，其它标签默认全部。
