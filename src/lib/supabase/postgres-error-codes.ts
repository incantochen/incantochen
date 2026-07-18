/**
 * Postgres SQLSTATE 錯誤碼（經 PostgREST／supabase-js 以 `error.code` 字串回傳）。
 *
 * 單一出處供各處 import，取代手刻字面量比對（T132／F-018）——與 F-009／F-015
 * 「格式互轉單一出處」同型：若日後比對邏輯要調整（如一併攔 exclusion_violation、
 * 加 log、改 helper），只改這裡一處，不會漏掉散落各檔的某一份而悄悄失效。
 *
 * 參考：https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/** unique_violation：違反 UNIQUE 約束或 unique index（並發 insert 去重、on-conflict 兜底常用）。 */
export const PG_UNIQUE_VIOLATION = "23505";

/** foreign_key_violation：違反外鍵（如 cart.member_id 指向不存在的 member row，孤兒 auth user）。 */
export const PG_FOREIGN_KEY_VIOLATION = "23503";
