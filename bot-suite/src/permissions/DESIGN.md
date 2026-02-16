# Permissions (Chatbots)

高性能、可插拔的“能力级权限”系统（capability-level permissions）。只负责**判断某个用户是否允许执行某个能力节点**；任何资源/上下文/业务逻辑检查由插件自行实现（out of scope）。

本实现遵循你提供的文档约束，并在不破坏语义的前提下做了少量工程化增强（例如 `PermRef` 缓存 `NodeRef`，便于指令侧零解析接入）。

## 0. API 组合原则（避免重复造轮子）

- 权限核心是 `PermissionService`（以及 TypedArray trie / resolver / registry 等）。
- 对外使用统一通过 `ChatbotsPermissionFacade`：
  - admin/catalog API：`createPermissionApi(perms)`
  - plugin-facing API（caller namespace 推导 + `PermRef`）：`createPermissionFacade(perms, requireNamespaceKey)`
- `Chatbots.permission` 与测试用的 `PermissionsHost.permission` 都复用 `createPermissionFacade()`，避免 core / permissions 各自手写一套 wrapper。

## 1. 节点语法与语义

节点字符串（外部输入）：

- Exact：`<ns>.<local...>` 例：`myplugin.command.reload`
- Prefix-star：`<ns>.<localPrefix>.*` 例：`myplugin.command.*`
- Root-star：`<ns>.*`（等价于 localPrefix = `""`）

通配符规则：

- 只允许最后一段为 `.*` 或 `.*` 的 root 形式（`<ns>.*`）。
- 其它任何 `*` 都会被判定为非法（grant/revoke 会拒绝；授权时 resolve 失败视为 Deny）。

三态决策：

- `Deny = -1`
- `Unset = 0`
- `Allow = 1`

单个 `PermissionProgram` 的决策规则（实现位于 `program.ts`）：

1) `ExactDeny` > `ExactAllow`
2) 否则取“最长匹配的 `prefix.*`”结果
3) 同深度冲突在本实现中不会发生（同一节点同类规则写入会覆盖并清除相反标记；DB 也保证唯一行），等价于“Deny wins”
4) 无匹配 => `Unset`

最终授权层叠（**first-set-wins**；等价于“first non-Unset wins”）：

1) 用户 overrides（user grants）
2) 角色（role effective programs，按稳定顺序）
3) 插件声明的默认（declaration program，仅已声明节点）
4) 全局默认：Deny

> 这是本系统的核心语义：一旦某一层对该节点给出 **Allow/Deny（非 Unset）**，就立刻返回，不再继续看后续层。
>
> 注意：“Deny wins”只发生在**单个 program 内部**（例如 exact deny > exact allow；同一深度 star 冲突时 deny 优先；以及实现层面保证写入覆盖会清掉相反 flag）。
> 它不等价于“跨层 deny 永远优先”：用户 overrides 可以 Allow 覆盖角色 Deny，这是刻意设计（first-set-wins）。

未知/未声明节点：默认 Deny（resolver 解析失败或 catalog 不存在直接 Deny）。

## 2. 热路径性能保证

热路径指：已拿到 `NodeRef` / `PermRef` 的授权判断（通常发生在指令执行前）。

要求：

- 不 `split()` 字符串
- 不分配 segment 数组
- 不 regex
- 不扫描 rule 列表
- 匹配复杂度只与“段数”相关，独立于规则数量

实现：

- `SegmentInterner`：每 namespace 维护一份段 id（u32，从 1 开始）+ `compileLocal()`（不 split，不 regex，按 `.` 扫描）
  - 文件：`interner.ts`
- `PermissionProgram`：不可变 TypedArray Trie（flags + 索引区 + sorted edges）
  - `decide(path: Uint32Array)`：trie walk + 二分查找 child，复杂度 O(segments * log(outDegree))
  - 文件：`program.ts`
- `TrieBuilder`：构建期写入规则，freeze 成 `PermissionProgram`；写入遵循“覆盖并清除相反标记”
  - 文件：`trie_builder.ts`

## 3. Resolver（字符串 -> NodeRef）

`NodeRef = { nsIndex, path: Uint32Array, ver }`

