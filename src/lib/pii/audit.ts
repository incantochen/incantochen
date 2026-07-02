import "server-only";

/**
 * PII 存取稽核（T64）。
 * 依 docs/data-model.md 定案走應用層 log、不新增 DB 表：
 * 結構化 JSON 寫到 stdout，本機在終端機可見，production 由 Vercel function logs 收集。
 */
export function logPiiAccess(entry: {
  actorId: string;
  actorEmail: string;
  orderId: string;
  fields: string[];
}) {
  console.info(
    JSON.stringify({
      type: "pii_access",
      at: new Date().toISOString(),
      ...entry,
    })
  );
}
