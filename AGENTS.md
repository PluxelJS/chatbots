<INSTRUCTIONS>
本仓库要求在 `pluxel-workspace/` 多仓布局下使用：

- 源码依赖：`vendor/pluxel-template/{packages,plugins}` 会由 `sh ../scripts/link-template.sh` 自动生成（thin symlink tree）。
- Codex/LLM 工作流与 skills 以模板仓库为准（不要在本仓库复制一套）。

入口与规则请直接看：
- `../pluxel-template/AGENTS.md`
- `../pluxel-template/agents/skills/<skill>/SKILL.md`
</INSTRUCTIONS>