- 本系统在实现层面区分两类“解析”语义：
  - **授权解析（for auth）**：解析语法 + 编译 path，并采用“严格节点可见性”策略：
    - 只有**已声明的 exact 节点**才允许被 `authorize(can)` 查询；未声明 => 直接 Deny（即使 DB 里曾存在 allow grant 也不会生效）。
    - 目的：保证“未知/未声明节点默认 Deny”，并避免 `prefix.*` grants 意外作用于未声明的叶子节点。
  - **写入校验（for grant）**：在写入 grant 时才要求“namespace 已加载 + 节点已声明”，用于防止 typos/phantom grants。
  - **撤销（revoke）**：不依赖 catalog；只要语法合法并能定位 DB 行就允许清理（用于插件卸载/离线批量清理历史 grants）。

- 仅 `indexOf('.')` 解析 namespace 与 local（不做 split）
- 校验通配符语法
- 通过 namespace interner 编译 local（exact/localPrefix）
- 任何“空 segment / `..`”之类非法 local 都视为解析失败（Deny），不会抛异常影响运行时
- 通过 catalog program 校验该节点是否已声明（不存在则 resolve 失败）
- 带 LRU 缓存：`nodeString -> NodeRef`
- `ver` 是 namespace epoch：epoch 仅在 namespace 被卸载/重置（interner 重建）时变化，用于使缓存失效并重新 resolve

文件：`resolver.ts`

工程化增强：

- 指令接入用 `PermRef`（见下文）会缓存 `NodeRef`，避免每次都走 resolver 的 LRU（仍会做 epoch 校验）。

## 4. In-Memory Catalog（声明与 UI 列表）

catalog 不持久化，插件必须运行时声明。

- namespace 由 caller plugin id 推导（`chatbots.permission.declareExact/declareStar`），拒绝跨 namespace 声明
- 每个 namespace：
  - `program`：声明默认（allow/deny），只覆盖“已声明节点”
  - `meta`：用于 admin UI 展示（description/tags/hidden/deprecated）
  - `epoch`：namespace 卸载/重置（interner 重建）时递增，用于使 NodeRef 失效
- 插件卸载/替换（HMR）：`Chatbots` 监听 root `afterCommit`（removed/replaced）并调用 `removeNamespace(nsKey)` 清空 namespace 状态并 bump epoch

文件：`registry.ts`、`core/chatbots.ts`

## 5. Roles / Users

角色：

- 单继承（tree）：`parentRoleId` nullable
- `rank` 用于稳定优先级（高 rank 先判断；同 rank 以 roleId 升序）
- 预计算 `effective[nsIndex] = PermissionProgram | null`
- `effective` 的构建顺序是“从根到叶（祖先 -> 当前 role）”依次写入，因此**更接近用户的 role（子 role）的 grants 会覆盖祖先 grants**（覆盖语义由 `TrieBuilder` 保证）。
- 当 role grants 或 role 结构更新：重建该 role 子树（角色 adjacency + 子树遍历）

文件：`role_tree.ts`

用户：

- user overrides 稀疏：按需加载 grants 编译成 programs（TTL + LRU + negative cache）
- user roleIds：从 DB 取回后稳定排序缓存（TTL）

文件：`user_overrides_cache.ts`、`service.ts`

## 6. DB 设计与写入策略

表：

- `permission_roles`：roleId, parentRoleId, rank, updatedAt
- `permission_user_roles`：userId, roleId（unique）
- `permission_grants`：subjectType(user|role), subjectId, nsKey, kind(exact|star), local, effect(allow|deny), updatedAt（unique）

文件：`db/schemas.ts`、`grants_store.ts`

写入策略（强制）：

- 只能通过 `PermissionService.grant/revoke/assignRoleToUser/...` 写 DB
- grant/revoke 前必须通过 resolver 校验：
  - namespace 当前已加载
  - grant：节点当前已声明（**等值存在校验**：exact 必须 exact 声明；star 必须 star 声明；不要用 `declProgram.decide()` 做“覆盖即存在”）
    - 存在性校验的实现是 `hasExact/hasStar`（只看“该节点类型是否被声明”，不看默认 allow/deny），而不是 `decide()`
  - wildcard 语法合法
- revoke：不依赖 catalog 存在（允许清理离线/卸载插件遗留 grants）；只要求语法合法并能定位到 DB 行
- 写入后：
  - role：重建该 role 子树
  - user：invalidate user overrides cache

文件：`service.ts`

## 7. 指令侧接入（不污染权限核心）

权限核心不依赖 cmd。指令集成位于 `core/commands/kit.ts`：

