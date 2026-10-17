/**
 * 執行腳本時的安全提示（只在輸出層，不影響任何行為）。
 *
 * 背景（2026-10-16 實測）：`npm run <腳本> --apply` 這種寫法**不會**把 `--apply` 傳給腳本——
 * npm 會把 `--apply` 當作自己的選項吞掉，腳本因此以模擬模式執行並回報「將套用 N」，
 * 看起來像成功但一個字都沒有寫入。正確寫法是 `npm run <腳本> -- --apply`。
 *
 * 這裡在「以 npm 執行、沒有取得 `--apply`」時印出提示，令操作者不會把模擬模式當成已完成。
 */
export function warnIfNpmSwallowedApply(apply: boolean): void {
  if (apply || !process.env.npm_lifecycle_event) return;
  console.log(
    "提示：以 npm 執行時，參數要寫在 `--` 之後（例如 `npm run " +
      process.env.npm_lifecycle_event +
      " -- --apply`）。省略 `--` 會被 npm 吞掉，令本次執行維持模擬模式。",
  );
}
