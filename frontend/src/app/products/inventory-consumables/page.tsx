"use client";

import { ConsumableInventoryPanel } from "../inventory-panel";

export default function InventoryConsumablesPage() {
  return <div>
    <header className="app-page-header -mx-1 bg-[#f4f7fb]/95 pb-3 backdrop-blur">
      <h1 className="text-xl font-semibold">库存 · 耗材</h1>
      <p className="mt-1 text-sm text-gray-400">耗材入库以耗材采购单确认收货为准，按已配置实际仓库核算并保留在途；绑定正品的商品入库单确认耗用后形成耗材出库流水。可用库存 ≤ 安全库存自动预警。</p>
    </header>
    <ConsumableInventoryPanel />
  </div>;
}
