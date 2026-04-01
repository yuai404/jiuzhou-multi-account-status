# 九州多账号状态管理

文件：

- Tampermonkey 脚本：`E:\git\jiuzhou-multi-account-status\jiuzhou-multi-account-status.user.js`
- 独立页面：`E:\git\jiuzhou-multi-account-status\index.html`

## 已实现

- 多账号管理
- 用户名 / 密码登录
- 自动识别验证码模式
- 支持本地图片验证码
- 支持腾讯点击验证码（登录时弹窗）
- 查看体力
- 查看功法自研冷却
- 查看伙伴招募冷却
- 批量导入账号
- 浏览器通知提醒
- 按剩余时间 / 体力 / 名称排序
- token 与最近状态本地保存

## 批量导入格式

支持以下任一格式，一行一个账号：

```text
备注,用户名,密码
用户名,密码
```

也支持：

- 制表符分隔
- `|` 分隔

说明：

- 密码只进入当前页面内存
- 不会写入 `localStorage`

## 验证码说明

工具会先读：

- `/captcha/config`

然后自动切换：

- `local`：显示图片验证码输入框，走 `/auth/captcha`
- `tencent`：点击“登录”后弹出腾讯点击验证码，提交 `ticket` / `randstr`

## 使用方式

### 方案一：Tampermonkey

1. 安装 Tampermonkey
2. 导入 `E:\git\jiuzhou-multi-account-status\jiuzhou-multi-account-status.user.js`
3. 打开 `https://jz.faith.wang/`
4. 点右下角“打开多账号”

### 方案二：独立 HTML

1. 直接打开 `E:\git\jiuzhou-multi-account-status\index.html`
2. 页面会自动以全屏横向布局打开管理面板（左边账号列表，右边账号详情）

> 如果浏览器拦截本地 HTML 对远程 API 或腾讯验证码 SDK 的跨域请求，请改用 Tampermonkey 方案。

## 提醒说明

- 在工具里勾选“启用浏览器提醒”
- 点击“请求授权”
- 当功法自研或伙伴招募冷却结束时，会弹浏览器通知

## 安全说明

- 密码**只保存在当前页面内存**
- token 和最近一次状态会保存在当前浏览器本地
- 同一账号在别处登录后，旧 token 可能失效

## 参考的仓库接口

- `E:\git\jiuzhou_src\client\src\services\api\auth-character.ts`
- `E:\git\tmp_technique_api.ts`
- `E:\git\jiuzhou_src\client\src\services\api\partner.ts`
- `E:\git\jiuzhou_src\server\src\services\characterComputedService.ts`

关键接口：

- `/captcha/config`
- `/auth/captcha`
- `/auth/login`
- `/character/check`
- `/character/:id/technique/research/status`
- `/partner/recruit/status`
