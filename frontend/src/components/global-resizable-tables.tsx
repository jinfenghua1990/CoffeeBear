"use client";

import { useEffect } from "react";

const MIN_WIDTH = 56;
const MAX_WIDTH = 960;
const WIDTH_STORAGE_PREFIX = "ecommerce-table-widths:v2";
const ORDER_STORAGE_PREFIX = "ecommerce-table-order:v1";
const LEGACY_WIDTH_STORAGE_PREFIX = "ecommerce-table-widths:v1";

type WidthMap = Record<string, number>;

type ActiveColumnDrag = {
  table: HTMLTableElement;
  columnId: string;
} | null;

let activeColumnDrag: ActiveColumnDrag = null;

function normalizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function headerRowOf(table: HTMLTableElement) {
  if (table.tHead?.rows.length) return table.tHead.rows[table.tHead.rows.length - 1];
  return Array.from(table.rows).find((row) =>
    Array.from(row.cells).some((cell) => cell.tagName === "TH"),
  );
}

function headerCellsOf(table: HTMLTableElement) {
  const row = headerRowOf(table);
  if (!row) return [] as HTMLTableCellElement[];
  return Array.from(row.cells).filter(
    (cell): cell is HTMLTableCellElement =>
      cell instanceof HTMLTableCellElement && cell.tagName === "TH",
  );
}

function assignColumnIds(headers: HTMLTableCellElement[]) {
  const seen = new Map<string, number>();

  headers.forEach((header, index) => {
    if (header.dataset.globalColumnId) return;

    const label = normalizeText(header.textContent) || `column-${index + 1}`;
    const occurrence = (seen.get(label) || 0) + 1;
    seen.set(label, occurrence);
    header.dataset.globalColumnId = `${label}#${occurrence}`;
  });
}

function originalColumnOrder(table: HTMLTableElement, headers: HTMLTableCellElement[]) {
  const currentIds = headers
    .map((header) => header.dataset.globalColumnId || "")
    .filter(Boolean);

  try {
    const stored = JSON.parse(table.dataset.globalOriginalColumnOrder || "[]") as unknown;
    if (
      Array.isArray(stored)
      && stored.length === currentIds.length
      && stored.every((item) => typeof item === "string")
      && new Set(stored).size === currentIds.length
      && currentIds.every((id) => stored.includes(id))
    ) {
      return stored as string[];
    }
  } catch {
    // 旧 DOM 标记异常时直接用当前首次结构重建。
  }

  table.dataset.globalOriginalColumnOrder = JSON.stringify(currentIds);
  return currentIds;
}

function assignRowColumnIds(table: HTMLTableElement, originalOrder: string[]) {
  const headerRow = headerRowOf(table);
  for (const row of Array.from(table.rows)) {
    if (row === headerRow) continue;
    const cells = Array.from(row.cells);
    if (cells.length === 1 && cells[0]?.colSpan === originalOrder.length) continue;
    if (cells.length !== originalOrder.length) continue;

    // React 分页/筛选后通常整行替换；新行没有列 ID，按组件源码的原始列序补回。
    // 已经被用户重排过的旧行会保留 ID，不覆盖。
    if (cells.every((cell) => !cell.dataset.globalColumnId)) {
      cells.forEach((cell, index) => {
        cell.dataset.globalColumnId = originalOrder[index];
      });
    }
  }
}

function stableTableSignature(table: HTMLTableElement, tableIndex: number) {
  const headers = headerCellsOf(table);
  assignColumnIds(headers);
  const signature = originalColumnOrder(table, headers)
    .slice()
    .sort()
    .slice(0, 32)
    .join("|");

  const explicit = table.dataset.resizableTableKey || table.dataset.reorderableTableKey;
  return explicit || `${signature || "table"}:${tableIndex}`;
}

function widthStorageKey(table: HTMLTableElement, tableIndex: number) {
  return `${WIDTH_STORAGE_PREFIX}:${window.location.pathname}:${stableTableSignature(table, tableIndex)}`;
}

function orderStorageKey(table: HTMLTableElement, tableIndex: number) {
  return `${ORDER_STORAGE_PREFIX}:${window.location.pathname}:${stableTableSignature(table, tableIndex)}`;
}

