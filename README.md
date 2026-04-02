# 九州多账号状态管理

> 《九州》多账号状态面板，提供 **Tampermonkey 脚本版** 和 **独立 HTML 页面版**。

## 功能

- 多账号管理
- 新增账号 / 批量导入
- 用户名密码登录
- 自动识别验证码模式：
  - 本地图片验证码
  - 腾讯点击验证码
- 角色信息查看：昵称、称号、境界
- 体力显示与回满倒计时
- 功法自研冷却查看
- 伙伴招募冷却查看
- 签到状态查看
- 月卡状态查看
- 挂机状态、累计收益、战斗统计查看
- 灵石 / 银两统计
- 稀有物品统计：修行月卡、顿悟符、高级招募令、易名符
- 全局汇总卡片
- 自动刷新全部状态
- 自动挂机 / 自动续挂
- 自动秘境
- 云游状态查看
- 一键云游：
  - 单账号
- 云游详情展开 / 收起
- 云游当前幕手动选择并确认抉择
- 功法残页数量统计：
  - 单账号
  - 全局汇总
- 一键签到：
  - 单账号
  - 全局批量
- 一键领取月卡奖励：
  - 单账号
  - 全局批量
- 宗门功法残页兑换：
  - 单账号兑换 500 残页
  - 全局兑换 500 残页
- 浏览器通知提醒
- 多种排序
- 设置区可折叠
- token 与最近状态本地保存
- 密码仅保存在当前页面内存

## 文件

- [`jiuzhou-multi-account-status.user.js`](./jiuzhou-multi-account-status.user.js)：Tampermonkey 脚本版
- [`index.html`](./index.html)：独立 HTML 版

## Releases

- 最新版本：`v0.8.5`
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

## 数据与安全

`localStorage` 会保存：
- API Base
- 自动刷新设置
- 通知设置
- 排序方式
- 账号列表
- token
- 最近一次状态

不会写入 `localStorage`：
- 登录密码
- 验证码输入
- 腾讯验证码临时参数

## 说明

- 独立 HTML 版可能受浏览器本地文件策略影响
- 自动挂机依赖服务端已有挂机配置
- 自动秘境依赖可用秘境 ID、有效 token 与正常战斗会话
- 月卡领取依赖账号已激活月卡
- 同一账号在别处登录后，旧 token 可能失效
