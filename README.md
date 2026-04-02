# 九州多账号状态管理

> 《九州》多账号状态面板，优先推荐 **Tampermonkey 脚本版**。

## 功能

- 多账号管理
- 新增账号 / 批量导入
- 用户名密码登录
- 自动识别验证码模式：
  - 本地图片验证码
  - 腾讯点击验证码
- 角色信息、体力、签到、月卡、挂机、秘境、云游、功法、招募状态查看
- 灵石 / 银两 / 稀有物品 / 功法残页统计
- 全局汇总卡片
- 全局一键操作：
  - 一键刷新状态
  - 一键签到
  - 一键领取月卡
  - 一键云游
  - 一键自动云游
  - 一键自动挂机
  - 一键兑换 500 残页
- 云游详情展开 / 收起
- 自动挂机 / 自动续挂
- 自动秘境
- 浏览器通知提醒
- 多种排序
- 设置区可折叠
- 账号设置可折叠
- AI Key / Model / OpenAI URL 页面输入并本地保存
- token 与最近状态本地保存
- 密码仅保存在当前页面内存

## 文件

- [`jiuzhou-multi-account-status.user.js`](./jiuzhou-multi-account-status.user.js)：Tampermonkey 脚本版
- [`index.html`](./index.html)：独立 HTML 版

## Releases

- 最新版本：`v0.9`
- [GitHub Releases](https://github.com/yuai404/jiuzhou-multi-account-status/releases)

## 快速开始

### Tampermonkey（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 安装脚本：
   - [Raw 安装链接](https://raw.githubusercontent.com/yuai404/jiuzhou-multi-account-status/main/jiuzhou-multi-account-status.user.js)
   - 或直接打开 [`jiuzhou-multi-account-status.user.js`](./jiuzhou-multi-account-status.user.js)
3. 打开 `https://jz.faith.wang/`
4. 点击右下角 **打开多账号**

> 当前 `@match`：
> - `https://jz.faith.wang/*`
> - `http://localhost:*/*`

### 独立 HTML

1. 打开 [`index.html`](./index.html)
2. 默认 API Base：`https://jz.faith.wang/api`
3. 如果本地 HTML 遇到跨域 / CSP / 腾讯验证码 SDK 限制，请改用 Tampermonkey 版

## 批量导入格式

一行一个账号，支持：

```text
备注,用户名,密码
用户名,密码
```

也支持：
- 制表符分隔
- `|` 分隔

## 配置

- API Base
- 自动刷新
- 排序方式
- 冷却完成提醒
- 通知授权
- 验证码模式刷新
- AI Key / Model / OpenAI URL

## 数据与安全

`localStorage` 会保存：
- API Base
- 自动刷新设置
- 通知设置
- 排序方式
- 账号列表
- token
- 最近一次状态
- AI 配置

不会写入 `localStorage`：
- 登录密码
- 验证码输入
- 腾讯验证码临时参数

## 说明

- 推荐优先使用 Tampermonkey 版
- 自动挂机依赖服务端已有挂机配置
- 自动秘境依赖可用秘境 ID、有效 token 与正常战斗会话
- HTML 版的 AI 请求可能受浏览器跨域限制
- 同一账号在别处登录后，旧 token 可能失效
