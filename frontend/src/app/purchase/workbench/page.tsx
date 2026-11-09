"use client";

import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { WORKBENCH_VIEWS, parseWorkbenchView, workbenchHref, type WorkbenchView } from "@/lib/workbench-navigation";
import { WorkspaceModule } from "./workspace-modules";
import { NewPurchaseModal } from "./new-purchase-modal";
import { RelatedRecordsPanel } from "./related-records-panel";
import { SearchableSelect } from "./searchable-select";
import { QuickTriage, canonicalChainOrderId } from "./quick-triage";
import { SupplyChainReplica, type SupplyChainChannelFilter, type SupplyChainKindFilter, type SupplyChainStatusFilter } from "./supply-chain-replica";
import { newRequestKey } from "@/lib/request-key";
import { useTabActive, useTabDirty, useTabRuntime, useWorkspace } from "@/lib/workspace/tab-store";
import { syncWorkspaceUrl } from "@/lib/workspace/url-sync";
import {
  authenticatedFetch,
  consumablesApi,
  dashboardApi,
  procurementChainApi,
  procurementWorkbenchApi,
  skuMatchingApi,
  warehousesApi,
  type CatalogSkuRow,
  type ConsumableMappingRow,
  type ConsumablePurchaseItem,
  type ConsumablePurchaseRow,
  type ConsumableRow,
  type InboundMatchSummary,
  type InvoiceReconciliation,
  type PendingAllocation,
  type SkuCandidate,
  type SyncJobRow,
  type ChainOrderRow,
  type ChainLinkCandidate,
  type ChainOverview,
  type ChainPurchaseOrder,
  type PendingLink,
  type WorkbenchOrder as WorkbenchOrderRow,
  type XrefPreview,
  type XrefApplyResult,
  type WorkbenchDetail,
  type WorkbenchOrderItem,
  type WorkbenchStepState,
  type WorkbenchSupplierDetail,
  type WorkbenchSupplierSummary,
  type WorkbenchSummary,
  type WarehouseRow,
} from "@/lib/api";
import { HeaderButton } from "./workbench-shared";
import { KpiGrid } from "./kpi-grid";
import { SupplierList, SupplierDetailPanel } from "./supplier-panel";
import { ChainPanel } from "./chain-panel";
import { MatchingView } from "./inbound-match";
import {
  ViewMode,
  FilterKey,
  ChainFilter,
  STANDALONE_VIEW_ROUTES,
  PO_STATUS,
  NEXT_STATUS,
  CIRCLED,
  DIM_DOT,
  STAGE_ACTION,
  IconName,
  AllocationRow,
  ModalConsumableItem,
  EditorConsumableDraft,
  PendingConsumableUpdate,
  ExpenseRow,
  SettlementRow,
  InboundRow,
  ChannelKey,
  CHANNELS,
  channelOf,
  PlatformBadge,
  OrderKindTag,
  cx,
  Link,
  fmtMoney,
  fmtQty,
  fmtDate,
  fmtDateTime,
  isOrderClosed,
  statusLabel,
  statusClass,
  exportOrders,
  Loading,
  Empty,
  Icon,
} from "./workbench-shared";

