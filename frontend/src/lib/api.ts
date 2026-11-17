/**
 * 业务 API 统一出口。
 *
 * 历史调用方一律从 "@/lib/api" 引入，此文件只做转发，不在此新增实现；
 * 具体实现按业务域拆分在 ./api/ 下，新增接口请进对应域文件。
 */

export * from "./api/client";
export * from "./api/auth";
export * from "./api/reconciliation";
export * from "./api/profit";
export * from "./api/dashboard";
export * from "./api/period";
export * from "./api/automation";
export * from "./api/jikeyun-import";
export * from "./api/partners";
export * from "./api/purchase-orders";
export * from "./api/jikeyun";
export * from "./api/tax";
export * from "./api/procurement-chain";
export * from "./api/procurement-execution";
export * from "./api/workbench";
export * from "./api/sku-matching";
export * from "./api/logistics";
