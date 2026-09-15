"use client";

import { ConsumableInventoryPanel } from "../inventory-panel";

export default function InventoryConsumablesPage() {
  return <div>
    <h1 className="text-xl font-semibold">库存 · 耗材</h1>
    <p className="mt-1 text-sm text-gray-400">耗材库存由本平台耗材入库单台账维护，按已配置实际仓库核算并保留在途；可用库存 ≤ 安全库存自动预警，耗材收货在采购工作台订单面板「耗材入库单」登记。</p>
    <ConsumableInventoryPanel />
  </div>;
}
