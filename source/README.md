# 偶像活动手账 Android 源码 v1.2.3

本目录包含正式 APK 使用的 Android Java 外壳、离线界面、图标、空白初始化数据、构建脚本和匿名回归测试。

## 构建环境

需要 Python 3.11、Node.js、JDK 17、Android SDK 平台 35 和 Build Tools 35.0.0。环境变量 `IDOL_ANDROID_TOOLS` 指向包含 `sdk/` 与 `jdk17/` 的工具目录。

```powershell
node --test tests/core.test.js tests/app.test.js
py -3.11 prepare_seed.py
py -3.11 build.py --native-only
```

正式构建执行 `py -3.11 build.py`，输出版本 1.2.3、版本代码 11 的签名安装包。包名 cn.local.idoltracker，最低 API 26，目标 API 35。

维护者正式构建使用本地 `private-signing/release.p12`、`private-signing/storepass.txt` 及`release/1.0.0` 至 `release/1.2.1` 安装包核对签名。这些本地维护材料由 `.gitignore` 排除。自行发布时需配置自己的签名与证书校验基准。

## 代码

- `app/src/main/java/` 提供原子保存、系统文件选择器、头像与活动照片压缩、系统相册保存（API 29+ MediaStore / API 26-28 DocumentProvider）、成功导出时间记录。
- `core.js` 处理数据迁移、固定成员编号、事务所目录与一键更名同步、身份、金额、价格方案和各类统计。
- `people.js` 提供成员管理、事务所管理与一键更名、全历史百切进度、改名、归档、合并、互动查询和排行。
- `extras.js` 提供价格与自定义特典管理、外观设置、日历和年度回顾。
- `photos.js` 提供活动与明细照片编辑、全屏缩放查看器、保存到本地相册、预览与删除。
- `stats-ui.js` 提供支出、门票、趋势、月度汇总和足迹。
- `app.js` 连接导航、活动和消费编辑、快捷补记、设置与备份。

## 数据格式 7

成员资料使用固定 `id`，消费明细使用 `member_id` 或 `member_ids`。姓名继续保存在兼容展示字段中，`aliases` 保存曾用名，`archived` 标识归档。旧格式缺失编号时确定性生成，显式编号优先，同名成员通过不同编号区分。

`member_roles` 保存活动默认身份，`participant_groups` 保存每条互动身份。身份条目包含 `member`、`member_id`、`group`，独立于活动默认值的互动增加 `override: true`。旧格式缺失身份时使用档案的第一个团体，已有明确身份保留。

`config.price_presets` 保存通用、团体或成员价格方案，`config.organizers` 保存预设或已管理的事务所目录。`config.benefit_types` 保存自定义特典类型，`counts_as_photo` 决定是否进入拍立得记录。每条消费保存实付金额快照。

活动支持 `ticket_quantity`、`ticket_type`、`ticket_is_free` 和 `session`。财务按活动日期，成员与拍立得按拍摄日期统计，未填拍摄时间则采用活动日期；成员详情“距离百切”按全部时间特典券累计计算。

活动及互动的 `attachments` 保存照片列表，每项为 `{id, data, caption}`。Android 照片存入应用私有文件，data 使用 https://idol.local/photos/ 内容哈希引用。旧内嵌照片自动迁移。完整 ZIP 包含 state.json 与 photos/，流式导入导出上限 10 GiB，文字元数据和旧 JSON 上限 50 MiB。

手机合影使用 kind 为 phone，可按成员或按团体记录（团体记录使用 `cheki_type: 'group'` 与 `group_name`），独立照片以 standalone_phone 活动容器保存。手机合影单独计数，费用纳入消费，不计入特典券及拍立得数量与百切进度。

首次安装记录与成员为空，备份提醒关闭。升级自动迁移旧数据。原生 BackupArchive.java 处理照片文件和完整备份。