- `PermRef`：稳定引用 `{ node, _ref? }`，其中 `_ref` 是可选的缓存 `NodeRef`（定义在 `ref.ts`）
- `CommandKit`：text/op 统一入口（推荐 `kit.command(...)` / `kit.op(...)`）
- `.perm(...)` 热路径（指令执行前）：
  - epoch 校验命中 => 直接 `authorizeUser(userId, NodeRef)`（不做字符串解析）
  - epoch 不匹配 => 重新 resolve 并更新 `PermRef._ref`
  - `_ref` 只是缓存提示：必须以 `nsEpoch` 校验为准；允许并发下重复 resolve（幂等）

建议模式（插件侧）：

```ts
import { Chatbots } from 'pluxel-plugin-bot-suite'
import { Type, obj } from '@pluxel/cmd'

class MyPlugin extends BasePlugin {
  constructor(private readonly chatbots: Chatbots) { super() }

  override init() {
    this.chatbots.cmd.command(
      { localId: 'reload', usage: 'reload' },
      (c) => c.handle(() => 'ok'),
    )
  }
}
```

需要位置参数映射时，显式写 `.args(map)`（内部会编译成 `text({ tail })`）：

```ts
chatbots.cmd.command(
  { localId: 'say', usage: 'say [...text]' },
  (c) =>
    c
      .input(obj({ text: Type.Array(Type.String()) }))
      .args((args) => ({ text: args }))
      .handle(({ text }) => text.join(' ')),
)
```

默认行为：
- `kit.command(...)`：默认 `perm=true`（等价于 `perm: true`），即自动绑定权限节点 `cmd.<localId>`。
- `kit.op(...)`：默认 `perm=true`（等价于 `perm: true`）。
- 如果不需要权限（例如公开指令 / 内置指令），显式写 `perm: false`。
- auto-declare（当节点尚未声明时）：
  - `declareExact(cmd.<localId>)`：默认效果由 Chatbots 配置 `cmdPermDefaultEffect` 控制（`allow|deny`）。
  - `declareStar(cmd.* / cmd.<group>.*)`：由 `cmdPermAutoDeclareStars` 控制，用于批量 grant。

可选：
- `chatbots.cmd.group('meme')`：为指令打统一 group（用于帮助/浏览过滤）。
- `chatbots.cmd.scope('meme')`：为 localId 自动加前缀（子命令写法），例如 `localId:'list'` => `meme.list`。

可选：当某些指令依赖可选能力（feature flag / optional deps）时，可用 `enabled` 在 install 时跳过：

```ts
if (cfg.debug) {
  chatbots.cmd.command({ localId: 'debug', triggers: ['debug'] }, (c) => c.handle(() => 'ok'))
}
```

相关文件：`core/commands/kit.ts`、`core/runtime/runtime.ts`、`core/plugin.ts`

## 8. 测试与基准

- 正确性测试：`test/permissions.runtime.test.ts`（基于 `@pluxel/hmr/test` + `MikroOrmLibsql`，尽可能模拟实机）
- 微基准：`test/permissions.bench.ts`（用于验证 trie decide 的常数开销；不参与构建）

## 9. 关键细节（避免踩坑）

- grants 唯一键：`(subjectType, subjectId, nsKey, kind, local)`；`effect` 是值字段（grant=upsert 更新 allow/deny）
- grants 字段规范化：
  - star grant 的 `local` **不带 `.*`**，只存 prefix（`command` 而不是 `command.*`）
  - root-star 统一存 `local=""`
  - exact grant 的 `local` 不能为空，且不允许包含 `*`
- Root-star `<ns>.*` 的 `localPrefix=""`，其 `path` 必须是空 `Uint32Array`；`PermissionProgram.decide()` 必须先检查 root star flags 才能生效
- 即使理论上不会出现 flag 同时存在，也保证 tie 语义为 Deny wins（Exact/Star 都是先 Deny 再 Allow）
- exact 命中优先于任何 prefix.* 命中（不比较深度，先判 exact 再回退到 star）

## 10. Trace / Explain（不影响热路径）

为了便于 UI/调试解释“为什么允许/拒绝”，提供独立的 explain API：

- `PermissionProgram.explain(path)`：返回该 program 内“哪个规则赢了”（exact/star/none + 深度/效果）
- `AuthEngine.authorizeWithTrace(...)` / `PermissionService.explainUser(...)`：返回“哪一层赢了”（user/role/declaration/default）以及对应的规则 node（例如 `ns.command.*`）

设计约束：

- **不影响热路径**：正常授权仍走 `decide()` + `authorizeUserSync()`；explain 走单独的方法，不在热路径里插入 trace 分支。
- explain 可能会分配字符串（用于拼 rule/node），属于 debug/UI 慢路径，允许更高常数开销。
