import { configDefaults, defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // worktree（.claude/worktrees/）內是其他 session 進行中的半成品，
    // 不納入主專案測試，避免污染結果與 completion-check 誤判
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
})
