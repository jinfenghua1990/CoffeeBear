/**
 * 银行付款 ↔ 发票 核对状态徽标（全站统一）。
 *
 * 视觉规范（用户既定）：
 * - 已核对      绿实心
 * - 部分核对    琥珀实心
 * - 红冲后超额付款待处理  玫红实心
 * - 红冲超额已处理        浅绿描边
 * - 待核对      白底描边
 * - 无需核对    浅灰描边
 *
 * paid / matched 两个枚举值同义（不同接口历史命名），统一映射为「已核对」。
 * 页面内联的同名映射一律删除，统一引用本模块（组件 / 标签 / 样式三件套）。
 */
const STYLES: Record<string, { label: string; className: string }> = {
  paid: { label: "银行付款已核对", className: "bg-emerald-600 text-white shadow-sm" },
  matched: { label: "银行付款已核对", className: "bg-emerald-600 text-white shadow-sm" },
  partial: { label: "银行付款部分核对", className: "bg-amber-500 text-white" },
  overpaid_after_red: { label: "红冲后超额付款待处理", className: "bg-rose-600 text-white" },
  red_overpayment_settled: { label: "红冲超额已处理", className: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" },
  not_applicable: { label: "无需核对银行付款", className: "bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-200" },
};

const PENDING = { label: "待核对银行付款", className: "bg-white text-slate-500 ring-1 ring-inset ring-slate-300" };

const SIZES = {
  sm: "px-2 py-0.5 text-[10px] font-medium",
  md: "px-2.5 py-1 text-[11px] font-semibold",
};

export function bankReconciliationStatusLabel(status: string): string {
  return (STYLES[status] ?? PENDING).label;
}

export function bankReconciliationBadgeClass(status: string): string {
  return (STYLES[status] ?? PENDING).className;
}

export default function BankReconciliationBadge({
  status,
  size = "sm",
}: {
  status: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full ${SIZES[size]} ${bankReconciliationBadgeClass(status)}`}
    >
      {bankReconciliationStatusLabel(status)}
    </span>
  );
}