export default function PurchaseWorkbenchPage() {
  const searchParams = useSearchParams();
  const ws = useWorkspace();
  const tabId = useTabRuntime()?.tabId;
  // 隐藏 Tab 不响应全局 Esc：弹层状态要留在原地，等切回来继续用
  const tabActive = useTabActive();
  const [documentVisible, setDocumentVisible] = useState(true);
  const pageActive = tabActive && documentVisible;
  const initialView: ViewMode = (() => {
    const v = searchParams.get("view");
    return parseWorkbenchView(v);
  })();
  const initialOrderId = (() => {
    const raw = searchParams.get("order");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n !== 0 ? n : null;
  })();
  const initialKind: SupplyChainKindFilter = (() => {
    const kind = searchParams.get("kind");
    return kind === "goods" || kind === "consumable" ? kind : "all";
  })();
  const [view, setView] = useState<ViewMode>(initialView);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderId, setNewOrderId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Keep the active order table light enough for the detail panel and slower LAN clients.
  // Pagination remains unchanged; this only reduces the number of rows mounted at once.
  const pageSize = 20;
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null);
  const [orders, setOrders] = useState<WorkbenchOrderItem[]>([]);
  const [outstandingTotal, setOutstandingTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [suppliers, setSuppliers] = useState<WorkbenchSupplierSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId);
  const requestedOrder = useRef<number | null>(initialOrderId);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<WorkbenchDetail | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<WorkbenchSupplierDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterKey>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelKey>("all");
  const [kindFilter, setKindFilter] = useState<SupplyChainKindFilter>(initialKind);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get("q") ?? "");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [chainOverview, setChainOverview] = useState<ChainOverview | null>(null);
  const [chainOrders, setChainOrders] = useState<ChainOrderRow[]>([]);
  const [chainTotal, setChainTotal] = useState(0);
  const [chainPending, setChainPending] = useState<PendingLink[]>([]);
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [chainBusy, setChainBusy] = useState(false);
  const [inboundMatch, setInboundMatch] = useState<InboundMatchSummary | null>(null);
  const [pendingAlloc, setPendingAlloc] = useState<PendingAllocation[]>([]);
  const [matchingBusy, setMatchingBusy] = useState(false);
  // 订单 / 供应商 / 匹配 / 链路四个主视图共用 loading。
  // 用单一序号保证“最后一次请求”才允许写回，避免快速切换视图时旧请求覆盖当前页面。
  const viewRequestSeq = useRef(0);

  // 新建采购单弹窗开着时视为「有未保存内容」，关闭 Tab 需要二次确认
  useTabDirty(newOrderOpen);

  useEffect(() => {
    setView(parseWorkbenchView(searchParams.get("view")));
    const orderId = Number(searchParams.get("order"));
    // 订单 ID 是「文件订单取正数、纯工作流订单取 -id」，负数同样合法，这里只排除 0 和非法值。
    if (Number.isInteger(orderId) && orderId !== 0) { requestedOrder.current = orderId; setSelectedOrderId(orderId); }
    if (searchParams.get("action") === "new") {
      requestedOrder.current = null;
      setOperationsOpen(false);
      setSelectedOrderId(null);
      setOrderDetail(null);
      setNewOrderOpen(true);
    }
    const status = searchParams.get("status");
    if (["all", "refine", "po", "inbound", "invoice", "exception", "done"].includes(status ?? "")) {
      setStatusFilter(status as FilterKey);
    }
    const kind = searchParams.get("kind");
    // 地址里没有 kind 时保持用户当前选择：无脑回写成 all 会连带触发 setPage(1) + 列表重拉，
    // 点一张单却让整张列表闪一下就是这个副作用。
    if (kind === "goods" || kind === "consumable" || kind === "all") setKindFilter(kind);
  }, [searchParams]);

  useEffect(() => {
    const destination = STANDALONE_VIEW_ROUTES[view];
    if (destination) syncWorkspaceUrl(destination);
  }, [view]);

  // 顶部固定栏高度写入 CSS 变量，sticky 详情栏据此定位，避免遮挡或漏缝。
  // 工作区下多个 Tab 同时挂载：限定在本 Tab 面板内查找并写在本面板上，避免量到/影响别的 Tab。
  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  // 只让当前可见采购页测量顶部高度，避免隐藏页重复监听 resize。
  useEffect(() => {
    if (!pageActive) return;
    const panel = tabId ? document.querySelector<HTMLElement>(`[data-workspace-panel="${tabId}"]`) : null;
    const host = panel ?? document.documentElement;
    const el = panel?.querySelector<HTMLElement>("header.sticky") ?? panel?.querySelector<HTMLElement>("header") ?? document.querySelector<HTMLElement>("main header");
    if (!el) return;
    const update = () => host.style.setProperty("--wb-header-h", `${el.offsetHeight}px`);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [pageActive, view, tabId]);

  function changeView(next: ViewMode) {
    const standaloneRoute = STANDALONE_VIEW_ROUTES[next];
    if (standaloneRoute) {
      syncWorkspaceUrl(standaloneRoute, "push");
      return;
    }
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    params.delete("action");
    // 不要把「自动选中的订单」写进地址：它只是展示默认值，写进去会让切换视图凭空多出一个采购单页签。
    // 用户真正点过的订单在 selectOrder 里已经写进本 Tab 的地址，会原样保留。
    if (next !== "orders") params.delete("status");
    if (next === "suppliers") params.delete("order");
    syncWorkspaceUrl(`/purchase/workbench?${params.toString()}`, "push");
  }

  function selectOrder(orderId: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orders");
    params.set("order", String(orderId));
    params.delete("action");
    syncWorkspaceUrl(`/purchase/workbench?${params.toString()}`);
    setView("orders");
  }

  function changeKind(nextKind: SupplyChainKindFilter) {
    setKindFilter(nextKind);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (nextKind === "all") params.delete("kind");
    else params.set("kind", nextKind);
    syncWorkspaceUrl(`/purchase/workbench?${params.toString()}`);
  }

  // 页码重置必须和筛选变更在同一个事件里：如果靠 effect 事后补 setPage(1)，
  // 「筛选已改、页码还是旧的」会先发一次请求，页码回到 1 之后再发一次，白跑一趟。
  const changeStatusFilter = useCallback((next: FilterKey) => { setStatusFilter(next); setPage(1); }, []);
  const changeChannelFilter = useCallback((next: ChannelKey) => { setChannelFilter(next); setPage(1); }, []);
  const changeWarehouseFilter = useCallback((next: string) => { setWarehouseFilter(next); setPage(1); }, []);
  const changeStartDate = useCallback((next: string) => { setStartDate(next); setPage(1); }, []);
  const changeEndDate = useCallback((next: string) => { setEndDate(next); setPage(1); }, []);
  const applySearch = useCallback(() => { setQuery(searchDraft.trim()); setPage(1); }, [searchDraft]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await procurementWorkbenchApi.summary()); } catch { setSummary(null); }
  }, []);





  const loadOrders = useCallback(async () => {
    const seq = ++viewRequestSeq.current;
    setLoading(true);
    setError("");
    if (startDate && endDate && startDate > endDate) {
      if (seq === viewRequestSeq.current) {
        setOrders([]);
        setTotal(0);
        setError("开始日期不能晚于结束日期");
        setLoading(false);
      }
      return;
    }
    try {
      const result = await procurementWorkbenchApi.orders({
        status: statusFilter === "all" ? "all" : statusFilter === "refine" ? "sku" : statusFilter,
        q: query || undefined,
        page,
        pageSize,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        channel: channelFilter,
        kind: kindFilter,
        warehouse: warehouseFilter || undefined,
      });
      if (seq !== viewRequestSeq.current) return;
      const items = result.groups.flatMap((group) => group.items);
      setOrders(items);
      setTotal(result.total);
      setOutstandingTotal(result.invoiceOutstandingTotal ?? 0);
      const requested = requestedOrder.current;
      requestedOrder.current = null;
      setSelectedOrderId((current) => requested ?? items.find(item => item.orderId === current)?.orderId ?? items[0]?.orderId ?? null);
    } catch (caught) {
      if (seq !== viewRequestSeq.current) return;
      setOrders([]);
      setTotal(0);
      setOutstandingTotal(0);
      // 后端会带具体原因（日期区间非法、参数校验失败等），照原样透出去；
      // 一律显示「请刷新后重试」等于把故障原因藏起来，用户只能干等。
      const reason = caught instanceof Error && caught.message && !/^Failed to fetch$/i.test(caught.message)
        ? caught.message
        : "";
      setError(reason ? `订单数据加载失败：${reason}` : "订单数据加载失败，请检查网络后重试");
    } finally {
      if (seq === viewRequestSeq.current) setLoading(false);
    }
  }, [channelFilter, endDate, kindFilter, query, startDate, statusFilter, warehouseFilter, page]);

  const loadSuppliers = useCallback(async () => {
    const seq = ++viewRequestSeq.current;
    setLoading(true);
    setError("");
    try {
      const result = await procurementWorkbenchApi.suppliers(200);
      if (seq !== viewRequestSeq.current) return;
      setSuppliers(result.items);
      setSelectedSupplierName((current) => {
        if (result.items.length === 0) return null;
        return current && result.items.some((item) => item.supplierName === current)
          ? current
          : result.items[0].supplierName;
      });
    } catch {
      if (seq !== viewRequestSeq.current) return;
      setSuppliers([]);
      setSelectedSupplierName(null);
      setError("供应商数据加载失败，请刷新后重试");
    } finally {
      if (seq === viewRequestSeq.current) setLoading(false);
    }
  }, []);

  const loadMatching = useCallback(async () => {
    const seq = ++viewRequestSeq.current;
    setLoading(true);
    setError("");
    try {
      const [match, pending] = await Promise.all([
        skuMatchingApi.inboundSummary(),
        skuMatchingApi.pending(100),
      ]);
      if (seq !== viewRequestSeq.current) return;
      setInboundMatch(match);
      setPendingAlloc(pending);
    } catch {
      if (seq === viewRequestSeq.current) setError("匹配数据加载失败，请刷新后重试");
    } finally {
      if (seq === viewRequestSeq.current) setLoading(false);
    }
  }, []);

  const runInboundAuto = useCallback(async () => {
    setMatchingBusy(true);
    setError("");
    try {
      const result = await skuMatchingApi.runInboundAuto();
      const s = result.stats;
      setNotice(`入库自动匹配完成：共 ${s.total} 条，金额校验通过 ${s.price_ok}，金额异常 ${s.price_mismatch}，人工结果保留 ${s.manual ?? 0}`);
      await loadMatching();
    } catch {
      setError("自动匹配执行失败，请重试");
    } finally {
      setMatchingBusy(false);
    }
  }, [loadMatching]);

  const loadChain = useCallback(async () => {
    const seq = ++viewRequestSeq.current;
    setLoading(true);
    setError("");
    try {
      const result = await procurementChainApi.workspace(500);
      if (seq !== viewRequestSeq.current) return;
      setChainOverview(result.overview);
      setChainOrders(result.orders.items);
      setChainTotal(result.orders.total);
      setChainPending(result.pending.items);
    } catch {
      if (seq !== viewRequestSeq.current) return;
      setChainOverview(null);
      setChainOrders([]);
      setChainPending([]);
      setError("链路数据加载失败，请刷新后重试");
    } finally {
      if (seq === viewRequestSeq.current) setLoading(false);
    }
  }, []);

  async function confirmChainLink(kind: string, linkId: number) {
    setChainBusy(true);
    try {
      if (kind === "invoice") await procurementChainApi.confirmInvoiceLink(linkId);
      else await procurementChainApi.confirmLink(linkId);
      setNotice("关联已确认");
      await loadChain();
    } catch (caught) {
      setNotice("确认失败：" + String(caught));
    } finally {
      setChainBusy(false);
    }
  }

  async function rejectChainLink(kind: string, linkId: number) {
    setChainBusy(true);
    try {
      if (kind === "invoice") await procurementChainApi.deleteInvoiceLink(linkId);
      else await procurementChainApi.deleteLink(linkId);
      setNotice("关联建议已拒绝");
      await loadChain();
    } catch (caught) {
      setNotice("拒绝失败：" + String(caught));
    } finally {
      setChainBusy(false);
    }
  }

  useEffect(() => {
    if (!pageActive) return;
    // summary 与当前子视图无关；只在页面重新激活时加载，业务动作完成后再显式刷新。
    void loadSummary();
  }, [loadSummary, pageActive]);

  useEffect(() => {
    if (!pageActive) return;
    if (view === "orders") void loadOrders();
    else if (view === "chain") void loadChain();
    else if (view === "matching") void loadMatching();
    else if (view === "suppliers") void loadSuppliers();
  }, [loadChain, loadMatching, loadOrders, loadSuppliers, pageActive, view]);

  // 换单时不再把 detail 清空：先 setOrderDetail(null) 会让详情区先塌成
  // 「正在读取订单明细…」占位、数据回来再撑开，点一次就闪两下。
  // 现在保留上一张单的内容，等新数据到了原地替换（顶部细进度条由 detailLoading 驱动）。
  useEffect(() => {
    if (!pageActive) return;
    if (view !== "orders" || selectedOrderId === null) {
      setOrderDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    procurementWorkbenchApi.workbench(selectedOrderId)
      .then((detail) => { if (!cancelled) setOrderDetail(detail); })
      .catch(() => {
        if (cancelled) return;
        setOrderDetail(null);
        setError("订单明细加载失败，请点「同步最新」重试");
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [pageActive, selectedOrderId, view]);

  // 与订单详情同一套处理：切供应商保留上一家的画像，新数据到了原地替换，
  // 否则画像区会先塌成「正在加载供应商画像…」再撑开，点一下就闪两下。
  useEffect(() => {
    if (!pageActive) return;
    if (view !== "suppliers" || !selectedSupplierName) {
      setSupplierDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    procurementWorkbenchApi.supplierDetail(selectedSupplierName)
      .then((detail) => { if (!cancelled) setSupplierDetail(detail); })
      .catch(() => { if (!cancelled) setSupplierDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [pageActive, selectedSupplierName, view]);

  async function runMatch() {
    setBusyAction("match");
    try {
      const result = await procurementChainApi.runMatch();
      const autoConfirm = result.autoConfirm as { confirmedChain?: number; confirmedInvoices?: number; resolvedInboundUsage?: number } | undefined;
      const created = Number(result.created ?? 0);
      const confirmed = Number(autoConfirm?.confirmedChain ?? 0) + Number(autoConfirm?.confirmedInvoices ?? 0);
      const parts = [`自动化完成：新建 ${created} 条关联`];
      if (confirmed > 0) parts.push(`确认 ${confirmed} 条订单/发票关联`);
      if (Number(autoConfirm?.resolvedInboundUsage ?? 0) > 0) parts.push(`自动处理 ${autoConfirm?.resolvedInboundUsage} 条入库耗材流水`);
      setNotice(parts.join("，"));
      await Promise.all([
        loadSummary(),
        ...(view === "orders" || view === "chain" ? [] : [loadChain()]),
        view === "orders" ? loadOrders() : view === "chain" ? loadChain() : view === "matching" ? loadMatching() : loadSuppliers(),
      ]);
    } catch (caught) {
      setNotice("生成匹配建议失败：" + String(caught));
    } finally {
      setBusyAction("");
    }
  }

  async function runPrelink(auto: boolean) {
    setBusyAction("prelink");
    try {
      const result = await procurementChainApi.prelink(auto);
      const s = result.stats;
      const parts: string[] = [];
      if (s.autoLinked > 0) parts.push(`自动关联并确认 ${s.autoLinked} 条`);
      if (s.pendingSuggested > 0) parts.push(`生成 ${s.pendingSuggested} 条待人工确认`);
      if (parts.length === 0) parts.push("无新增候选（订单有 SKU 分配后会继续按重合度自动处理）");
      setNotice("预关联完成：" + parts.join("，"));
      await Promise.all([loadChain(), loadSummary()]);
    } catch (caught) {
      setNotice("预关联失败：" + String(caught));
    } finally {
      setBusyAction("");
    }
  }

  async function chainManualLink(orderId: number, targetId: number) {
    setChainBusy(true);
    try {
      await procurementChainApi.manualLink(orderId, "inbound", targetId, "链路建链视图人工选择入库单");
      setNotice("已关联入库单");
      await loadChain();
    } catch (caught) {
      setNotice("关联失败：" + String(caught));
    } finally {
      setChainBusy(false);
    }
  }

  async function refresh() {
    setBusyAction("refresh");
    await Promise.all([
      loadSummary(),
      ...(view === "orders" || view === "chain" ? [] : [loadChain()]),
      view === "orders" ? loadOrders() : view === "chain" ? loadChain() : view === "matching" ? loadMatching() : loadSuppliers(),
    ]);
    setNotice("采购订单已刷新");
    setBusyAction("");
  }

  const refreshSelectedOrder = useCallback(async () => {
    const targetOrderId = selectedOrderId ?? newOrderId;
    if (targetOrderId === null) return;
    setDetailLoading(true);
    try {
      const nextDetail = await procurementWorkbenchApi.workbench(targetOrderId);
      setOrderDetail(nextDetail);
      await Promise.all([loadSummary(), loadOrders()]);
    } finally {
      setDetailLoading(false);
    }
  }, [loadOrders, loadSummary, newOrderId, selectedOrderId]);

  const openOperations = useCallback((orderId?: number) => {
    if (orderId != null && orderId !== selectedOrderId) {
      selectOrder(orderId);
    }
    setOperationsOpen(true);
  }, [selectedOrderId]);

  useEffect(() => {
    if (!operationsOpen || !tabActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOperationsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [operationsOpen, tabActive]);

  const resetSupplyChainFilters = useCallback(() => {
    setStatusFilter("all");
    setChannelFilter("all");
    setKindFilter("all");
    setWarehouseFilter("");
    setStartDate("");
    setEndDate("");
    setQuery("");
    setSearchDraft("");
    setPage(1);
  }, []);

  const exportCurrentPurchaseOrders = useCallback(async () => {
    setBusyAction("export");
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({
        status: statusFilter === "refine" ? "sku" : statusFilter,
        channel: channelFilter,
        kind: kindFilter,
      });
      if (query) params.set("q", query);
      if (warehouseFilter) params.set("warehouse", warehouseFilter);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const response = await authenticatedFetch(`/api/v1/data/export/purchase_orders?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload?.detail === "string" ? payload.detail : `导出失败（${response.status}）`);
      }
      const blob = await response.blob();
      const encodedName = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : `采购订单-核验-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = response.headers.get("x-export-row-count");
      setNotice(`采购订单核验包已导出${count ? `（${count} 条主记录）` : ""}，包含主单、采购明细和入库关联。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAction("");
    }
  }, [channelFilter, endDate, kindFilter, query, startDate, statusFilter, warehouseFilter]);

  // 订单被删除后：清掉选中项与 URL 上的 order 参数，重新拉列表（loadOrders 会自动选中下一张）。
  const removeDeletedOrder = useCallback(async () => {
    requestedOrder.current = null;
    setSelectedOrderId(null);
    setOrderDetail(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orders");
    params.delete("order");
    params.delete("action");
    // 交给工作区改写当前 Tab 的地址：若工作台列表 Tab 已存在则回到它，否则就地变成列表
    syncWorkspaceUrl(ws.retarget(`/purchase/workbench?${params}`));
    await Promise.all([loadSummary(), loadOrders()]);
  }, [loadOrders, loadSummary, searchParams, ws]);

  const closeNewOrder = useCallback(() => {
    setNewOrderOpen(false);
    setNewOrderId(null);
    setOperationsOpen(false);
    requestedOrder.current = null;
    setSelectedOrderId(null);
    setOrderDetail(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    params.delete("order");
    syncWorkspaceUrl(ws.retarget(`/purchase/workbench${params.toString() ? `?${params}` : ""}`));
  }, [searchParams, ws]);

  const openNewOrder = useCallback(() => {
    setOperationsOpen(false);
    requestedOrder.current = null;
    setSelectedOrderId(null);
    setOrderDetail(null);
    setNewOrderId(null);
    setNewOrderOpen(true);
  }, []);

  const handleNewOrderCreated = useCallback((orderId: number, notice?: string) => {
    // 新建后的完整录入只留在 NewPurchaseModal 内，不能再把同一订单选到列表下方详情区。
    requestedOrder.current = null;
    setNewOrderId(orderId);
    setSelectedOrderId(null);
    setOrderDetail(null);
    setDetailLoading(true);
    resetSupplyChainFilters();
    setNotice(notice || "基础信息已保存，当前窗口已进入完整采购订单录入");
    void Promise.all([loadOrders(), loadSummary()]);
    void procurementWorkbenchApi.workbench(orderId)
      .then((detail) => setOrderDetail(detail))
      .catch(() => {
        setOrderDetail(null);
        setError("新建订单详情加载失败，请刷新后重试");
      })
      .finally(() => setDetailLoading(false));
  }, [loadOrders, loadSummary, resetSupplyChainFilters]);

  function renderNewOrderEditor(orderId: number) {
    const createdDetail = orderDetail?.order.orderId === orderId ? orderDetail : null;
    return (
      <OrderDetailPanel
        key={orderId}
        detail={createdDetail}
        loading={detailLoading || createdDetail == null}
        onOrderChanged={refreshSelectedOrder}
        onOrderDeleted={(message) => { setNotice(message); closeNewOrder(); void removeDeletedOrder(); }}
        onOpenSupplier={(name) => { closeNewOrder(); setSelectedSupplierName(name); changeView("suppliers"); }}
        onCloseDialog={closeNewOrder}
      />
    );
  }

  const filteredSuppliers = useMemo(() => {
    const normalized = supplierQuery.trim().toLowerCase();
    return normalized ? suppliers.filter((supplier) => supplier.supplierName.toLowerCase().includes(normalized)) : suppliers;
  }, [supplierQuery, suppliers]);

  const newPurchaseDialog = newOrderOpen ? <NewPurchaseModal
    onClose={closeNewOrder}
    createdOrderId={newOrderId}
    renderCreated={renderNewOrderEditor}
    onCreated={handleNewOrderCreated}
  /> : null;

  if (view === "orders") {
    return (
      <>
        <SupplyChainReplica
          summary={summary}
          orders={orders}
          total={total}
          page={page}
          pageSize={pageSize}
          selectedOrderId={newOrderOpen ? null : selectedOrderId}
          detail={newOrderOpen ? null : orderDetail}
          loading={loading}
          detailLoading={detailLoading}
          pendingOrderId={newOrderOpen ? null : selectedOrderId}
          refreshBusy={busyAction === "refresh"}
          exportBusy={busyAction === "export"}
          statusFilter={statusFilter}
          channelFilter={channelFilter}
          kindFilter={kindFilter}
          warehouseFilter={warehouseFilter}
          startDate={startDate}
          endDate={endDate}
          searchDraft={searchDraft}
          onStatusFilterChange={changeStatusFilter}
          onChannelFilterChange={changeChannelFilter}
          onKindFilterChange={changeKind}
          onWarehouseFilterChange={changeWarehouseFilter}
          onStartDateChange={changeStartDate}
          onEndDateChange={changeEndDate}
          onSearchDraftChange={setSearchDraft}
          onApplySearch={applySearch}
          onReset={resetSupplyChainFilters}
          onNewOrder={openNewOrder}
          onExport={exportCurrentPurchaseOrders}
          onRefresh={refresh}
          onSelectOrder={selectOrder}
          onPageChange={(nextPage) => setPage(nextPage)}
          onOpenOperations={openOperations}
          onCloseOperations={() => setOperationsOpen(false)}
          operationsOpen={operationsOpen}
          onOpenWorkbenchView={(nextView) => changeView(nextView)}
          selectedOrderIds={[]}
          alibaba1688Job={null}
          onOpenExceptions={() => changeView("exceptions")}
          onToggleOrder={() => {}}
          onToggleAllVisible={() => {}}
          onClearOrderSelection={() => {}}
          onDeleteSelected={() => {}}
          deleteBusy={false}
        />
        {(notice || error) && <div className="fixed bottom-5 right-5 z-toast max-w-md rounded-lg border border-blue-100 bg-white px-4 py-3 text-[12px] text-slate-700 shadow-xl"><div className="flex items-start gap-3"><span className={error ? "text-rose-600" : "text-blue-600"}>{error || notice}</span><button onClick={() => { setNotice(""); setError(""); }} className="shrink-0 text-slate-400 hover:text-slate-700">×</button></div></div>}
        {operationsOpen && <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto bg-slate-950/35 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setOperationsOpen(false); }} role="dialog" aria-modal="true" aria-label="编辑采购订单">
          <div className="my-auto flex h-[90vh] w-full max-w-[1440px] max-h-[calc(100vh-32px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f7f9fd] shadow-2xl">
            <div className="flex min-h-0 flex-1 flex-col"><OrderDetailPanel detail={orderDetail?.order.orderId === selectedOrderId ? orderDetail : null} loading={detailLoading} onOrderChanged={refreshSelectedOrder} onOrderDeleted={(message) => { setNotice(message); setOperationsOpen(false); void removeDeletedOrder(); }} onOpenSupplier={(name) => { setOperationsOpen(false); setSelectedSupplierName(name); changeView("suppliers"); }} onCloseDialog={() => setOperationsOpen(false)} /></div>
          </div>
        </div>}
        {newPurchaseDialog}
      </>
    );
  }

  if (STANDALONE_VIEW_ROUTES[view]) return null;

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-[#26324b]">
      <div className="min-w-0 px-5 pb-8 pt-5 sm:px-6 2xl:px-7">
          {!(["orders", "suppliers", "chain", "matching"] as ViewMode[]).includes(view) && (
            <select aria-label="工作台功能导航" className="mb-3 w-full rounded-lg border border-slate-200 bg-white p-2 lg:hidden" value={view} onChange={event => changeView(event.target.value as ViewMode)}>
              {Object.entries(WORKBENCH_VIEWS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          )}
          <WorkbenchHeader
            view={view}
            busyAction={busyAction}
            onViewChange={changeView}
            onNewOrder={openNewOrder}
            onMatch={runMatch}
            onRefresh={refresh}
            onExport={() => exportOrders(orders)}
          />
          {notice && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-700">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} className="text-lg leading-none text-indigo-400 hover:text-indigo-700">×</button>
            </div>
          )}
          {error && <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}
          {["orders", "suppliers", "chain", "matching"].includes(view) && (
            <KpiGrid
              summary={summary}
              onOpenChain={() => changeView("chain")}
            />
          )}

          {view === "chain" ? (
            <ChainPanel
              overview={chainOverview}
              orders={chainOrders}
              total={chainTotal}
              pending={chainPending}
              filter={chainFilter}
              loading={loading}
              busy={chainBusy}
              prelinkBusy={busyAction === "prelink"}
              xrefBusy={busyAction === "xref"}
              onFilterChange={setChainFilter}
              onConfirm={confirmChainLink}
              onReject={rejectChainLink}
              onPrelink={runPrelink}
              onManualLink={chainManualLink}
              onReload={loadChain}
              onNotice={setNotice}
              onStageView={changeView}
            />
          ) : view === "matching" ? (
            <MatchingView
              summary={inboundMatch}
              pending={pendingAlloc}
              busy={matchingBusy}
              loading={loading}
              onRunAuto={runInboundAuto}
              onRefresh={loadMatching}
              onNotice={setNotice}
              onOpenOrder={selectOrder}
            />
          ) : view === "suppliers" ? (
            <div className="mt-5 grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(520px,1fr)]">
              <SupplierList
                suppliers={filteredSuppliers}
                loading={loading}
                query={supplierQuery}
                selectedName={selectedSupplierName}
                onQueryChange={setSupplierQuery}
                onSelect={setSelectedSupplierName}
              />
              <SupplierDetailPanel
                detail={supplierDetail}
                loading={detailLoading}
                pendingName={selectedSupplierName}
                onRenamed={async (newName) => {
                  setSelectedSupplierName(newName);
                  await loadSuppliers();
                }}
              />
            </div>
          ) : <WorkspaceModule key={view} view={view} />}
      </div>
      {newPurchaseDialog}
    </div>
  );
}

function WorkbenchHeader({ view, busyAction, onViewChange, onNewOrder, onMatch, onRefresh, onExport }: {
  view: ViewMode;
  busyAction: string;
  onViewChange: (view: ViewMode) => void;
  onNewOrder: () => void;
  onMatch: () => void;
  onRefresh: () => void;
  onExport: () => void;
}) {
  if (!["orders", "suppliers", "chain", "matching"].includes(view)) return (
    <header className="flex items-center justify-between gap-4"><div><p className="text-xs text-slate-400">电商经营数据平台 / {WORKBENCH_VIEWS[view]}</p><h1 className="mt-1 text-2xl font-semibold">{WORKBENCH_VIEWS[view]}</h1></div><HeaderButton icon="orders" onClick={() => onViewChange("orders")}>返回采购订单</HeaderButton></header>
  );
  return (
    <header className="sticky top-12 z-30 -mx-5 -mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/60 bg-[#f7f8fc] px-5 pb-3 pt-5 sm:-mx-6 sm:px-6 2xl:-mx-7 2xl:px-7">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="mb-1 text-[10px] text-slate-400">采购中心　/　采购订单</div>
          <div className="flex items-baseline gap-4">
            <h1 className="text-[25px] font-semibold tracking-tight text-slate-900">采购订单</h1>
            <p className="hidden text-[12px] text-slate-400 2xl:block">按下单时间组织采购主单，并关联生产、到仓、开票与付款状态</p>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 2xl:hidden">以订单时间为主线，高效推进采购全流程</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          <ViewButton active={view === "orders"} onClick={() => onViewChange("orders")} icon="orders">订单视图</ViewButton>
          <ViewButton active={view === "suppliers"} onClick={() => onViewChange("suppliers")} icon="users">供应商维度</ViewButton>
          <ViewButton active={view === "chain"} onClick={() => onViewChange("chain")} icon="chart">链路建链</ViewButton>
          <ViewButton active={view === "matching"} onClick={() => onViewChange("matching")} icon="box">SKU 匹配</ViewButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HeaderLink href="/data-center-import" icon="import">数据接入</HeaderLink>
        <HeaderButton onClick={onNewOrder} icon="plus">新建采购记录</HeaderButton>
        <HeaderButton icon="magic" primary busy={busyAction === "match"} onClick={onMatch}>自动匹配并确认</HeaderButton>
        <HeaderButton icon="download" onClick={onExport}>导出</HeaderButton>
        <HeaderButton icon="refresh" busy={busyAction === "refresh"} onClick={onRefresh}>刷新</HeaderButton>
      </div>
    </header>
  );
}

function ViewButton({ active, icon, onClick, children }: { active: boolean; icon: IconName; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={cx(
      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
      active ? "bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200" : "text-slate-500 hover:bg-slate-50"
    )}><Icon name={icon} size={14} />{children}</button>
  );
}

function HeaderLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return <Link href={workbenchHref(href)} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50"><Icon name={icon} size={15} />{children}</Link>;
}



function OrderDetailPanel({ detail, loading, onOrderChanged, onOrderDeleted, onOpenSupplier, onCloseDialog }: {
  detail: WorkbenchDetail | null;
  loading: boolean;
  onOrderChanged: () => Promise<void>;
  onOrderDeleted: (message: string) => void;
  onOpenSupplier: (name: string) => void;
  onCloseDialog?: () => void;
}) {
  const [skuEditorOpen, setSkuEditorOpen] = useState(false);
  const panelSearchParams = useSearchParams();
  const panelWorkspace = useWorkspace();
  const [skuEditorTargetDoc, setSkuEditorTargetDoc] = useState<number | null>(null);
  const [skuCatalog, setSkuCatalog] = useState<CatalogSkuRow[]>([]);
  const [skuCatalogLoading, setSkuCatalogLoading] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null);
  const [skuEntry, setSkuEntry] = useState("");
  const [skuQty, setSkuQty] = useState("1");
  const [skuTotal, setSkuTotal] = useState("");
  const [skuConsumableId, setSkuConsumableId] = useState<number | null>(null);
  const [skuConsumableEntry, setSkuConsumableEntry] = useState("");
  const [skuConsumableQty, setSkuConsumableQty] = useState("");
  const [skuConsumableAutoQty, setSkuConsumableAutoQty] = useState(false);
  const [skuConsumableExempt, setSkuConsumableExempt] = useState(false);
  const [skuConsumableTouched, setSkuConsumableTouched] = useState(false);
  const [pendingConsumableUpdate, setPendingConsumableUpdate] = useState<PendingConsumableUpdate | null>(null);
  const [skuAction, setSkuAction] = useState("");
  const [editingAllocation, setEditingAllocation] = useState<number | null>(null);
  const [skuMessage, setSkuMessage] = useState("");
  const [expenseType, setExpenseType] = useState("pack");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseMessage, setExpenseMessage] = useState("");
  const [adjEditing, setAdjEditing] = useState(false);
  const [adjValue, setAdjValue] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [inboundEditorOpen, setInboundEditorOpen] = useState(false);
  const [inboundCandidates, setInboundCandidates] = useState<ChainLinkCandidate[]>([]);
  const [inboundCandidateLoading, setInboundCandidateLoading] = useState(false);
  const [inboundQuery, setInboundQuery] = useState("");
  const [selectedInboundId, setSelectedInboundId] = useState<number | null>(null);
  const [replaceInboundLinkId, setReplaceInboundLinkId] = useState<number | null>(null);
  const [inboundMessage, setInboundMessage] = useState("");
  const autoLinkedInboundQuery = useRef("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [usageMaterials, setUsageMaterials] = useState<ConsumableRow[]>([]);
  const [usageMappings, setUsageMappings] = useState<ConsumableMappingRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [docAmountBusy, setDocAmountBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [poMessage, setPoMessage] = useState("");
  const [poEditorOpen, setPoEditorOpen] = useState(false);
  const [poListOpen, setPoListOpen] = useState(false);
  const [poLinkNo, setPoLinkNo] = useState("");
  const [poRelationKind, setPoRelationKind] = useState("");
  const [poAllocAmount, setPoAllocAmount] = useState("");
  const [mainSaving, setMainSaving] = useState(false);
  const [mainError, setMainError] = useState("");
  const [mainForm, setMainForm] = useState({ orderNo: "", supplier: "", title: "", date: "", goods: "", freight: "", discount: "", paid: "", orderAmount: "", platform: "other", warehouseId: "", buyer: "", purchaseStatus: "" });
  const [inboundNoEntry, setInboundNoEntry] = useState("");
  const [expandedConsumables, setExpandedConsumables] = useState<number[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [consumablePurchaseRows, setConsumablePurchaseRows] = useState<ConsumablePurchaseRow[]>([]);
  const [editingConsumable, setEditingConsumable] = useState<ModalConsumableItem | null>(null);
  const [consumableEditQty, setConsumableEditQty] = useState("");
  const [consumableEditTotal, setConsumableEditTotal] = useState("");
  const [consumableEditBusy, setConsumableEditBusy] = useState(false);



  useEffect(() => {
    setSkuEditorOpen(false);
    setSelectedSkuId(null);
    setSkuEntry("");
    setSkuQty("1");
    setSkuTotal("");
    setSkuConsumableId(null);
    setSkuConsumableEntry("");
    setSkuConsumableQty("");
    setSkuConsumableAutoQty(false);
    setSkuConsumableExempt(false);
    setSkuConsumableTouched(false);
    setPendingConsumableUpdate(null);
    setSkuMessage("");
    setExpenseAmount("");
    setExpenseMessage("");
    setEditingAllocation(null);
    setInboundEditorOpen(false);
    setInboundCandidates([]);
    setInboundQuery("");
    setSelectedInboundId(null);
    setReplaceInboundLinkId(null);
    setInboundMessage("");
    setUsageMaterials([]);
    setUsageMappings([]);
    // 注意：order 在组件后段才解构（detail 非空分支），此处用 detail?.order 避免早退分支下 TDZ 崩溃
    setPoEditorOpen(false);
    setPoListOpen(false);
    setPoMessage("");
    setPoLinkNo("");
    setPoRelationKind("");
    setPoAllocAmount("");
    setMainSaving(false);
    setMainError("");
    setConsumablePurchaseRows([]);
    setEditingConsumable(null);
    setConsumableEditQty("");
    setConsumableEditTotal("");
    const initialOrder = detail?.order;
    const initialWarehouseId = detail?.warehouse?.warehouseId ?? detail?.warehouse?.targetWarehouseId ?? initialOrder?.warehouseId;
    setMainForm({
      orderNo: initialOrder?.orderNo ?? "",
      supplier: initialOrder?.supplier ?? "",
      title: initialOrder?.title ?? "",
      date: initialOrder?.orderDate ? fmtDate(initialOrder.orderDate) : "",
      goods: initialOrder?.goodsTotal != null ? String(initialOrder.goodsTotal) : "",
      freight: initialOrder?.freight != null ? String(initialOrder.freight) : "",
      discount: initialOrder?.discount != null ? String(initialOrder.discount) : "",
      paid: initialOrder?.paidAmount != null ? String(initialOrder.paidAmount) : "",
      orderAmount: initialOrder?.amount != null ? String(initialOrder.amount) : "",
      platform: initialOrder?.platform ?? "other",
      warehouseId: initialWarehouseId != null ? String(initialWarehouseId) : "",
      buyer: initialOrder?.buyer ?? "",
      purchaseStatus: initialOrder?.purchaseStatus ?? "",
    });
    setInboundNoEntry(((detail?.detail?.inbound ?? []) as InboundRow[]).find((row) => row.goodsdocNo)?.goodsdocNo ?? detail?.order.inboundReferenceNo ?? "");
    setExpandedConsumables([]);

  }, [detail?.order.orderId, detail?.order.orderNo]);

  useEffect(() => {
    let cancelled = false;
    const orderNo = detail?.order.orderNo;
    if (!orderNo || detail?.order.orderKind === "goods") {
      setConsumablePurchaseRows([]);
      return () => { cancelled = true; };
    }
    consumablesApi.purchases("", undefined, orderNo)
      .then((rows) => {
        if (!cancelled) setConsumablePurchaseRows(rows);
      })
      .catch(() => { if (!cancelled) setConsumablePurchaseRows([]); });
    return () => { cancelled = true; };
  }, [detail?.order.orderId, detail?.order.orderKind, detail?.order.orderNo]);

  useEffect(() => {
    let cancelled = false;
    setSkuCatalogLoading(true);
    dashboardApi.products("", 500)
      .then(rows => { if (!cancelled) setSkuCatalog(rows); })
      .catch(() => { if (!cancelled) setSkuMessage("吉客云 SKU 主档加载失败，请重新打开分配重试"); })
      .finally(() => { if (!cancelled) setSkuCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.order.orderId]);

  useEffect(() => {
    const orderId = detail?.order.orderId;
    if (!inboundEditorOpen || !orderId) return;
    let cancelled = false;
    setInboundCandidateLoading(true);
    procurementChainApi.candidates(orderId, "inbound", inboundQuery, 500)
      .then((result) => { if (!cancelled) setInboundCandidates(result.items); })
      .catch(() => { if (!cancelled) setInboundMessage("入库单候选加载失败，请刷新后重试"); })
      .finally(() => { if (!cancelled) setInboundCandidateLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.order.orderId, inboundEditorOpen, inboundQuery]);

  useEffect(() => {
    let cancelled = false;
    setUsageLoading(true);
    Promise.all([consumablesApi.list(), consumablesApi.mappings()])
      .then(([materials, mappings]) => {
        if (!cancelled) { setUsageMaterials(materials); setUsageMappings(mappings); }
      })
      .catch(() => { if (!cancelled) setInboundMessage("耗材档案加载失败，请刷新后重试"); })
      .finally(() => { if (!cancelled) setUsageLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.order.orderId]);

  useEffect(() => {
    let active = true;
    warehousesApi.list(false)
      .then((rows) => { if (active) setWarehouses(rows.filter((row) => row.status === "active")); })
      .catch(() => { if (active) setMainError("仓库配置加载失败，请刷新后重试"); });
    return () => { active = false; };
  }, [detail?.order.orderId]);

  // 详情数据先为空、后加载完成时也必须保持 Hook 顺序不变，否则 React 会报 Hook 顺序错误。
  const inboundCount = detail?.detail.inbound.length ?? 0;
  useEffect(() => {
    const query = inboundQuery.trim().toLowerCase();
    if (!inboundEditorOpen || !query || inboundCandidateLoading || editorBusy || inboundCount > 0) return;
    const exactMatches = inboundCandidates.filter((candidate) => candidate.targetNo.trim().toLowerCase() === query);
    if (exactMatches.length !== 1 || autoLinkedInboundQuery.current === query) return;
    const exact = exactMatches[0];
    autoLinkedInboundQuery.current = query;
    setSelectedInboundId(exact.targetId);
    setInboundNoEntry(exact.targetNo);
    setInboundEditorOpen(false);
    void saveInboundLink(exact.targetId);
  }, [editorBusy, inboundCandidateLoading, inboundCandidates, inboundCount, inboundEditorOpen, inboundQuery]);

  // 保存明细后，如果订单已经满足完整条件，自动落库为“已确认采购内容”。
  // 之前只刷新了详情，没有调用 refine，导致金额已平衡的订单仍长期显示“待完善”。
  const autoRefineAttempted = useRef("");
  useEffect(() => {
    const current = detail;
    if (loading || !current?.order.externalPoId || current.order.purchaseStatus !== "pending_refine") return;
    const allocations = current.detail.allocations ?? [];
    const inbound = current.detail.inbound as InboundRow[];
    const unallocated = current.detail.unallocatedAmount;
    if (
      allocations.length === 0
      || unallocated == null
      || Math.abs(Number(unallocated)) >= 0.005
    ) return;
    const attemptKey = `${current.order.externalPoId}:${allocations.length}:${unallocated}:${inbound.map((row) => `${row.linkId}-${row.consumableUsageDecided}-${row.consumableUsageEnabled}`).join(",")}`;
    if (autoRefineAttempted.current === attemptKey) return;
    autoRefineAttempted.current = attemptKey;
    void authenticatedFetch(`/api/v1/purchase/orders/${current.order.externalPoId}/refine`, { method: "POST" })
      .then(async (res) => {
        if (res.ok) await onOrderChanged();
      })
      .catch(() => {
        // 自动确认失败时保留“待完善”，由页面现有校验提示用户具体处理项。
      });
  }, [detail, loading, onOrderChanged]);

  if (loading && !detail) return <aside className="rounded-xl border border-slate-200 bg-white"><Loading text="正在加载订单详情…" /></aside>;
  if (!detail) return <aside className="flex min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white px-8 text-center text-[12px] text-slate-400">选择左侧订单查看执行详情</aside>;
  const { order, detail: records, stepStates } = detail;
  const isFile = order.fileOrderId != null;
  // 统计实际修改的字段数（与原始 order 对比）
  const allocations = records.allocations as AllocationRow[];
  // 耗材订单的明细由耗材采购单返回，不会落在 SKU allocations 中；展示层仍统一收口到同一张商品明细表。
  const detailConsumableItems = (((records.consumable as { items?: ConsumablePurchaseItem[] } | null)?.items ?? []) as ModalConsumableItem[]);
  const sourceOrderItems = (records.orderItems as Array<{
    productNumber?: string;
    productName?: string;
    skuId?: string;
    quantity?: number;
    unitPrice?: number;
    amount?: number;
    receivedQuantity?: number;
  }> | undefined) ?? [];
  // 某些历史耗材订单的详情接口只返回 orderItems，兜底映射成统一商品明细，避免页面误显示 0 条。
  const fetchedConsumableItems = consumablePurchaseRows.flatMap((purchase) => purchase.items.map((item) => ({ ...item, purchaseId: purchase.id })));
  const consumableItems: ModalConsumableItem[] = fetchedConsumableItems.length > 0
    ? fetchedConsumableItems
    : detailConsumableItems.length > 0
      ? detailConsumableItems
      : order.orderKind === "consumable"
        ? sourceOrderItems.map((item, index) => ({
            id: index,
            consumableId: 0,
            code: item.productNumber || item.skuId || "",
            name: item.productName || "未命名耗材",
            unit: "",
            quantity: String(item.quantity ?? 0),
            receivedQty: String(item.receivedQuantity ?? 0),
            unitCost: String(item.unitPrice ?? (item.amount && item.quantity ? item.amount / item.quantity : 0)),
          }))
        : [];
  const displayRowCount = allocations.length > 0 ? allocations.length : consumableItems.length;
  const displayTotal = allocations.length > 0
    ? allocations.reduce((sum, row) => sum + (row.amount ?? 0), 0)
    : consumableItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0);
  const purchaseAmount = order.amount ?? 0;
  const detailAmountGap = purchaseAmount - displayTotal;
  const hasDetailAmountGap = displayRowCount > 0 && Math.abs(detailAmountGap) >= 0.005;
  const expenses = records.expenses as ExpenseRow[];
  const inbound = records.inbound as InboundRow[];
  // SKU 分配归属：后端返回结构化 inboundDocumentId 时直接采用；旧版后端没有该字段时
  // 退化为解析 note（"由入库单 #N 明细自动反填"），保证后端未同步时分组依然正确。
  const docIdOf = (row: AllocationRow): number | null => {
    if (row.inboundDocumentId != null) return row.inboundDocumentId;
    const matched = /由入库单\s*#(\d+)/.exec(row.note ?? "");
    return matched ? Number(matched[1]) : null;
  };
  const linkedDocIds = new Set(inbound.map((row) => row.documentId).filter((id): id is number => id != null));
  const allocationsByDoc = new Map<number, AllocationRow[]>();
  const manualAllocations: AllocationRow[] = [];
  for (const row of allocations) {
    // 归属单据必须仍在本单已关联的入库单内，避免解除关联后残留空分组
    const docId = docIdOf(row);
    if (docId != null && linkedDocIds.has(docId)) {
      const list = allocationsByDoc.get(docId) ?? [];
      list.push(row);
      allocationsByDoc.set(docId, list);
    } else {
      manualAllocations.push(row);
    }
  }
  const manualTotal = manualAllocations.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const settlements = records.settlement as SettlementRow[];
  const extraAmount = expenses.reduce((sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0), 0);
  const settlementPaid = settlements.reduce((sum, row) => {
    const amount = row.paidAmount;
    return sum + (typeof amount === "number" ? amount : 0);
  }, 0);
  // 原单总额已含运费优惠，分摊费用不再次加到应付；未知付款不算已付。
  const payable = order.paidAmount ?? order.amount ?? 0;
  const platformPaid = order.paidOn1688
    ? (order.paidAmount ?? order.amount ?? 0)
    : order.platform !== "1688" && (order.paidAmount ?? 0) > 0
      ? order.paidAmount ?? 0
      : 0;
  const paidAmount = Math.min(payable, Math.max(settlementPaid, platformPaid));
  const unpaidAmount = Math.max(0, payable - paidAmount);
  const isPaid = order.paidOn1688 || paidAmount > 0;
  const remainingAmount = records.unallocatedAmount ?? order.paidAmount ?? order.amount;
  // 1688 源单已关闭：整单只读，不允许再确认采购内容或修改分配。
  const closed = isOrderClosed(order.orderStatus);
  const editable = !closed && (!order.purchaseStatus || order.purchaseStatus === "pending_refine");
  // 主档信息与 SKU 明细采用不同权限：未关闭订单可保存主档；SKU 明细仍受采购状态限制。
  const mainEditable = !closed;
  const detailStatusLabel = statusLabel({ orderStatus: order.orderStatus, stepStates, closeoutStage: order.closeoutStage });
  // 详情页状态必须跟工作台步骤状态一致；旧 purchaseStatus 可能仍停在 jackyun_linked，不能再渲染过时的流转按钮。
  const operationalComplete = stepStates.closeout?.done === true || order.purchaseStatus === "done";
  // 有真实入库事实后，状态机进入收尾阶段；不能再显示“回到生产中”的旧状态按钮。
  const hasActualInbound = inbound.length > 0;
  const canCreateInbound = !closed && !hasActualInbound && !operationalComplete;
  const nextStatus = !operationalComplete && !hasActualInbound && order.purchaseStatus
    ? NEXT_STATUS[order.purchaseStatus]
    : undefined;
  // 详情页默认全可修改；确认按钮仅作为手动推进快捷入口（SKU 分配保存后也会自动静默尝试确认）
  const canConfirm = Boolean(
    order.externalPoId && editable && allocations.length > 0 &&
    remainingAmount !== null && remainingAmount !== undefined && Math.abs(remainingAmount) < 0.005
  );
  const confirmBlockReason = !canConfirm
    ? (
      !order.externalPoId ? "缺少平台采购记录 ID"
      : closed ? `订单已关闭（1688 源单：${order.orderStatus || "已关闭"}），不可再确认`
      : !editable ? "当前状态不可确认"
      : allocations.length === 0 ? "尚未完成 SKU 分配"
      : order.paidAmount == null && remainingAmount !== null && remainingAmount < -0.005
        ? `实付金额未登记：分配合计 ${fmtMoney(Math.abs(remainingAmount))}，请在「金额与付款分层」的「1688微调」补录实付后再确认`
      : (remainingAmount !== null && Math.abs(remainingAmount) > 0.005)
        ? (remainingAmount < 0 ? "超分配" : "待分配") + ` ${fmtMoney(Math.abs(remainingAmount))}：请在 SKU 分配区把金额调平`
        : "暂不可确认"
    )
    : "";
  const selectedSku = skuCatalog.find((sku) => sku.id === selectedSkuId) ?? null;
  const selectableSkuCatalog = skuCatalog.filter((sku) => sku.productType === "single" && sku.status === "active");
  const normalizedInboundQuery = inboundQuery.trim().toLowerCase();
  const matchingInboundCandidates = inboundCandidates.filter((candidate) => {
    if (!normalizedInboundQuery) return true;
    return `${candidate.targetNo} ${candidate.targetSupplier} ${candidate.warehouseName}`.toLowerCase().includes(normalizedInboundQuery);
  }).slice(0, 30);
  const selectedInbound = inboundCandidates.find((candidate) => candidate.targetId === selectedInboundId) ?? null;
  const editorInboundDoc = skuEditorTargetDoc == null
    ? null
    : inbound.find((row) => row.documentId === skuEditorTargetDoc) ?? null;
  const editorConsumableDisabled = editorInboundDoc?.consumableUsageEnabled === false;
  const editorConsumable = skuConsumableId == null
    ? null
    : usageMaterials.find((material) => material.id === skuConsumableId) ?? null;

  function mappedConsumableQty(quantity: string, mapping?: ConsumableMappingRow) {
    if (!mapping) return "";
    const value = Number(quantity) * Number(mapping.usagePerUnit || 0);
    return Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(3))) : "1";
  }

  function seedSkuConsumable(skuId: number | null, quantity: string, existing?: EditorConsumableDraft | null) {
    const exempt = skuCatalog.find((item) => item.id === skuId)?.consumablePolicy === "none";
    setSkuConsumableExempt(exempt);
    if (exempt) {
      setSkuConsumableId(null);
      setSkuConsumableEntry("");
      setSkuConsumableQty("");
      setSkuConsumableAutoQty(false);
      setSkuConsumableTouched(false);
      return;
    }
    if (existing) {
      setSkuConsumableId(existing.consumableId);
      const material = usageMaterials.find((item) => item.id === existing.consumableId);
      setSkuConsumableEntry(material ? `${material.code} · ${material.name}` : String(existing.consumableId));
      setSkuConsumableQty(existing.quantity);
      setSkuConsumableAutoQty(false);
    } else {
      const mapping = skuId == null ? undefined : usageMappings.find((item) => item.skuId === skuId);
      setSkuConsumableId(mapping?.consumableId ?? null);
      const material = mapping ? usageMaterials.find((item) => item.id === mapping.consumableId) : null;
      setSkuConsumableEntry(material ? `${material.code} · ${material.name}` : "");
      setSkuConsumableQty(mappedConsumableQty(quantity, mapping));
      setSkuConsumableAutoQty(Boolean(mapping));
    }
    setSkuConsumableTouched(false);
  }

  function resetSkuConsumable() {
    setSkuConsumableId(null);
    setSkuConsumableEntry("");
    setSkuConsumableQty("");
    setSkuConsumableAutoQty(false);
    setSkuConsumableExempt(false);
    setSkuConsumableTouched(false);
  }

  const skuListId = `purchase-sku-catalog-${order.orderId}`;
  const consumableListId = `purchase-consumable-catalog-${order.orderId}`;
  const skuLabel = (sku: CatalogSkuRow) => `${sku.skuCode} · ${sku.goodsName || sku.skuName || "未命名商品"}`;
  const consumableLabel = (material: ConsumableRow) => `${material.code} · ${material.name}`;

  function applySkuSelection(sku: CatalogSkuRow) {
    setSelectedSkuId(sku.id);
    setSkuEntry(skuLabel(sku));
    const exempt = sku.consumablePolicy === "none";
    setSkuConsumableExempt(exempt);
    if (exempt) {
      resetSkuConsumable();
      setSkuConsumableExempt(true);
    }
    const mapping = usageMappings.find((item) => item.skuId === sku.id);
    setSkuConsumableId(exempt ? null : mapping?.consumableId ?? null);
    const material = mapping ? usageMaterials.find((item) => item.id === mapping.consumableId) : null;
    setSkuConsumableEntry(exempt ? "" : material ? consumableLabel(material) : "");
    setSkuConsumableQty(exempt ? "" : mappedConsumableQty(skuQty, mapping));
    setSkuConsumableAutoQty(!exempt && Boolean(mapping));
    setSkuConsumableTouched(true);
    // 入库前仅用货品档案成本作预估；实际入库反填后以入库明细含税单价为准。
    const defaultCost = Number(sku.defaultCost);
    setSkuTotal(Number.isFinite(defaultCost) && defaultCost >= 0 ? String(Number((defaultCost * Number(skuQty || 0)).toFixed(4))) : "");
  }

  function handleSkuEntry(value: string) {
    const normalized = value.trim().toLowerCase();
    setSkuEntry(value);
    if (!normalized) {
      setSelectedSkuId(null);
      setSkuTotal("");
      resetSkuConsumable();
      return;
    }
    const sku = selectableSkuCatalog.find((item) => [item.skuCode, item.jackyunSkuId, item.barcode, item.skuName, item.goodsName, skuLabel(item)]
      .some((candidate) => candidate?.trim().toLowerCase() === normalized));
    if (sku) applySkuSelection(sku);
    else {
      setSelectedSkuId(null);
      setSkuTotal("");
      resetSkuConsumable();
    }
  }

  function handleConsumableEntry(value: string) {
    const normalized = value.trim().toLowerCase();
    setSkuConsumableEntry(value);
    setSkuConsumableTouched(true);
    if (normalized === "不使用" || normalized === "无需耗材") {
      void updateSelectedSkuConsumablePolicy("none");
      return;
    }
    if (!normalized) {
      setSkuConsumableId(null);
      setSkuConsumableQty("");
      setSkuConsumableAutoQty(false);
      return;
    }
    const material = usageMaterials.find((item) => [item.code, item.name, consumableLabel(item)]
      .some((candidate) => candidate.trim().toLowerCase() === normalized));
    if (!material) {
      setSkuConsumableId(null);
      setSkuConsumableQty("");
      setSkuConsumableAutoQty(false);
      return;
    }
    setSkuConsumableId(material.id);
    setSkuConsumableEntry(consumableLabel(material));
    const mapping = usageMappings.find((item) => item.skuId === selectedSkuId && item.consumableId === material.id);
    setSkuConsumableQty(mapping ? mappedConsumableQty(skuQty, mapping) : "1");
    setSkuConsumableAutoQty(Boolean(mapping));
  }

  async function updateSelectedSkuConsumablePolicy(policy: "auto" | "none") {
    if (!selectedSku || editorBusy || skuAction) return;
    setEditorBusy(true);
    setSkuMessage("");
    try {
      await dashboardApi.updateConsumablePolicy(selectedSku.id, policy);
      setSkuCatalog((current) => current.map((row) => row.id === selectedSku.id ? { ...row, consumablePolicy: policy } : row));
      if (policy === "none") {
        setSkuConsumableExempt(true);
        setSkuConsumableId(null);
        setSkuConsumableEntry("");
        setSkuConsumableQty("");
        setSkuConsumableAutoQty(false);
        setSkuConsumableTouched(true);
        setSkuMessage("已设置为不使用耗材；保存明细后将显示“无需耗材”，不会扣减耗材库存");
      } else {
        setSkuConsumableExempt(false);
        seedSkuConsumable(selectedSku.id, skuQty);
        setSkuMessage("已恢复该货品的耗材自动匹配");
      }
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "耗材规则保存失败");
    } finally {
      setEditorBusy(false);
    }
  }

  function startConsumableEdit(item: ModalConsumableItem) {
    if (item.purchaseId == null) {
      setSkuMessage("该耗材明细缺少本地采购单 ID，暂不能在当前弹窗修改");
      return;
    }
    setEditingConsumable(item);
    setConsumableEditQty(item.quantity);
    setConsumableEditTotal((Number(item.quantity) * Number(item.unitCost)).toFixed(4));
    setSkuMessage("");
  }

  function cancelConsumableEdit() {
    setEditingConsumable(null);
    setConsumableEditQty("");
    setConsumableEditTotal("");
  }

  async function saveConsumableEdit() {
    const editing = editingConsumable;
    if (consumableEditBusy || !editing || editing.purchaseId == null) return;
    const quantity = Number(consumableEditQty);
    const total = Number(consumableEditTotal);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSkuMessage("耗材数量必须大于 0");
      return;
    }
    const receivedQty = Number(editing.receivedQty || 0);
    if (receivedQty > 0 && quantity < receivedQty) {
      setSkuMessage(`耗材数量不能小于已入库数量 ${fmtQty(receivedQty)}`);
      return;
    }
    if (!Number.isFinite(total) || total < 0) {
      setSkuMessage("耗材总价不能为负");
      return;
    }
    const purchase = consumablePurchaseRows.find((row) => row.id === editing.purchaseId);
    if (!purchase) {
      setSkuMessage("耗材采购单明细尚未加载完成，请稍后重试");
      return;
    }
    const unitCost = total / quantity;
    const items = purchase.items.map((item) => item.id === editing.id
      ? { consumable_id: item.consumableId, quantity: String(quantity), unit_cost: String(unitCost) }
      : { consumable_id: item.consumableId, quantity: item.quantity, unit_cost: item.unitCost });
    setConsumableEditBusy(true);
    setSkuMessage("");
    try {
      await consumablesApi.updatePurchase(purchase.id, { items });
      setConsumablePurchaseRows((current) => current.map((row) => row.id === purchase.id
        ? { ...row, items: row.items.map((item) => item.id === editing.id ? { ...item, quantity: String(quantity), unitCost: String(unitCost) } : item) }
        : row));
      cancelConsumableEdit();
      setSkuMessage(`已更新 ${editing.name}，单价已按总价 ÷ 数量自动计算`);
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "耗材明细保存失败");
    } finally {
      setConsumableEditBusy(false);
    }
  }

  // 商品明细表内的添加/修改行：用户填写数量和总价，单价由系统自动计算。
  const skuEditorRow = (
    <tr className="whitespace-nowrap border-t border-indigo-200 bg-indigo-50/60">
      <td className="py-1.5 pl-3 pr-2"><OrderKindTag value={order.orderKind} /></td>
      <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-500">{selectedSku?.barcode || "—"}</td>
      <td className="py-1.5 pr-2">
        {skuCatalogLoading ? (
          <div className="flex h-8 items-center gap-1.5 rounded border border-indigo-200 bg-white px-2 text-[11px] text-slate-400">正在读取 SKU 主档…</div>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", editingAllocation ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700")}>{editingAllocation ? "编辑" : "新建"}</span>
            <div className="min-w-0 flex-1">
              <input
                list={skuListId}
                value={skuEntry}
                disabled={skuCatalogLoading}
                onChange={(event) => handleSkuEntry(event.target.value)}
                placeholder={skuCatalogLoading ? "正在读取 SKU 主档…" : "输入 SKU 编码或名称，可快速选择"}
                aria-label="SKU 明细"
                className="h-8 w-full min-w-0 rounded border border-indigo-300 bg-white px-1.5 text-[11px] outline-none focus:border-indigo-500 disabled:bg-slate-50"
              />
              <datalist id={skuListId}>
                {selectableSkuCatalog.map((sku) => <option key={sku.id} value={skuLabel(sku)} />)}
              </datalist>
            </div>
          </div>
        )}
      </td>
      <td className="py-1.5 px-1 text-right">
        <input
          type="number" min="0.0001" step="0.0001" aria-label="数量" value={skuQty}
          onChange={(event) => {
            const value = event.target.value;
            setSkuQty(value);
            if (skuConsumableAutoQty && skuConsumableId != null) {
              setSkuConsumableQty(mappedConsumableQty(value, usageMappings.find((item) => item.skuId === selectedSkuId)));
            }
          }}
          className="h-8 w-full max-w-[96px] rounded border border-slate-200 bg-white px-1.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-300"
        />
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums font-medium text-slate-700">{fmtMoney(Number(skuQty) > 0 && skuTotal !== "" ? Number(skuTotal) / Number(skuQty) : null)}</td>
      <td className="py-1.5 px-1 text-right">
        <input
          type="number" min="0" step="0.0001" aria-label="总价" value={skuTotal}
          onChange={(event) => setSkuTotal(event.target.value)}
          className="h-8 w-full max-w-[104px] rounded border border-slate-200 bg-white px-1.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-300"
        />
      </td>
      <td className="py-1.5 px-1">
        {order.orderKind === "consumable" || editorConsumableDisabled ? (
          <span className="text-[11px] text-slate-400">{editorConsumableDisabled ? "本次不使用" : "—"}</span>
        ) : skuConsumableExempt ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="rounded bg-slate-100 px-1.5 py-1 text-[11px] font-medium text-slate-500">无需耗材</span>
            <button type="button" disabled={editorBusy} onClick={() => void updateSelectedSkuConsumablePolicy("auto")} className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-40">恢复自动匹配</button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              list={consumableListId}
              aria-label="耗材"
              value={skuConsumableEntry}
              disabled={usageLoading || usageMaterials.length === 0}
              onChange={(event) => handleConsumableEntry(event.target.value)}
              placeholder={usageLoading ? "正在读取耗材…" : "输入耗材编码或名称"}
              className="h-6 min-w-0 flex-1 rounded border border-indigo-200 bg-white px-1 text-[11px] outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <datalist id={consumableListId}>
              <option value="不使用" />
              {usageMaterials.map((material) => <option key={material.id} value={consumableLabel(material)} />)}
            </datalist>
            <input
              aria-label="耗材用量"
              type="number"
              min="0.0001"
              step="0.0001"
              value={skuConsumableQty}
              disabled={!skuConsumableId}
              onChange={(event) => { setSkuConsumableTouched(true); setSkuConsumableAutoQty(false); setSkuConsumableQty(event.target.value); }}
              placeholder="用量"
              className="h-6 w-12 shrink-0 rounded border border-slate-200 px-1 text-center text-[11px] tabular-nums outline-none focus:border-amber-400 disabled:bg-slate-50"
            />
            <span className="w-6 shrink-0 text-[11px] text-slate-400">{editorConsumable?.unit ?? "—"}</span>
            <button type="button" disabled={!selectedSku || editorBusy} onClick={() => void updateSelectedSkuConsumablePolicy("none")} className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40">不使用</button>
          </div>
        )}
      </td>
      <td className="py-1.5 px-1 text-center tabular-nums text-[11px] text-slate-500">{skuConsumableId ? skuConsumableQty || "—" : "—"}</td>
      <td className={cx("py-1.5 px-1 text-center text-[11px]", skuConsumableExempt ? "text-slate-400" : "text-amber-600")}>{order.orderKind === "consumable" || skuConsumableExempt ? "—" : skuConsumableId ? "待计算" : "未匹配"}</td>
      <td className="py-1.5 pl-2">
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => { setSkuEditorOpen(false); setSkuEditorTargetDoc(null); setEditingAllocation(null); resetSkuConsumable(); }}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >取消</button>
          <button
            disabled={skuAction !== "" || editorBusy || !selectedSku || !skuQty || skuTotal === "" || (!skuConsumableExempt && skuConsumableId != null && (!skuConsumableQty || Number(skuConsumableQty) <= 0))}
            onClick={addSkuAllocation}
            className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {skuAction === "add" ? "保存中…" : editingAllocation ? "保存修改" : skuEditorTargetDoc != null ? "保存到本单据" : "保存到采购内容"}
          </button>
        </div>
      </td>
    </tr>
  );

  async function readMutation(res: Response) {
    const body = await res.json().catch(() => ({})) as { detail?: string; id?: number };
    if (!res.ok) throw new Error(body.detail || `操作失败（${res.status}）`);
    return body;
  }

  async function ensureExternalPoId() {
    if (order.externalPoId) return order.externalPoId;
    const res = await authenticatedFetch("/api/v1/purchase/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        external_order_id: order.orderNo,
        platform: channelOf(order.platform),
        supplier_name: order.supplier || "",
        title: order.title || "",
        ordered_at: order.orderDate,
        order_amount: order.amount === null ? null : String(order.amount),
        paid_amount: (order.paidAmount ?? order.amount) === null ? null : String(order.paidAmount ?? order.amount),
      }),
    });
    const body = await readMutation(res);
    if (!body.id) throw new Error("采购工作流创建成功，但未返回采购单 ID");
    return body.id;
  }

  async function addSkuAllocation() {
    if (!selectedSku || !skuQty || skuTotal === "") return;
    const quantity = Number(skuQty);
    const total = Number(skuTotal);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(total) || total < 0) {
      setSkuMessage("请填写有效的数量和总价");
      return;
    }
    const consumableQuantity = Number(skuConsumableQty);
    if (skuEditorTargetDoc != null && skuConsumableId != null && (!Number.isFinite(consumableQuantity) || consumableQuantity <= 0)) {
      setSkuMessage("请填写有效的耗材用量");
      return;
    }
    setSkuAction("add");
    setSkuMessage("");
    const targetDocId = skuEditorTargetDoc;
    const wasEditing = editingAllocation != null;
    const consumableTouched = skuConsumableTouched;
    try {
      const poId = await ensureExternalPoId();
      const res = await authenticatedFetch(`/api/v1/purchase/orders/${poId}/allocations${editingAllocation ? `/${editingAllocation}` : ""}`, {
        method: editingAllocation ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: selectedSku.id,
          sku_code: selectedSku.skuCode,
          goods_name: selectedSku.goodsName || selectedSku.skuName,
          quantity: skuQty,
          amount: skuTotal,
          note: targetDocId != null ? `由入库单 #${targetDocId} 明细自动反填` : "",
        }),
      });
      const body = await readMutation(res);
      if (targetDocId != null && body.id && (!wasEditing || consumableTouched)) {
        setPendingConsumableUpdate({
          documentId: targetDocId,
          allocationId: body.id,
          draft: skuConsumableId == null || editorConsumableDisabled
            ? null
            : { consumableId: skuConsumableId, quantity: skuConsumableQty },
        });
      }
      setSelectedSkuId(null);
      setSkuEntry("");
      setSkuTotal("");
      resetSkuConsumable();
      setSkuMessage(wasEditing
        ? "SKU 数量/总价已更新，单价已自动计算；若该行原为入库单反填，单据明细与金额已同步更正"
        : (targetDocId != null ? `SKU 已添加到入库单 #${targetDocId}` : "SKU 已加入当前订单"));
      setEditingAllocation(null);
      if (wasEditing) {
        // 编辑保存：就地面板收起
        setSkuEditorTargetDoc(null);
        setSkuEditorOpen(false);
      } else if (targetDocId == null) {
        setSkuEditorTargetDoc(null);
      }
      // 卡片内新增：面板留在卡片内保持打开，选择已清空，可连续添加
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "SKU 分配失败");
    } finally {
      setSkuAction("");
    }
  }

  async function confirmPurchaseContent() {
    if (!order.externalPoId || !canConfirm) return;
    setSkuAction("confirm");
    setSkuMessage("");
    try {
      const res = await authenticatedFetch(`/api/v1/purchase/orders/${order.externalPoId}/confirm-and-resync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "工作台总确认" }),
      });
      const body = await readMutation(res) as { purchaseStatus?: string; resync?: { ok: boolean | null; attempted: boolean; error?: string; stats?: { stockinOrders?: number; stockinItems?: number } } };
      const r = body.resync;
      const parts = ["采购内容已确认，订单已进入待入库阶段"];
      if (r?.attempted) {
        if (r.ok) parts.push(`已尝试回写本地：入库单 ${r.stats?.stockinOrders ?? 0} 张 / 明细 ${r.stats?.stockinItems ?? 0} 行`);
        else parts.push(`本地回写未生效：${r.error ?? "未知原因"}`);
      }
      setSkuMessage(parts.join(" · "));
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "采购内容确认失败");
    } finally {
      setSkuAction("");
    }
  }

  async function deleteOrder() {
    const recoverable = order.orderId > 0;
    const tip = recoverable
      ? "这是一张 1688 导入订单，将执行软删除：仅从工作台隐藏（row_status=deleted），数据仍可恢复。"
      : "这是一张手工登记的订单（没有 1688 原件），将直接删除记录本体及其分配/费用，不可恢复。";
    if (!window.confirm(`确认删除订单 ${order.orderNo}？\n\n${tip}`)) return;
    setDeleteBusy(true);
    setSkuMessage("");
    try {
      const result = await procurementWorkbenchApi.softDeleteOrder(order.orderId);
      onOrderDeleted(result.recoverable
        ? `订单 ${result.orderNo || order.orderNo} 已从工作台移除（软删除，可恢复）`
        : `订单 ${result.orderNo || order.orderNo} 已删除`);
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "删除订单失败");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function saveMainEdit(event?: React.FormEvent) {
    if (event) event.preventDefault();
    if (mainSaving || !mainEditable) return;
    const warehouseId = mainForm.warehouseId.trim() ? Number(mainForm.warehouseId) : null;
    let mainFieldsSaved = false;
    let inboundStepRequired = false;
    setMainSaving(true);
    setMainError("");
    try {
      if (!mainForm.supplier.trim()) throw new Error("供应商不能为空");
      // 尚未登记实际入库时，仓库允许暂不指定；不能卡住主档保存。
      const purchaseAmount = Number(mainForm.orderAmount);
      if (!mainForm.orderAmount.trim() || !Number.isFinite(purchaseAmount) || purchaseAmount < 0) {
        throw new Error("请输入有效的采购金额");
      }

      const requestedInboundNo = inboundNoEntry.trim();
      const alreadyLinkedInbound = requestedInboundNo
        ? inbound.some((row) => (row.goodsdocNo || "").trim().toLowerCase() === requestedInboundNo.toLowerCase())
        : false;
      // 用户手填真实入库单号优先。不再在查询单号前强制 SKU 完成。
      const needsInboundAction = canCreateInbound && Boolean(requestedInboundNo && !alreadyLinkedInbound);
      let exactInboundTargetId: number | null = null;
      if (needsInboundAction) {
        const result = await procurementChainApi.candidates(order.orderId, "inbound", requestedInboundNo, 50);
        const exact = result.items.find((row) => row.targetNo.trim().toLowerCase() === requestedInboundNo.toLowerCase());
        exactInboundTargetId = exact?.targetId ?? null;
        inboundStepRequired = exactInboundTargetId != null;
      }

      const warehousePatch = hasActualInbound ? {} : { warehouse_id: warehouseId };
      await procurementWorkbenchApi.editOrderMain(order.orderId, isFile ? {
        supplier_name: mainForm.supplier,
        title: mainForm.title,
        goods_total: mainForm.goods.trim() || undefined,
        freight: mainForm.freight.trim() || undefined,
        discount: mainForm.discount.trim() || undefined,
        actual_payment: mainForm.orderAmount,
        inbound_no_reference: requestedInboundNo,
        ...warehousePatch,
      } : {
        external_order_id: mainForm.orderNo.trim(),
        supplier_name: mainForm.supplier,
        title: mainForm.title,
        ordered_at: mainForm.date || undefined,
        order_amount: mainForm.orderAmount,
        paid_amount: mainForm.paid,
        platform: mainForm.platform,
        inbound_no_reference: requestedInboundNo,
        ...warehousePatch,
      });
      mainFieldsSaved = true;

      if (needsInboundAction && exactInboundTargetId != null) {
        setSelectedInboundId(exactInboundTargetId);
        await saveInboundLink(exactInboundTargetId, true, false);
        setInboundMessage(`采购参数已保存，已优先关联入库单：${requestedInboundNo}`);
        inboundStepRequired = false;
      } else if (requestedInboundNo && !alreadyLinkedInbound) {
        // 候选里匹配不到这个号，但这张单已经挂着唯一一张本系统入库单时，直接把那张单改成填写的号。
        // 否则用户填的号只记在订单上，入库单本身还是系统自动编的号，两个系统永远对不齐。
        // 多张入库单时不动手（改错对象比不改更糟），交给「到仓入库」页面逐张改。
        const target = inbound.length === 1 ? inbound[0] : null;
        const currentNo = (target?.goodsdocNo || "").trim();
        const canRename = Boolean(target?.documentId) && currentNo.toLowerCase() !== requestedInboundNo.toLowerCase();
        if (canRename) {
          const confirmed = window.confirm(
            `系统里这张入库单当前单号是「${currentNo || "未记录"}」。\n是否把它改成你填的「${requestedInboundNo}」？\n\n只改单号，采购/发票关联不受影响。`
          );
          if (confirmed) {
            try {
              await procurementChainApi.correctInboundNo(target!.documentId!, requestedInboundNo, "与吉客云手工建单号对齐");
              setInboundMessage(`采购参数已保存，入库单号已改为「${requestedInboundNo}」`);
            } catch (renameError) {
              setInboundMessage(
                `采购参数已保存，但入库单号未能更正：${renameError instanceof Error ? renameError.message : String(renameError)}`
              );
            }
          } else {
            setInboundMessage("采购参数和手工入库单号已保存；真实单据待同步，不影响实际库存");
          }
        } else {
          setInboundMessage("采购参数和手工入库单号已保存；真实单据待同步，不影响实际库存");
        }
      } else {
        setInboundMessage("采购参数已保存");
      }

      await onOrderChanged();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "订单主档保存失败";
      if (mainFieldsSaved && inboundStepRequired) {
        setMainError(`采购参数已保存，但入库单处理失败：${reason}`);
        try {
          await onOrderChanged();
        } catch {
          // 主档已写入；保留明确的部分成功提示，不覆盖为普通“保存失败”。
        }
      } else if (mainFieldsSaved) {
        setMainError(`采购参数已保存，但刷新详情失败：${reason}`);
      } else {
        setMainError(reason);
      }
    } finally {
      setMainSaving(false);
    }
  }

  async function linkJackyunPo() {
    const poId = await ensureExternalPoId();
    const no = poLinkNo.trim();
    if (!no) { setPoMessage("请输入要关联的吉客云采购单号"); return; }
    const alloc = poAllocAmount.trim() === "" ? null : poAllocAmount;
    setPoBusy(true);
    setPoMessage("");
    try {
      await readMutation(await authenticatedFetch(`/api/v1/purchase/orders/${poId}/jackyun-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purch_no: no, relation_kind: poRelationKind, alloc_amount: alloc }),
      }));
      setPoEditorOpen(false);
      setPoLinkNo("");
      setPoRelationKind("");
      setPoAllocAmount("");
      setPoMessage("采购单已关联");
      await onOrderChanged();
    } catch (caught) {
      setPoMessage(caught instanceof Error ? caught.message : "关联采购单失败");
    } finally {
      setPoBusy(false);
    }
  }

  async function unlinkJackyunPo(linkId: number) {
    const poId = order.externalPoId;
    if (!poId || !window.confirm("确认解除这张吉客云采购单与当前订单的关联？")) return;
    setPoBusy(true);
    setPoMessage("");
    try {
      await readMutation(await authenticatedFetch(`/api/v1/purchase/orders/${poId}/jackyun-links/${linkId}`, { method: "DELETE" }));
      setPoMessage("已解除采购单关联");
      await onOrderChanged();
    } catch (caught) {
      setPoMessage(caught instanceof Error ? caught.message : "解除关联失败");
    } finally {
      setPoBusy(false);
    }
  }

  async function reopenPurchase() {
    if (!order.externalPoId || !window.confirm("重新编辑后采购内容需再次确认，原始采购单、入库和发票关联保留。是否继续？")) return;
    setEditorBusy(true);
    try {
      await readMutation(await authenticatedFetch(`/api/v1/purchase/orders/${order.externalPoId}/reopen`, { method: "POST" }));
      await onOrderChanged();
      setSkuEditorTargetDoc(null);
      setSkuEditorOpen(true);
      setSkuMessage("已重新打开采购内容，可修改 SKU、数量、单价和费用");
    } catch (caught) { setSkuMessage(caught instanceof Error ? caught.message : "重新编辑失败"); }
    finally { setEditorBusy(false); }
  }

  async function removeAllocation(allocationId: number) {
    if (!order.externalPoId) return;
    if (!window.confirm("确认删除这条 SKU 分配？删除后该明细将从入库单中移除，相关耗材台账会同步调整。")) return;
    setEditorBusy(true);
    setSkuMessage("");
    try {
      const res = await authenticatedFetch(`/api/v1/purchase/allocations/${allocationId}?po_id=${order.externalPoId}`, { method: "DELETE" });
      await readMutation(res);
      setSkuMessage("SKU 分配已删除");
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setEditorBusy(false);
    }
  }

  async function saveAdjustment() {
    if (!order.externalPoId) return;
    setEditorBusy(true);
    setExpenseMessage("");
    try {
      await readMutation(await authenticatedFetch(`/api/v1/purchase/orders/${order.externalPoId}/adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment_amount: adjValue, note: adjNote }),
      }));
      setAdjEditing(false);
      setAdjValue("");
      setAdjNote("");
      setExpenseMessage(adjValue.trim() === "" ? "1688 微调已清除" : "1688 微调已保存，分配平衡按 实付+微调 重算");
      await onOrderChanged();
    } catch (caught) {
      setExpenseMessage(caught instanceof Error ? caught.message : "微调保存失败");
    } finally {
      setEditorBusy(false);
    }
  }

  async function addExpense() {
    if (!expenseAmount) return;
    setEditorBusy(true);
    setExpenseMessage("");
    try {
      const poId = await ensureExternalPoId();
      const res = await authenticatedFetch(`/api/v1/purchase/orders/${poId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_type: expenseType, amount: expenseAmount }),
      });
      await readMutation(res);
      setExpenseAmount("");
      setExpenseMessage("附加费用已登记");
      await onOrderChanged();
    } catch (caught) {
      setExpenseMessage(caught instanceof Error ? caught.message : "费用登记失败");
    } finally {
      setEditorBusy(false);
    }
  }

  async function removeExpense(expenseId: number) {
    if (!order.externalPoId) return;
    if (!window.confirm("确认删除这条附加费用？该费用将从本单费用分摊中移除。")) return;
    setEditorBusy(true);
    setExpenseMessage("");
    try {
      const res = await authenticatedFetch(`/api/v1/purchase/expenses/${expenseId}?po_id=${order.externalPoId}`, { method: "DELETE" });
      await readMutation(res);
      setExpenseMessage("附加费用已删除");
      await onOrderChanged();
    } catch (caught) {
      setExpenseMessage(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setEditorBusy(false);
    }
  }

  async function advanceStatus() {
    if (!order.externalPoId || !nextStatus) return;
    if ((nextStatus === "inbound" || nextStatus === "done") && inbound.length === 0) {
      setSkuMessage("请先关联真实采购入库单");
      return;
    }
    setEditorBusy(true);
    try {
      const res = await authenticatedFetch(`/api/v1/purchase/orders/${order.externalPoId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await readMutation(res);
      setSkuMessage("状态已流转到「" + (PO_STATUS[nextStatus] ?? nextStatus) + "」");
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "状态流转失败");
    } finally {
      setEditorBusy(false);
    }
  }

  function openInboundPicker(linkId: number | null = null) {
    setReplaceInboundLinkId(linkId);
    setSelectedInboundId(null);
    setInboundQuery("");
    autoLinkedInboundQuery.current = "";
    setInboundMessage("");
    setInboundEditorOpen(true);
  }

  function selectInboundCandidate(candidate: ChainLinkCandidate) {
    setSelectedInboundId(candidate.targetId);
    setInboundNoEntry(candidate.targetNo);
    setInboundQuery(candidate.targetNo);
    setInboundEditorOpen(false);
    void saveInboundLink(candidate.targetId);
  }

  async function saveInboundLink(targetId: number | null = selectedInboundId, throwOnError = false, refresh = true) {
    setEditorBusy(true);
    setInboundMessage("");
    try {
      if (!targetId) return;
      if (inbound.length > 0 && !inbound.some((row) => row.targetId === targetId || row.documentId === targetId)) {
        throw new Error(`一张采购订单只能关联一个入库单，当前已有 ${inbound[0].goodsdocNo || "入库单"}`);
      }
      if (replaceInboundLinkId) {
        await procurementChainApi.replaceLink(replaceInboundLinkId, targetId, "采购工作台更换入库单，耗材按实际入库数量自动计算");
        setInboundMessage("入库单关联已更换，耗材将按实际入库数量自动计算");
      } else {
        await procurementChainApi.manualLink(order.orderId, "inbound", targetId, "采购工作台关联入库单，耗材按实际入库数量自动计算");
        setInboundMessage("入库单已关联，耗材将按实际入库数量自动计算");
      }
      setInboundEditorOpen(false);
      setSelectedInboundId(null);
      setReplaceInboundLinkId(null);
      if (refresh) await onOrderChanged();
    } catch (caught) {
      setInboundMessage(caught instanceof Error ? caught.message : "入库单关联失败");
      setInboundEditorOpen(Boolean(inboundQuery.trim()));
      if (throwOnError) throw caught;
    } finally {
      setEditorBusy(false);
    }
  }

  async function correctInboundAmount(documentId: number) {
    if (!documentId) return;
    setDocAmountBusy(true);
    setInboundMessage("");
    try {
      const result = await procurementChainApi.recalcInboundAmount(documentId);
      setInboundMessage(`已按明细合计更正入库单金额：${fmtMoney(Number(result.after))}`);
      await onOrderChanged();
    } catch (caught) {
      setInboundMessage(caught instanceof Error ? caught.message : "按明细更正失败");
    } finally {
      setDocAmountBusy(false);
    }
  }

async function saveInboundAmount(documentId: number, value: string, note: string) {
    if (!documentId || !value) return;
    setDocAmountBusy(true);
    setInboundMessage("");
    try {
      const result = await procurementChainApi.correctInboundAmount(documentId, value, note);
      setInboundMessage(`入库单金额已更正为 ${fmtMoney(Number(result.amount))}`);
      await onOrderChanged();
    } catch (caught) {
      setInboundMessage(caught instanceof Error ? caught.message : "更正金额失败");
    } finally {
      setDocAmountBusy(false);
    }
  }

  async function toggleOrderKind() {
    const next = order.orderKind === "consumable" ? "goods" : "consumable";
    const reason = next === "goods"
      ? "确认把该订单改为「正品」？\n\n当前判为耗材的原因：耗材档案 Excel 的「采购订货号」引用了本单号，或供应商名含包装类关键词。人工覆盖后不再受自动判定影响。"
      : "确认把该订单改为「耗材（包材）采购」？人工覆盖后不再受自动判定影响。";
    if (!window.confirm(reason)) return;
    setEditorBusy(true);
    setSkuMessage("");
    try {
      await procurementWorkbenchApi.setOrderKindOverride(order.orderId, next);
      setSkuMessage(next === "goods" ? "已人工改为「正品」" : "已人工改为「耗材」");
      await onOrderChanged();
    } catch (caught) {
      setSkuMessage(caught instanceof Error ? caught.message : "订单类型更新失败");
    } finally {
      setEditorBusy(false);
    }
  }

  async function removeInboundLink(linkId: number) {
    if (!window.confirm(`确认解除这张入库单与当前${CHANNELS[channelOf(order.platform)].label}订单的关联？入库原始数据不会删除。`)) return;
    setEditorBusy(true);
    setInboundMessage("");
    try {
      await procurementChainApi.deleteLink(linkId);
      setInboundMessage("入库单关联已解除，原始入库单仍保留在数据库中");
      await onOrderChanged();
    } catch (caught) {
      setInboundMessage(caught instanceof Error ? caught.message : "解除关联失败");
    } finally {
      setEditorBusy(false);
    }
  }

  const cancelled = isOrderClosed(order.orderStatus);

  // 关闭弹窗：触发父组件卸载右侧详情面板
  function onClose() {
    onOrderChanged().catch(() => {});
    // 关掉详情 = 当前 Tab 交还给工作台列表（列表 Tab 已存在就切回去），地址栏与工作区保持一致
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(panelSearchParams.toString());
      params.delete("order");
      syncWorkspaceUrl(panelWorkspace.retarget(`/purchase/workbench${params.toString() ? `?${params}` : ""}`));
    }
    onCloseDialog?.();
  }

  // 仓库名：实际入库仓库 > 计划仓库 > 订单上记录的仓库
  const actualWarehouseName = detail.warehouse?.warehouseName ?? order.warehouseName ?? "";
  const targetWarehouseName = detail.warehouse?.targetWarehouseName ?? "";

  // 发票匹配状态（由发票池自动处理，详情页只读）
  const invoiceStatusText = (() => {
    switch (order.invoiceStatus) {
      case "done": return "已开票";
      case "partial": return "部分开票";
      case "needs_review": return "发票需复核";
      case "pending": return "待开票";
      case "none": return "无票";
      default: return "待匹配";
    }
  })();
  const invoiceStatusClass = order.invoiceStatus === "done"
    ? "bg-emerald-50 text-emerald-700"
    : order.invoiceStatus === "needs_review"
      ? "bg-rose-50 text-rose-700"
      : order.invoiceStatus === "partial"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-500";

  const invoiceOutstanding = order.invoiceOutstanding ?? 0;
  const invoicedAmount = order.invoicedAmount ?? 0;
  const orderAmount = order.amount ?? 0;
  const invoiceHasGap = invoiceOutstanding > 0 || invoicedAmount < orderAmount;
  const topInvoiceStatusText = order.invoiceStatus === "needs_review"
    ? "发票需复核"
    : order.invoiceStatus === "pending"
      ? "待供应商开票"
      : invoiceHasGap || order.invoiceStatus === "partial"
        ? "待开票"
        : invoiceStatusText;
  const topInvoiceStatusClass = order.invoiceStatus === "needs_review"
    ? "bg-rose-50 text-rose-700"
    : invoiceHasGap
      ? "bg-amber-50 text-amber-700"
      : invoiceStatusClass;
  const invoiceReviewTitle = (order.invoiceReviewReasons ?? []).join("；");
  const currentWarehouseName = actualWarehouseName || targetWarehouseName || order.warehouseName || "";
  const currentWarehouseId = detail.warehouse?.warehouseId ?? detail.warehouse?.targetWarehouseId ?? order.warehouseId ?? null;

  function allocationConsumables(row: AllocationRow) {
    if (order.orderKind === "consumable" || row.skuId == null) return [];
    if (skuCatalog.find((item) => item.id === row.skuId)?.consumablePolicy === "none") return [];
    return usageMappings
      .filter((mapping) => mapping.skuId === row.skuId)
      .map((mapping) => {
        const material = usageMaterials.find((item) => item.id === mapping.consumableId) ?? null;
        const requiredQty = Math.max(0, Number(row.quantity ?? 0) * Number(mapping.usagePerUnit || 0));
        const availableRaw = material ? Number(material.availableQty) : NaN;
        const availableQty = Number.isFinite(availableRaw) ? Math.max(0, availableRaw) : null;
        const usedQty = availableQty == null ? null : Math.min(requiredQty, availableQty);
        const shortageQty = availableQty == null ? null : Math.max(0, requiredQty - availableQty);
        const status = !material
          ? { label: "未匹配", className: "bg-orange-50 text-orange-600" }
          : shortageQty == null
            ? { label: "未匹配", className: "bg-orange-50 text-orange-600" }
            : shortageQty > 0
              ? { label: "缺 " + fmtQty(shortageQty), className: "bg-rose-50 text-rose-600" }
              : { label: "已匹配", className: "bg-emerald-50 text-emerald-600" };
        return { mapping, material, requiredQty, availableQty, usedQty, shortageQty, status };
      });
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col scroll-mt-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_rgba(40,53,85,0.10)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">
                采购订单详情 / 全量录入 <span className="font-mono text-[15px]">{order.orderNo}</span>
              </h2>
              <PlatformBadge value={order.platform} />
              {cancelled && <span className="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-medium text-white">已关闭</span>}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">主档可独立保存；SKU 明细修改受采购状态限制，已有入库记录后锁定仓库</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cx("rounded-md px-2 py-1 text-[11px] font-medium", isPaid ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700")}>{isPaid ? "已付款" : "待付款"}</span>
            <span className={cx("rounded-md px-2 py-1 text-[11px] font-medium", topInvoiceStatusClass)}>{topInvoiceStatusText}</span>
            {!closed && !editable && order.externalPoId && <button type="button" onClick={() => void reopenPurchase()} disabled={editorBusy} title="重新打开 SKU、数量和单价等采购内容编辑" className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="edit" size={12} />{editorBusy ? "打开中…" : "编辑采购内容"}</button>}
            <button type="button" onClick={() => void saveMainEdit()} disabled={!mainEditable || mainSaving} title={closed ? "已关闭订单只读" : "保存采购主档；已有入库单号优先关联，未同步则保留原号"} className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{mainSaving ? "保存中…" : "保存"}</button>
            <button type="button" onClick={onClose} aria-label="关闭" className="flex items-center justify-center rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:border-indigo-200 hover:text-indigo-600"><Icon name="x" size={15} /></button>
          </div>
        </header>

        {(mainError || inboundMessage || skuMessage) && (
          <div className={cx(
            "mx-4 mt-2 rounded-md border px-3 py-1.5 text-[11px]",
            mainError || inboundMessage?.includes("失败") || skuMessage?.includes("失败") || skuMessage?.includes("请")
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          )}>
            {mainError || inboundMessage || skuMessage}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f9fd] px-4 py-3">
          {cancelled && <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">已关闭订单只读，不能修改采购参数或商品明细。</div>}

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <div>
                <h3 className="text-[13px] font-semibold text-slate-800">采购参数</h3>
                <p className="mt-0.5 text-[10px] text-slate-400">订单主档独立保存；入库后不可更换仓库，SKU 明细按采购状态编辑</p>
              </div>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">一单一仓</span>
            </div>
            <div className="space-y-2 px-4 py-3">
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[4.5em] shrink-0 text-[11px] text-slate-500">供应商<span className="ml-1 text-rose-500">*</span></label>
                  <input list={"purchase-supplier-" + order.orderId} value={mainForm.supplier} disabled={!mainEditable} onChange={(event) => setMainForm({ ...mainForm, supplier: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50" />
                  <datalist id={"purchase-supplier-" + order.orderId}>
                    {(detail.supplierSuggestions ?? detail.supplierHistory?.recentOrders.map((item) => item.supplier || "") ?? []).filter(Boolean).map((name) => <option key={name} value={name} />)}
                  </datalist>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[4.5em] shrink-0 text-[11px] text-slate-500">仓库<span className="ml-1 text-rose-500">*</span></label>
                  <select value={mainForm.warehouseId} disabled={!mainEditable || hasActualInbound} title={hasActualInbound ? "已有实际入库记录，不能更换采购仓库" : "选择本单入库仓库"} onChange={(event) => setMainForm({ ...mainForm, warehouseId: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50">
                    <option value="">请选择仓库</option>
                    {mainForm.warehouseId && !warehouses.some((item) => String(item.id) === mainForm.warehouseId) && <option value={mainForm.warehouseId}>{currentWarehouseName || "当前仓库"}</option>}
                    {warehouses.map((warehouse) => <option key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}{warehouse.code ? " · " + warehouse.code : ""}</option>)}
                  </select>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[4.5em] shrink-0 text-[11px] text-slate-500">采购金额<span className="ml-1 text-rose-500">*</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={mainForm.orderAmount}
                    disabled={!mainEditable}
                    onChange={(event) => setMainForm({ ...mainForm, orderAmount: event.target.value })}
                    placeholder="请输入采购金额"
                    title="修改后将按新采购金额重新计算发票差额"
                    className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-right text-[12px] font-semibold tabular-nums text-slate-800 outline-none focus:border-indigo-400 disabled:bg-slate-50"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[4.5em] shrink-0 text-[11px] text-slate-500">采购时间<span className="ml-1 text-rose-500">*</span></label>
                  <input type="date" value={mainForm.date} disabled={!mainEditable} onChange={(event) => setMainForm({ ...mainForm, date: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                <div className="flex min-w-0 items-center gap-2"><label className="w-[4.5em] shrink-0 whitespace-nowrap text-[11px] text-slate-500">采购渠道</label><select value={mainForm.platform} disabled={!mainEditable} onChange={(event) => setMainForm({ ...mainForm, platform: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50"><option value="1688">1688</option><option value="pdd">拼多多</option><option value="taobao">淘宝 / 天猫</option><option value="other">其他</option></select></div>
                <div className="flex min-w-0 items-center gap-2"><label className="w-[4.5em] shrink-0 whitespace-nowrap text-[11px] text-slate-500">{isFile ? "订单号" : "采购单号"}</label><input value={mainForm.orderNo} readOnly={isFile} disabled={!mainEditable} onChange={(event) => setMainForm({ ...mainForm, orderNo: event.target.value })} placeholder="请输入本系统采购单号" title={isFile ? "1688 原始订单号不可修改" : "本地新建采购单以此单号作为系统主单号"} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 font-mono text-[11px] text-slate-600 outline-none focus:border-indigo-400 read-only:cursor-not-allowed read-only:bg-slate-50 disabled:bg-slate-50" /></div>
                <div className="flex min-w-0 items-center gap-2"><label className="w-[4.5em] shrink-0 whitespace-nowrap text-[11px] text-slate-500">付款状态</label><div className={cx("flex h-8 min-w-0 flex-1 items-center rounded-md border px-2 text-[12px] font-medium", isPaid ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700")}>{isPaid ? "已付款" : "待核对"}</div></div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)]">
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[5.5em] shrink-0 whitespace-nowrap text-[11px] text-slate-500">发票匹配状态</label>
                  <div
                    title={invoiceReviewTitle || "由发票池自动匹配，只读"}
                    className={cx(
                      "flex min-h-8 min-w-0 flex-1 items-center rounded-md border px-2 text-[11px] font-medium",
                      order.invoiceStatus === "needs_review"
                        ? "border-rose-100 bg-rose-50 text-rose-700"
                        : invoiceHasGap
                          ? "border-amber-100 bg-amber-50 text-amber-700"
                          : invoiceStatusClass,
                    )}
                  >
                    {order.invoiceStatus === "needs_review"
                      ? "需复核" + (invoiceReviewTitle ? "：" + invoiceReviewTitle : "")
                      : invoiceHasGap
                        ? "金额不足 " + fmtMoney(invoicedAmount) + " / " + fmtMoney(orderAmount)
                        : invoiceStatusText}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <label className="w-[3.5em] shrink-0 whitespace-nowrap text-[11px] text-slate-500">备注</label>
                  <textarea value={mainForm.title} disabled={!mainEditable} onChange={(event) => setMainForm({ ...mainForm, title: event.target.value })} rows={1} placeholder="可填写采购备注" className="h-8 min-w-0 flex-1 resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50" />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 px-4 py-2.5 text-[11px]">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-slate-500">订单状态</span>
                <span className={cx("rounded-md px-2 py-1 font-medium", statusClass(detailStatusLabel))}>{detailStatusLabel}</span>
              </div>
              <div className="relative flex min-w-[280px] flex-[1_1_360px] items-center gap-2">
                <label className="shrink-0 whitespace-nowrap text-slate-500">入库单号</label>
                <input value={inboundNoEntry} disabled={!mainEditable || hasActualInbound || operationalComplete} title={hasActualInbound ? "已有实际入库记录，入库单号不可更换" : operationalComplete ? "已完成订单不自动创建入库单" : "已有入库单优先关联，未同步则保留原号，不虚增库存"} onFocus={() => {
                  if (mainEditable && canCreateInbound && inboundQuery.trim()) setInboundEditorOpen(true);
                }} onBlur={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (!next || !event.currentTarget.parentElement?.contains(next)) setInboundEditorOpen(false);
                }} onKeyDown={(event) => {
                  if (event.key === "Escape") setInboundEditorOpen(false);
                }} onChange={(event) => {
                  const value = event.target.value;
                  setInboundNoEntry(value);
                  setInboundQuery(value);
                  setInboundMessage("");
                  setInboundEditorOpen(Boolean(value.trim()));
                  if (!value.trim()) { setInboundCandidates([]); setSelectedInboundId(null); }
                }} placeholder="已有入库单优先关联，暂未同步则保留原号" className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 font-mono text-[11px] text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50" />
                {inbound.length > 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-600">已关联</span>}
                {inboundEditorOpen && inboundQuery.trim() && (
                  <div className="absolute left-0 right-0 top-[36px] z-20 rounded-md border border-slate-200 bg-white p-1.5 shadow-xl">
                    {inboundCandidateLoading ? <div className="px-2 py-2 text-center text-[11px] text-slate-400">正在查询本地入库单…</div> : matchingInboundCandidates.length > 0 ? matchingInboundCandidates.slice(0, 6).map((candidate) => (
                      <button key={candidate.targetId} type="button" onClick={() => selectInboundCandidate(candidate)} className={cx("flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-indigo-50", selectedInboundId === candidate.targetId ? "bg-indigo-50" : "")}>
                        <span className="min-w-0"><span className="block truncate font-mono text-[11px] text-slate-700">{candidate.targetNo}</span><span className="block truncate text-[10px] text-slate-400">{candidate.targetSupplier || "未注供应商"} · {candidate.warehouseName || "未注仓库"}</span></span>
                        <span className="shrink-0 text-[10px] text-slate-500">{fmtMoney(candidate.targetAmount)}</span>
                      </button>
                    )) : <div className="px-2 py-2 text-center text-[11px] text-amber-600">未找到真实入库单；保存仅保留编号，不生成库存</div>}
                  </div>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3 text-slate-500"><span>商品明细 <span className="font-semibold text-slate-800">共 {displayRowCount} 条</span></span>
              <button type="button" disabled={!editable} onClick={() => { setEditingAllocation(null); setSelectedSkuId(null); setSkuEntry(""); setSkuQty("1"); setSkuTotal(""); resetSkuConsumable(); setSkuEditorTargetDoc(null); setSkuEditorOpen(true); }} className="flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="plus" size={12} />新增商品</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-[11px]">
                <thead><tr className="bg-slate-50 text-slate-500">
                  <th className="border-b border-slate-100 px-3 py-2 text-left font-medium">类型</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-left font-medium">条形码</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-left font-medium">商品名称</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-right font-medium">数量</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-right font-medium">单价</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-right font-medium">金额</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-left font-medium">耗材名称</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-right font-medium">耗材使用量</th>
                  <th className="border-b border-slate-100 px-2 py-2 text-center font-medium">耗材匹配</th>
                  <th className="border-b border-slate-100 px-3 py-2 text-right font-medium">操作</th>
                </tr></thead>
                <tbody>
                  {allocations.length > 0 ? allocations.map((row, index) => {
                    const rowKey = row.id ?? index;
                    const rowType = order.orderKind === "consumable" ? "consumable" : "goods";
                    const catalogSku = skuCatalog.find((item) => item.id === row.skuId);
                    const rowMappings = allocationConsumables(row);
                    const primary = rowMappings[0];
                    const combinedShortage = rowMappings.reduce((sum, item) => sum + (item.shortageQty ?? 0), 0);
                    const hasUnmatched = rowMappings.some((item) => item.status.label === "未匹配");
                    const noConsumable = catalogSku?.consumablePolicy === "none";
                    const rowStatus = rowType === "consumable"
                      ? { label: "—", className: "bg-slate-100 text-slate-400" }
                      : noConsumable
                        ? { label: "无需耗材", className: "bg-slate-100 text-slate-500" }
                      : rowMappings.length === 0
                        ? { label: "未匹配", className: "bg-orange-50 text-orange-600" }
                        : hasUnmatched
                          ? { label: "未匹配", className: "bg-orange-50 text-orange-600" }
                          : combinedShortage > 0
                            ? { label: "缺 " + fmtQty(combinedShortage), className: "bg-rose-50 text-rose-600" }
                            : { label: "已匹配", className: "bg-emerald-50 text-emerald-600" };
                    const rowUnitPrice = row.unitPrice ?? (row.quantity && row.amount != null ? row.amount / row.quantity : null);
                    return (
                      <Fragment key={String(rowKey)}>
                        <tr className="border-b border-slate-50 align-middle hover:bg-slate-50/50">
                          <td className="px-3 py-2"><OrderKindTag value={rowType} /></td>
                          <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{catalogSku?.barcode || row.skuCode || "—"}</td>
                          <td className="max-w-[300px] px-2 py-2"><div className="truncate font-medium text-slate-700" title={row.goodsName}>{row.goodsName || "未命名商品"}</div></td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtQty(row.quantity ?? null)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtMoney(rowUnitPrice)}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtMoney(row.amount)}</td>
                          <td className="max-w-[250px] px-2 py-2 text-slate-600">
                            {rowType === "consumable" || noConsumable ? <span className="text-slate-400">{noConsumable ? "无需耗材" : "—"}</span> : primary ? <span className="inline-flex max-w-full items-center gap-1"><span className="truncate" title={primary.material?.name || primary.mapping.consumableName}>{primary.material?.name || primary.mapping.consumableName}</span>{rowMappings.length > 1 && <button type="button" onClick={() => setExpandedConsumables((current) => current.includes(rowKey) ? current.filter((value) => value !== rowKey) : [...current, rowKey])} className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">+{rowMappings.length - 1}</button>}</span> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{primary?.usedQty == null ? "—" : fmtQty(primary.usedQty)}</td>
                          <td className="px-2 py-2 text-center"><span className={cx("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", rowStatus.className)}>{rowStatus.label}</span></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">{editable && row.id ? <span className="inline-flex items-center gap-1.5"><button type="button" disabled={editorBusy} onClick={() => { setEditingAllocation(row.id!); setSelectedSkuId(row.skuId ?? null); setSkuEntry((row.skuCode || "") + (row.goodsName ? " · " + row.goodsName : "")); setSkuQty(String(row.quantity ?? 1)); setSkuTotal(String(row.amount ?? (row.unitPrice != null ? Number(row.quantity ?? 0) * row.unitPrice : ""))); seedSkuConsumable(row.skuId ?? null, String(row.quantity ?? 1)); setSkuEditorTargetDoc(null); setSkuEditorOpen(true); }} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-40"><Icon name="edit" size={11} />编辑</button><button type="button" disabled={editorBusy} onClick={() => void removeAllocation(row.id as number)} className="rounded-md px-1 py-1 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">删除</button></span> : <span className="text-slate-300">—</span>}</td>
                        </tr>
                        {expandedConsumables.includes(rowKey) && rowMappings.length > 1 && <tr className="border-b border-slate-100 bg-indigo-50/30"><td colSpan={10} className="px-5 py-2"><div className="flex flex-wrap gap-x-5 gap-y-1.5">{rowMappings.map((item) => <span key={item.mapping.id} className="inline-flex items-center gap-1.5 text-[10px] text-slate-600"><span className="font-medium">{item.material?.name || item.mapping.consumableName}</span><span>使用 {item.usedQty == null ? "—" : fmtQty(item.usedQty)}</span><span className={cx("rounded-full px-1.5 py-0.5 font-medium", item.status.className)}>{item.status.label}</span></span>)}</div></td></tr>}
                      </Fragment>
                    );
                  }) : consumableItems.length > 0 ? consumableItems.map((item, index) => {
                    const quantity = Number(item.quantity || 0);
                    const unitCost = Number(item.unitCost || 0);
                    const amount = quantity * unitCost;
                    const receivedQty = Number(item.receivedQty || 0);
                    const isEditing = editingConsumable?.purchaseId === item.purchaseId && editingConsumable?.id === item.id;
                    if (isEditing) return (
                      <tr key={`consumable-${item.id ?? index}`} className="border-b border-indigo-100 bg-indigo-50/60 align-middle">
                        <td className="px-3 py-2"><OrderKindTag value="consumable" /></td>
                        <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{item.code || "—"}</td>
                        <td className="max-w-[300px] px-2 py-2"><div className="truncate font-medium text-slate-700" title={item.name}>{item.name || "未命名耗材"}</div><div className="mt-0.5 text-[10px] text-slate-400">已入库 {fmtQty(receivedQty)} {item.unit || ""}</div></td>
                        <td className="px-2 py-2 text-right"><input type="number" min={receivedQty || 0.0001} step="0.0001" aria-label="耗材数量" value={consumableEditQty} onChange={(event) => setConsumableEditQty(event.target.value)} className="h-8 w-full max-w-[92px] rounded border border-indigo-300 bg-white px-1.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-500" /></td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-700">{fmtMoney(Number(consumableEditQty) > 0 && consumableEditTotal !== "" ? Number(consumableEditTotal) / Number(consumableEditQty) : null)}</td>
                        <td className="px-2 py-2 text-right"><input type="number" min="0" step="0.0001" aria-label="耗材总价" value={consumableEditTotal} onChange={(event) => setConsumableEditTotal(event.target.value)} className="h-8 w-full max-w-[104px] rounded border border-indigo-300 bg-white px-1.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-500" /></td>
                        <td className="px-2 py-2 text-slate-400">—</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-400">—</td>
                        <td className="px-2 py-2 text-center"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">—</span></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right"><span className="inline-flex items-center gap-1.5"><button type="button" disabled={consumableEditBusy} onClick={() => void saveConsumableEdit()} className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40">{consumableEditBusy ? "保存中…" : "保存"}</button><button type="button" disabled={consumableEditBusy} onClick={cancelConsumableEdit} className="rounded-md px-1 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">取消</button></span></td>
                      </tr>
                    );
                    return (
                      <tr key={`consumable-${item.id ?? index}`} className="border-b border-slate-50 align-middle hover:bg-slate-50/50">
                        <td className="px-3 py-2"><OrderKindTag value="consumable" /></td>
                        <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{item.code || "—"}</td>
                        <td className="max-w-[300px] px-2 py-2"><div className="truncate font-medium text-slate-700" title={item.name}>{item.name || "未命名耗材"}</div><div className="mt-0.5 text-[10px] text-slate-400">已入库 {fmtQty(receivedQty)} {item.unit || ""}</div></td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtQty(quantity)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtMoney(unitCost)}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtMoney(amount)}</td>
                        <td className="px-2 py-2 text-slate-400">—</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-400">—</td>
                        <td className="px-2 py-2 text-center"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">—</span></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{editable && item.purchaseId != null ? <button type="button" disabled={consumableEditBusy} onClick={() => startConsumableEdit(item)} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-40"><Icon name="edit" size={11} />编辑</button> : <span className="text-[10px] text-slate-400">耗材采购明细</span>}</td>
                      </tr>
                    );
                  }) : <tr><td colSpan={10} className="py-8 text-center text-[11px] text-slate-400">暂无商品明细，请点击右上角“新增商品”</td></tr>}
                  {skuEditorOpen ? skuEditorRow : null}
                </tbody>
              </table>
            </div>
            {displayRowCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-[11px]"><span className="text-slate-500">明细合计</span><span className="font-semibold tabular-nums text-slate-800">{fmtMoney(displayTotal)}</span>{hasDetailAmountGap && <span className="ml-auto rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">与采购金额 {fmtMoney(purchaseAmount)} 相差 {fmtMoney(Math.abs(detailAmountGap))}，请编辑商品明细确认</span>}</div>}
          </section>

        </div>
      </div>
    </aside>
  );
}


const CONSUMABLE_PO_STATUS: Record<string, { label: string; cls: string }> = {
  ordered: { label: "待收货", cls: "bg-amber-50 text-amber-600" },
  partial: { label: "部分收货", cls: "bg-amber-50 text-amber-600" },
  received: { label: "已收齐", cls: "bg-emerald-50 text-emerald-600" },
  cancelled: { label: "已取消", cls: "bg-slate-100 text-slate-500" },
};