function legacyWidthStorageKey(table: HTMLTableElement, tableIndex: number) {
  const explicit = table.dataset.resizableTableKey;
  if (explicit) return `${LEGACY_WIDTH_STORAGE_PREFIX}:${window.location.pathname}:${explicit}`;

  const headerRow = headerRowOf(table);
  const signature = headerRow
    ? Array.from(headerRow.cells)
        .map((cell) => normalizeText(cell.textContent))
        .filter(Boolean)
        .slice(0, 24)
        .join("|")
    : "";

  return `${LEGACY_WIDTH_STORAGE_PREFIX}:${window.location.pathname}:${signature || `table-${tableIndex}`}`;
}

function readWidths(key: string): WidthMap {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as WidthMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeWidths(key: string, widths: WidthMap) {
  try {
    window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // localStorage 被禁用时，拖拽仍然生效，只是不持久化。
  }
}

function readOrder(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function writeOrder(key: string, order: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // localStorage 被禁用时仍允许本次调整，只是不记忆。
  }
}

function currentHeaderIndex(table: HTMLTableElement, header: HTMLTableCellElement) {
  return headerCellsOf(table).indexOf(header);
}

function setColumnWidth(table: HTMLTableElement, index: number, width: number) {
  const px = `${Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))}px`;

  for (const row of Array.from(table.rows)) {
    if (row.cells.length === 1 && row.cells[0]?.colSpan > 1) continue;
    const cell = row.cells[index] as HTMLTableCellElement | undefined;
    if (!cell || cell.colSpan !== 1) continue;
    cell.style.width = px;
    cell.style.minWidth = px;
    cell.style.maxWidth = px;
    cell.classList.add("global-column-sized");
  }
}

function clearColumnWidth(table: HTMLTableElement, index: number) {
  for (const row of Array.from(table.rows)) {
    if (row.cells.length === 1 && row.cells[0]?.colSpan > 1) continue;
    const cell = row.cells[index] as HTMLTableCellElement | undefined;
    if (!cell || cell.colSpan !== 1) continue;
    cell.style.removeProperty("width");
    cell.style.removeProperty("min-width");
    cell.style.removeProperty("max-width");
    cell.classList.remove("global-column-sized");
  }
}

function canReorderColumns(table: HTMLTableElement, headerCount: number) {
  if (table.dataset.reorderable === "false") return false;
  if (table.tHead && table.tHead.rows.length > 1) return false;

  for (const row of Array.from(table.rows)) {
    const cells = Array.from(row.cells);
    if (cells.length === 1 && cells[0]?.colSpan === headerCount) continue;
    if (cells.length !== headerCount) return false;
    if (cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return false;
  }
  return true;
}

function normalizedStoredOrder(currentIds: string[], storedOrder: string[]) {
  const currentSet = new Set(currentIds);
  const next = storedOrder.filter((id) => currentSet.has(id));
  for (const id of currentIds) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

function applyColumnOrder(table: HTMLTableElement, requestedOrder: string[]) {
  const headers = headerCellsOf(table);
  if (headers.length === 0) return false;

  assignColumnIds(headers);
  const originalOrder = originalColumnOrder(table, headers);
  assignRowColumnIds(table, originalOrder);

  const currentHeaderIds = headers.map((header) => header.dataset.globalColumnId || "");
  const nextIds = normalizedStoredOrder(originalOrder, requestedOrder);
  if (nextIds.length !== originalOrder.length) return false;

  let changed = false;
  for (const row of Array.from(table.rows)) {
    const cells = Array.from(row.cells);
    if (cells.length === 1 && cells[0]?.colSpan === originalOrder.length) continue;
    if (cells.length !== originalOrder.length) continue;

    const cellById = new Map(
      cells
        .map((cell) => [cell.dataset.globalColumnId || "", cell] as const)
        .filter(([id]) => Boolean(id)),
    );
    if (cellById.size !== originalOrder.length) continue;

    const currentIds = cells.map((cell) => cell.dataset.globalColumnId || "");
    if (nextIds.every((id, index) => id === currentIds[index])) continue;

    const fragment = document.createDocumentFragment();
    for (const id of nextIds) {
      const cell = cellById.get(id);
      if (cell) fragment.appendChild(cell);
    }
    row.appendChild(fragment);
    changed = true;
  }

  // header 是逻辑列顺序的事实来源；若只新增了 tbody 行，也要允许单独重排新行。
  return changed || nextIds.some((id, index) => id !== currentHeaderIds[index]);
}

function clearDropIndicators(table: HTMLTableElement) {
  for (const header of headerCellsOf(table)) {
    header.classList.remove("global-column-drop-before", "global-column-drop-after", "global-column-dragging");
    delete header.dataset.globalDropPosition;
  }
}

function installResizeHandle(
  table: HTMLTableElement,
  header: HTMLTableCellElement,
  widthsKey: string,
) {
  if (header.querySelector(":scope > .global-column-resizer")) return;

  const handle = document.createElement("span");
  handle.className = "global-column-resizer";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", `调整“${normalizeText(header.textContent) || "当前列"}”列宽`);
  handle.title = "拖动调整列宽；双击恢复默认宽度";

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const index = currentHeaderIndex(table, header);
    if (index < 0) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    document.documentElement.classList.add("global-column-resizing");
    handle.classList.add("is-active");

    const onMove = (moveEvent: PointerEvent) => {
      const currentIndex = currentHeaderIndex(table, header);
      if (currentIndex < 0) return;
      setColumnWidth(table, currentIndex, startWidth + moveEvent.clientX - startX);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.classList.remove("global-column-resizing");
      handle.classList.remove("is-active");

      const columnId = header.dataset.globalColumnId;
      if (!columnId) return;
      const finalWidth = header.getBoundingClientRect().width;
      const current = readWidths(widthsKey);
      current[columnId] = Math.round(finalWidth);
      writeWidths(widthsKey, current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const index = currentHeaderIndex(table, header);
    const columnId = header.dataset.globalColumnId;
    if (index < 0 || !columnId) return;

    clearColumnWidth(table, index);
    const current = readWidths(widthsKey);
    delete current[columnId];
    writeWidths(widthsKey, current);
  });

  header.appendChild(handle);
}

function installReorderHandle(
  table: HTMLTableElement,
  header: HTMLTableCellElement,
  orderKey: string,
) {
  if (header.querySelector(":scope > .global-column-dragger")) return;

  if (header.dataset.globalReorderEvents !== "1") {
    header.dataset.globalReorderEvents = "1";

    header.addEventListener("dragover", (event) => {
      if (!activeColumnDrag || activeColumnDrag.table !== table) return;
      const targetId = header.dataset.globalColumnId;
      if (!targetId || targetId === activeColumnDrag.columnId) return;

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      clearDropIndicators(table);
      const rect = header.getBoundingClientRect();
      const position = event.clientX >= rect.left + rect.width / 2 ? "after" : "before";
      header.dataset.globalDropPosition = position;
      header.classList.add(position === "after" ? "global-column-drop-after" : "global-column-drop-before");
    });

    header.addEventListener("drop", (event) => {
      if (!activeColumnDrag || activeColumnDrag.table !== table) return;

      event.preventDefault();
      event.stopPropagation();

      const sourceId = activeColumnDrag.columnId;
      const targetId = header.dataset.globalColumnId;
      const position = header.dataset.globalDropPosition === "after" ? "after" : "before";
      const currentIds = headerCellsOf(table)
        .map((cell) => cell.dataset.globalColumnId || "")
        .filter(Boolean);

      if (targetId && sourceId !== targetId) {
        const next = currentIds.filter((id) => id !== sourceId);
        const targetIndex = next.indexOf(targetId);
        if (targetIndex >= 0) {
          next.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
          writeOrder(orderKey, next);
          applyColumnOrder(table, next);
        }
      }

      clearDropIndicators(table);
      activeColumnDrag = null;
      document.documentElement.classList.remove("global-column-reordering");
    });
  }

  const handle = document.createElement("span");
  handle.className = "global-column-dragger";
  handle.draggable = true;
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", `移动“${normalizeText(header.textContent) || "当前列"}”位置`);
  handle.title = "拖动调整列的位置";

  handle.addEventListener("dragstart", (event) => {
    const columnId = header.dataset.globalColumnId;
    if (!columnId) {
      event.preventDefault();
      return;
    }

    activeColumnDrag = { table, columnId };
    header.classList.add("global-column-dragging");
    document.documentElement.classList.add("global-column-reordering");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", columnId);
      const ghost = header.cloneNode(true) as HTMLElement;
      ghost.style.position = "fixed";
      ghost.style.top = "-1000px";
      ghost.style.left = "-1000px";
      ghost.style.width = `${Math.max(80, header.getBoundingClientRect().width)}px`;
      ghost.style.background = "white";
      ghost.style.padding = "8px";
      ghost.style.border = "1px solid #cbd5e1";
      ghost.style.borderRadius = "6px";
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      window.setTimeout(() => ghost.remove(), 0);
    }
  });

  handle.addEventListener("dragend", () => {
    clearDropIndicators(table);
    activeColumnDrag = null;
    document.documentElement.classList.remove("global-column-reordering");
  });

  header.appendChild(handle);
}

function installTableControls(table: HTMLTableElement, tableIndex: number) {
  if (table.dataset.resizable === "false") return;

  let headers = headerCellsOf(table);
  if (headers.length === 0) return;
  assignColumnIds(headers);
  const originalOrder = originalColumnOrder(table, headers);
  assignRowColumnIds(table, originalOrder);

  table.dataset.globalResizableInstalled = "1";
  table.classList.add("global-resizable-table");

  const parent = table.parentElement;
  if (parent) parent.classList.add("global-table-scroll-host");

  const widthsKey = widthStorageKey(table, tableIndex);
  const orderKey = orderStorageKey(table, tableIndex);

  // 兼容第一版按“列序号”保存的列宽：首次遇到时迁移到稳定列 ID。
  let widths = readWidths(widthsKey);
  if (Object.keys(widths).length === 0) {
    const legacy = readWidths(legacyWidthStorageKey(table, tableIndex));
    if (Object.keys(legacy).length > 0) {
      const migrated: WidthMap = {};
      headers.forEach((header, index) => {
        const width = legacy[String(index)];
        const columnId = header.dataset.globalColumnId;
        if (columnId && Number.isFinite(width)) migrated[columnId] = width;
      });
      widths = migrated;
      if (Object.keys(migrated).length > 0) writeWidths(widthsKey, migrated);
    }
  }

  const reorderable = canReorderColumns(table, headers.length);
  if (reorderable) {
    const storedOrder = readOrder(orderKey);
    if (storedOrder.length > 0) {
      applyColumnOrder(table, storedOrder);
      headers = headerCellsOf(table);
      assignColumnIds(headers);
    }
    table.classList.add("global-reorderable-table");
  } else {
    table.classList.remove("global-reorderable-table");
  }

  headers.forEach((header) => {
    const columnId = header.dataset.globalColumnId;
    if (!columnId) return;

    const index = currentHeaderIndex(table, header);
    const saved = widths[columnId];
    if (index >= 0 && Number.isFinite(saved) && saved >= MIN_WIDTH) {
      setColumnWidth(table, index, saved);
    }

    installResizeHandle(table, header, widthsKey);
    if (reorderable) installReorderHandle(table, header, orderKey);
  });
}

function scanTables(root: ParentNode = document) {
  const tables = Array.from(root.querySelectorAll("table")) as HTMLTableElement[];
  tables.forEach((table, index) => installTableControls(table, index));
}

export default function GlobalResizableTables() {
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => scanTables());
    const pendingTables = new Set<HTMLTableElement>();

    const scheduleTables = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (pendingTables.size === 0) return;
        const allTables = Array.from(document.querySelectorAll("table")) as HTMLTableElement[];
        for (const table of Array.from(pendingTables)) {
          pendingTables.delete(table);
          if (!table.isConnected) continue;
          const index = allTables.indexOf(table);
          installTableControls(table, index >= 0 ? index : 0);
        }
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;

        if (mutation.target instanceof Element) {
          const owner = mutation.target.closest("table");
          if (owner instanceof HTMLTableElement) pendingTables.add(owner);
        }

        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (node instanceof HTMLTableElement) pendingTables.add(node);
          for (const table of Array.from(node.querySelectorAll("table"))) {
            if (table instanceof HTMLTableElement) pendingTables.add(table);
          }
        }
      }

      if (pendingTables.size > 0) scheduleTables();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      pendingTables.clear();
      observer.disconnect();
      activeColumnDrag = null;
      document.documentElement.classList.remove("global-column-resizing", "global-column-reordering");
    };
  }, []);

  return null;
}
