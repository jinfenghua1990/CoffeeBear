/** 全站统一的金额 / 日期格式化。各页面不得再内联 fmtMoney / formatDate 变体。 */

/** 金额：¥ + 千分位 + 2 位小数。空值（null/undefined/空串）显示 —（缺失数据显空值）；
 * 无法数值化的原始串原样返回，不虚构金额。 */
export function fmtMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 日期：截取 YYYY-MM-DD；空值显示 —。 */
export function fmtDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

/** 数量：千分位整数，最多 2 位小数；空值按 0 处理。 */
export function fmtQuantity(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : "—";
}
