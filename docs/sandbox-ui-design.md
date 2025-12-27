# Sandbox UI 设计说明

## 目标
- 快速验证 bot-layer 行为与平台差异
- 低成本模拟用户/频道/权限/平台策略
- 保持与 bot-layer 抽象一致，减少沙盒与线上行为偏差

## 核心概念
- Session：独立沙盒会话，包含 platform/user/channel/mock roles
- Target Platform：目标平台能力与渲染策略，默认 `sandbox`
- Policy Summary：展示目标平台的格式/混合媒体/图片/文件/引用/最大 caption 等策略

## 信息架构
- 左侧栏（压缩信息密度）：
  - Target Platform + Policy Summary
  - Session 列表与管理（新增/复制/删除/重置）
  - Mock 身份（user/channel/role）
  - Parts samples 开关（调试拆分/渲染）
- 主区域：
  - 消息流展示（ChatUI）
  - 输入区（文本/样例输入）

## 关键交互
- 目标平台切换：影响富媒体拆分策略与 render 文本
- Session 管理：持久化到 localStorage，重载后可恢复
- 消息发送：
  - 支持 parts 输入与 sample input
  - 使用 renderText + normalizeParts 确保与平台渲染一致
- SSE：新消息以流式追加，支持批量 append

## 渲染/拆分一致性
- bot-layer 通过 adapter 能力生成 renderText
- sandbox store 使用 renderText 作为最终展示文本
- 平台策略驱动 mixed media、caption 等拆分行为

## 细节与边界
- 默认头像使用 PNG data URI，避免 Skia decode error
- 兼容旧 session：sanitizeSession 过滤异常字段与 SVG avatar
- 输入解析：binary 使用 base64 传输，避免结构丢失

## 数据流
- UI → RPC：snapshot / send / reset / commands
- sandbox store 统一管理 session messages 与 SSE
- 命令 dispatch 通过 bot-layer 统一通道执行
