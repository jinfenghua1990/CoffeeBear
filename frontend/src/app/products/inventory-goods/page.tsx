"use client";

import { GoodsInventoryPanel } from "../inventory-panel";

export default function InventoryGoodsPage() {
  return <div>
    <h1 className="text-xl font-semibold">库存 · 正品</h1>
    <p className="mt-1 text-sm text-gray-400">正品库存由本系统独立运算（采购入库 − 销售出库），按仓库名称分组；仓库分布与零库存货品一目了然。</p>
    <GoodsInventoryPanel />
  </div>;
}
