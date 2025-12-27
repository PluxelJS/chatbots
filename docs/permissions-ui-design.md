# Permissions UI 设计说明

## 目标
- 用最少的操作完成角色、授权、用户权限维护
- 对“未提交更改”清晰可见、可撤销、可批量提交
- 保证节点展示与提交节点一致，避免同名/同节点错位

## 信息架构
- 顶部：全局标题 + 节点计数 + 刷新
- Tabs：
  - Roles：角色列表 + 角色授权面板
  - Users：用户队列 + 用户权限/角色授权面板

## 关键交互
- 选择 Role/User 后，面板自动加载并重置本地未提交状态
- 授权添加：从权限节点选择器选择节点 + 选择 allow/deny + Add
- 列表内操作：
  - Toggle effect（allow/deny）
  - Revoke（支持 Undo remove）
- 批量操作：Allow/Deny/Revoke 选中项
- 提交与撤销：Pending bar 提醒未提交更改，可 Commit 或 Discard

## Pending 变更模型
- PendingChange：grant / revoke / toggle
- 变更统一走 `applyPendingGrantSelection`，避免同节点重复和效果不一致
- 节点 key 来自 `node`（若存在）或 nsKey/local 推导，确保一致性

## 列表呈现与排序
- 默认将 Pending 项置顶排序（add → modify → remove → saved）
- 支持“Pending only”过滤，便于专注处理未提交项
- 搜索过滤不改变节点 key，确保状态同步

## 细节与边界
- undo remove：对 pending=remove 的条目再次点击即撤销
- 处理空/非法节点：格式化时降级为 `(unknown)`，避免 undefined.*
- SVG avatar/非法资源已替换为安全占位

## 数据流
- UI 使用 RPC 获取 catalog/roles/grants
- 提交操作统一通过 grant/revoke API，提交后 refresh
- UI 仅缓存 pending 状态，不直接写入持久层
