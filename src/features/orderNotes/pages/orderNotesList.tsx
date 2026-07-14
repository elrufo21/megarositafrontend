import DataTable from "@/components/DataTable";
import { BackArrowButton } from "@/components/common/BackArrowButton";
import { getLocalDateISO } from "@/shared/helpers/localDate";
import { toast } from "@/shared/ui/toast";
import { useOrderNoteStore } from "@/store/orderNote/orderNote.store";
import type { OrderNote } from "@/types/orderNote";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { esES } from "@mui/x-date-pickers/locales";
import { createColumnHelper } from "@tanstack/react-table";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/es";
import { Workbook } from "exceljs";
import { Eye, FileSpreadsheet, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { loadOrderNoteView } from "@/features/orderNotes/orderNoteViewLoader";

const columnHelper = createColumnHelper<OrderNote>();
const ORDER_NOTES_RANGE_STORAGE_KEY = "sgo.orderNotes.range";
const DEFAULT_ORDER_NOTES_PAGE = 1;
const DEFAULT_ORDER_NOTES_PAGE_SIZE = 50;
const MIN_ORDER_NOTES_PAGE_SIZE = 1;
const MAX_ORDER_NOTES_PAGE_SIZE = 100;

const parseAmount = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const normalized = raw.replace(/[^\d,.-]/g, "");
  if (!normalized) return 0;

  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  let sanitized = normalized;
  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    sanitized =
      lastComma > lastDot
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (hasComma) {
    sanitized = normalized.replace(",", ".");
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmount = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const splitDocumentLabel = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { tipoDocumento: "", numeroDocumento: "" };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return { tipoDocumento: tokens[0], numeroDocumento: "" };
  }

  const lastToken = tokens[tokens.length - 1] ?? "";
  const looksLikeDocumentNumber =
    /[A-Z0-9]+-\d+/i.test(lastToken) || lastToken.includes("-");

  if (looksLikeDocumentNumber) {
    return {
      tipoDocumento: tokens.slice(0, -1).join(" "),
      numeroDocumento: lastToken,
    };
  }

  return {
    tipoDocumento: tokens[0],
    numeroDocumento: tokens.slice(1).join(" "),
  };
};

const isAnnulledStatus = (value: unknown) =>
  String(value ?? "")
    .toUpperCase()
    .includes("ANULAD");

const isCreditNoteDocument = (value: unknown) => {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return (
    normalized.includes("CREDITO") ||
    normalized.includes("N/C") ||
    normalized.startsWith("NC")
  );
};

const isProformaVDocument = (value: unknown) => {
  const normalized = String(
    splitDocumentLabel(value).tipoDocumento || value || "",
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return normalized.includes("PROFORMA");
};

const getSignedTotal = (
  note: Pick<OrderNote, "estado" | "documento">,
  value: unknown,
) => {
  const amount = parseAmount(value);
  if (isCreditNoteDocument(note.documento)) {
    return Math.abs(amount);
  }
  return amount;
};

const OrderNotesList = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { notes, fetchNotes, loading, page, pageSize, total } =
    useOrderNoteStore();
  const [openingNoteId, setOpeningNoteId] = useState<string | null>(null);
  const initialDate = useMemo(() => getLocalDateISO(), []);
  const resetRangeFromMainLayout = useMemo(() => {
    if (!state || typeof state !== "object") return false;
    return (state as Record<string, unknown>).resetOrderNotesFilters === true;
  }, [state]);
  const initialRange = useMemo(() => {
    if (resetRangeFromMainLayout) {
      return { from: initialDate, to: initialDate };
    }

    if (typeof window === "undefined") {
      return { from: initialDate, to: initialDate };
    }

    try {
      const raw = window.sessionStorage.getItem(ORDER_NOTES_RANGE_STORAGE_KEY);
      if (!raw) return { from: initialDate, to: initialDate };
      const parsed = JSON.parse(raw) as {
        from?: unknown;
        to?: unknown;
      } | null;
      const from = String(parsed?.from ?? "").trim();
      const to = String(parsed?.to ?? "").trim();
      if (!from || !to || from > to) {
        return { from: initialDate, to: initialDate };
      }
      return { from, to };
    } catch {
      return { from: initialDate, to: initialDate };
    }
  }, [initialDate, resetRangeFromMainLayout]);
  const [fechaInicio, setFechaInicio] = useState(initialRange.from);
  const [fechaFin, setFechaFin] = useState(initialRange.to);
  const [tableSearch, setTableSearch] = useState("");
  const fechaInicioRef = useRef(fechaInicio);
  const fechaFinRef = useRef(fechaFin);
  const endDateAcceptedRef = useRef(false);
  const hasBootstrappedFetchRef = useRef(false);
  const lastFetchedRangeRef = useRef<{
    from: string;
    to: string;
    page: number;
    pageSize: number;
  } | null>({
    from: initialRange.from,
    to: initialRange.to,
    page: DEFAULT_ORDER_NOTES_PAGE,
    pageSize: DEFAULT_ORDER_NOTES_PAGE_SIZE,
  });

  useEffect(() => {
    fechaInicioRef.current = fechaInicio;
  }, [fechaInicio]);

  useEffect(() => {
    fechaFinRef.current = fechaFin;
  }, [fechaFin]);

  const sanitizePage = useCallback((value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
      return DEFAULT_ORDER_NOTES_PAGE;
    return Math.floor(numeric);
  }, []);

  const sanitizePageSize = useCallback((value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return DEFAULT_ORDER_NOTES_PAGE_SIZE;
    }
    const floored = Math.floor(numeric);
    return Math.max(
      MIN_ORDER_NOTES_PAGE_SIZE,
      Math.min(MAX_ORDER_NOTES_PAGE_SIZE, floored),
    );
  }, []);

  const requestNotesByRange = useCallback(
    (
      fromValue: string,
      toValue: string,
      options?: { page?: number; pageSize?: number },
    ) => {
      const from = String(fromValue ?? "").trim();
      const to = String(toValue ?? "").trim();
      const nextPage = sanitizePage(options?.page ?? page);
      const nextPageSize = sanitizePageSize(options?.pageSize ?? pageSize);

      if (!from || !to) {
        toast.error("Debes seleccionar fecha inicio y fecha fin.");
        return false;
      }

      if (from > to) {
        toast.error("La fecha inicio no puede ser mayor que la fecha fin.");
        return false;
      }

      void fetchNotes({
        fechaInicio: from,
        fechaFin: to,
        page: nextPage,
        pageSize: nextPageSize,
      });
      lastFetchedRangeRef.current = {
        from,
        to,
        page: nextPage,
        pageSize: nextPageSize,
      };
      return true;
    },
    [fetchNotes, page, pageSize, sanitizePage, sanitizePageSize],
  );

  useEffect(() => {
    if (!resetRangeFromMainLayout || typeof window === "undefined") return;
    window.sessionStorage.removeItem(ORDER_NOTES_RANGE_STORAGE_KEY);
  }, [resetRangeFromMainLayout]);

  useEffect(() => {
    if (hasBootstrappedFetchRef.current) return;
    hasBootstrappedFetchRef.current = true;
    requestNotesByRange(fechaInicioRef.current, fechaFinRef.current, {
      page: DEFAULT_ORDER_NOTES_PAGE,
      pageSize: sanitizePageSize(pageSize),
    });
  }, [pageSize, requestNotesByRange, sanitizePageSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const from = String(fechaInicio ?? "").trim();
    const to = String(fechaFin ?? "").trim();
    if (!from || !to || from > to) return;
    window.sessionStorage.setItem(
      ORDER_NOTES_RANGE_STORAGE_KEY,
      JSON.stringify({ from, to }),
    );
  }, [fechaFin, fechaInicio]);

  const handleSearch = useCallback(() => {
    requestNotesByRange(fechaInicio, fechaFin, {
      page: DEFAULT_ORDER_NOTES_PAGE,
      pageSize: sanitizePageSize(pageSize),
    });
  }, [fechaFin, fechaInicio, pageSize, requestNotesByRange, sanitizePageSize]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      requestNotesByRange(fechaInicioRef.current, fechaFinRef.current, {
        page: nextPage,
        pageSize: sanitizePageSize(pageSize),
      });
    },
    [pageSize, requestNotesByRange, sanitizePageSize],
  );

  const handlePageSizeChange = useCallback(
    (nextPageSize: number) => {
      requestNotesByRange(fechaInicioRef.current, fechaFinRef.current, {
        page: DEFAULT_ORDER_NOTES_PAGE,
        pageSize: nextPageSize,
      });
    },
    [requestNotesByRange],
  );

  const parsePickerDate = useCallback((value: Dayjs | null) => {
    const formatted = value?.format("YYYY-MM-DD") ?? "";
    return formatted.trim();
  }, []);
  const toExcelSafeText = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };
  const handleExportExcel = useCallback(async () => {
    if (!notes.length) {
      toast.info("No hay datos para exportar.");
      return;
    }

    try {
      const workbook = new Workbook();
      workbook.creator = "SGO";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Notas de Pedido", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      worksheet.columns = [
        { header: "ID Nota", key: "notaId", width: 12 },
        { header: "Tipo Documento", key: "tipoDocumento", width: 20 },
        { header: "N° Documento", key: "numeroDocumento", width: 18 },
        { header: "Fecha", key: "fecha", width: 14 },
        { header: "Cliente", key: "cliente", width: 34 },
        { header: "Forma Pago", key: "formaPago", width: 18 },
        { header: "Total", key: "total", width: 14 },
        { header: "A cuenta", key: "acuenta", width: 14 },
        { header: "Saldo", key: "saldo", width: 14 },
        { header: "Usuario", key: "usuario", width: 18 },
        { header: "Estado", key: "estado", width: 14 },
      ];

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount },
      };

      const headerRow = worksheet.getRow(1);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "B23636" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      });

      notes.forEach((note, index) => {
        const { tipoDocumento, numeroDocumento } = splitDocumentLabel(
          note.documento,
        );

        const excelRow = worksheet.addRow({
          notaId: toExcelSafeText(note.notaId),
          tipoDocumento: toExcelSafeText(tipoDocumento || "-"),
          numeroDocumento: toExcelSafeText(numeroDocumento || "-"),
          fecha: toExcelSafeText(note.fecha),
          cliente: toExcelSafeText(note.cliente),
          formaPago: toExcelSafeText(note.formaPago),
          total: Number(getSignedTotal(note, note.total).toFixed(2)),
          acuenta: Number(parseAmount(note.acuenta).toFixed(2)),
          saldo: Number(parseAmount(note.saldo).toFixed(2)),
          usuario: toExcelSafeText(note.usuario),
          estado: toExcelSafeText(note.estado),
        });

        excelRow.eachCell((cell, colNumber) => {
          const isAmountColumn = colNumber >= 7 && colNumber <= 9;

          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };

          cell.alignment = {
            vertical: "top",
            horizontal: isAmountColumn ? "right" : "left",
            wrapText: colNumber === 5,
          };

          if (isAmountColumn) {
            cell.numFmt = "#,##0.00";
          }
        });

        if (index % 2 === 1) {
          excelRow.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF8FAFC" },
            };
          });
        }
      });

      const totalGeneral = notes.reduce(
        (acc, note) => acc + getSignedTotal(note, note.total),
        0,
      );

      const acuentaGeneral = notes.reduce(
        (acc, note) => acc + parseAmount(note.acuenta),
        0,
      );

      const saldoGeneral = notes.reduce(
        (acc, note) => acc + parseAmount(note.saldo),
        0,
      );

      worksheet.addRow({});

      const totalsRow = worksheet.addRow({
        notaId: `Items: ${notes.length}`,
        formaPago: "Totales S/",
        total: Number(totalGeneral.toFixed(2)),
        acuenta: Number(acuentaGeneral.toFixed(2)),
        saldo: Number(saldoGeneral.toFixed(2)),
      });

      totalsRow.eachCell((cell, colNumber) => {
        const isAmountColumn = colNumber >= 7 && colNumber <= 9;
        const isLabelColumn = colNumber === 1 || colNumber === 6;

        cell.font = { bold: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCBD5E1" } },
          left: { style: "thin", color: { argb: "FFCBD5E1" } },
          bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
          right: { style: "thin", color: { argb: "FFCBD5E1" } },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2E8F0" },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: isAmountColumn ? "right" : "left",
        };

        if (isLabelColumn) {
          cell.alignment = { vertical: "middle", horizontal: "left" };
        }

        if (isAmountColumn) {
          cell.numFmt = "#,##0.00";
        }
      });

      const safeFilePart = (value?: string) =>
        String(value || "sin-fecha").replace(/[\/\\:*?"<>|]/g, "-");

      const fileFrom = safeFilePart(fechaInicio);
      const fileTo = safeFilePart(fechaFin);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `notas-pedido_${fileFrom}_${fileTo}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      toast.success("Excel generado correctamente.");
    } catch (error) {
      console.error("Error al exportar Excel de notas de pedido", error);
      toast.error("No se pudo exportar el archivo Excel.");
    }
  }, [fechaFin, fechaInicio, notes]);

  const solesTotals = useMemo(() => {
    const totals = notes.reduce(
      (acc, note) => {
        if (isAnnulledStatus(note.estado)) {
          return acc;
        }
        const amount = parseAmount(note.total);
        const formaPago = String(note.formaPago ?? "").toUpperCase();
        const isCash =
          formaPago.includes("EFECT") || formaPago.includes("CONTADO");

        if (isCash) {
          acc.efectivo += amount;
        } else {
          acc.depTarYape += amount;
        }
        return acc;
      },
      { efectivo: 0, depTarYape: 0 },
    );

    return {
      efectivo: totals.efectivo,
      depTarYape: totals.depTarYape,
      total: totals.efectivo + totals.depTarYape,
    };
  }, [notes]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "ver",
        header: "Ver",
        cell: ({ row }) => {
          const noteId = row.original.notaId;
          const isOpening = openingNoteId === noteId;
          return (
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 lg:h-auto lg:w-auto lg:rounded-none lg:text-sm lg:font-medium lg:hover:bg-transparent lg:hover:underline"
              aria-label={isOpening ? "Cargando venta" : "Ver venta"}
              title={isOpening ? "Cargando..." : "Ver venta"}
              disabled={openingNoteId !== null}
              onPointerEnter={() => void loadOrderNoteView(Number(noteId))}
              onFocus={() => void loadOrderNoteView(Number(noteId))}
              onClick={async () => {
                setOpeningNoteId(noteId);
                try {
                  await loadOrderNoteView(Number(noteId));
                  navigate(`/sales/order_notes/${noteId}/view`, {
                    state: {
                      fromOrderNotesViewButton: true,
                      orderNote: row.original,
                    },
                  });
                } catch (error) {
                  console.error("Error al cargar nota de pedido", error);
                  toast.error("No se pudo cargar el registro.");
                  setOpeningNoteId(null);
                }
              }}
            >
              {isOpening ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  <Eye className="h-5 w-5 lg:hidden" aria-hidden="true" />
                  <span className="hidden lg:inline">Ver</span>
                </>
              )}
            </button>
          );
        },
      }),
      columnHelper.accessor("notaId", {
        header: "ID Nota",
        cell: (info) => info.getValue(),
      }),
      columnHelper.display({
        id: "tipoDocumento",
        header: "Documento",
        cell: ({ row }) =>
          splitDocumentLabel(row.original.documento).tipoDocumento || "-",
      }),
      columnHelper.display({
        id: "Número",
        header: "N° Documento",
        cell: ({ row }) =>
          splitDocumentLabel(row.original.documento).numeroDocumento || "-",
      }),
      columnHelper.accessor("fecha", {
        header: "Fecha",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("cliente", {
        header: "Cliente",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("formaPago", {
        header: "Forma Pago",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("total", {
        header: "Total",
        cell: ({ row }) =>
          formatAmount(getSignedTotal(row.original, row.original.total)),
        meta: { tdClassName: "text-right" },
      }),
      columnHelper.accessor("acuenta", {
        header: "A cuenta",
        cell: (info) => info.getValue(),
        meta: { tdClassName: "text-right" },
      }),
      columnHelper.accessor("saldo", {
        header: "Saldo",
        cell: (info) => info.getValue(),
        meta: { tdClassName: "text-right" },
      }),
      columnHelper.accessor("usuario", {
        header: "Usuario",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("estado", {
        header: "Estado",
        cell: (info) => {
          const value = String(info.getValue() ?? "").toUpperCase() || "-";
          const stateClass = isAnnulledStatus(value)
            ? "bg-red-100 text-red-700 border-red-200"
            : value === "PENDIENTE"
              ? "bg-amber-100 text-amber-700 border-amber-200"
              : value === "-"
                ? "bg-slate-100 text-slate-600 border-slate-200"
                : "bg-emerald-100 text-emerald-700 border-emerald-200";
          return (
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${stateClass}`}
            >
              {value}
            </span>
          );
        },
      }),
    ],
    [navigate, openingNoteId],
  );

  return (
    <div className="p-3 sm:p-4">
      {openingNoteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
          <div className="flex min-w-[220px] flex-col items-center gap-3 rounded-xl bg-white px-6 py-5 text-slate-800 shadow-2xl">
            <Loader2 className="h-7 w-7 animate-spin text-[#B23636]" />
            <span className="text-sm font-semibold">Cargando registro...</span>
          </div>
        </div>
      )}
      <div className="mb-3">
        <h1 className="text-2xl font-semibold text-[#0f2748]">Nota Pedidos</h1>
      </div>

      <DataTable
        columns={columns}
        data={notes}
        isLoading={loading}
        filterKeys={[
          "notaId",
          "cliente",
          "estado",
          "estadoSunat",
          "fecha",
          "documento",
          "formaPago",
          "usuario",
        ]}
        globalFilterValue={tableSearch}
        onGlobalFilterValueChange={setTableSearch}
        manualPagination
        page={page}
        pageSize={sanitizePageSize(pageSize)}
        totalRows={Math.max(0, total)}
        pageSizeOptions={[20, 50, 100]}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        toolbarLeading={
          <BackArrowButton className="inline-flex  items-center justify-center  text-slate-700 hover:bg-slate-100 transition-colors" />
        }
        renderFilters={
          <LocalizationProvider
            dateAdapter={AdapterDayjs}
            adapterLocale="es"
            localeText={
              esES.components.MuiLocalizationProvider.defaultProps.localeText
            }
          >
            <div className="grid w-full grid-cols-1 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="flex min-w-0 w-full flex-col gap-1 text-xs text-slate-600">
                Fecha Inicio
                <DatePicker
                  format="DD/MM/YY"
                  value={fechaInicio ? dayjs(fechaInicio) : null}
                  onChange={(value) => {
                    setFechaInicio(parsePickerDate(value));
                  }}
                  slotProps={{
                    textField: {
                      size: "small",
                      sx: {
                        width: "100%",
                        "& .MuiOutlinedInput-root": {
                          height: 44,
                          borderRadius: "0.5rem",
                          backgroundColor: "#ffffff",
                        },
                      },
                    },
                  }}
                />
              </label>

              <label className="flex min-w-0 w-full flex-col gap-1 text-xs text-slate-600">
                Fecha Fin
                <DatePicker
                  format="DD/MM/YY"
                  value={fechaFin ? dayjs(fechaFin) : null}
                  onOpen={() => {
                    endDateAcceptedRef.current = false;
                  }}
                  onChange={(value) => {
                    setFechaFin(parsePickerDate(value));
                  }}
                  onAccept={(value) => {
                    const nextValue = parsePickerDate(value);
                    endDateAcceptedRef.current = true;
                    setFechaFin(nextValue);
                    requestNotesByRange(fechaInicioRef.current, nextValue, {
                      page: DEFAULT_ORDER_NOTES_PAGE,
                      pageSize: sanitizePageSize(pageSize),
                    });
                  }}
                  onClose={() => {
                    if (endDateAcceptedRef.current) {
                      endDateAcceptedRef.current = false;
                      return;
                    }

                    const currentStart = fechaInicioRef.current;
                    const currentEnd = fechaFinRef.current;
                    const lastRange = lastFetchedRangeRef.current;
                    const mustFetch =
                      !lastRange ||
                      lastRange.from !== currentStart ||
                      lastRange.to !== currentEnd ||
                      lastRange.page !== page ||
                      lastRange.pageSize !== sanitizePageSize(pageSize);

                    if (mustFetch) {
                      requestNotesByRange(currentStart, currentEnd, {
                        page: DEFAULT_ORDER_NOTES_PAGE,
                        pageSize: sanitizePageSize(pageSize),
                      });
                    }
                  }}
                  slotProps={{
                    textField: {
                      size: "small",
                      sx: {
                        width: "100%",
                        "& .MuiOutlinedInput-root": {
                          height: 44,
                          borderRadius: "0.5rem",
                          backgroundColor: "#ffffff",
                        },
                      },
                    },
                  }}
                />
              </label>

              <div className="relative group justify-self-start sm:justify-self-end">
                <button
                  type="button"
                  onClick={handleSearch}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white transition-colors hover:bg-slate-700"
                  aria-label="Buscar"
                >
                  <Search className="h-4 w-4" />
                </button>
                <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
                  Buscar
                </span>
              </div>
            </div>
          </LocalizationProvider>
        }
        footerContent={
          <div className="flex justify-end">
            {/**   <div className="grid w-full max-w-3xl grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3">
              <div className="border-b border-slate-200 px-4 py-3 text-right sm:border-b-0 sm:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  SOLES - EFECTIVO
                </p>
                <p className="text-xl font-semibold text-slate-800">
                  {formatAmount(solesTotals.efectivo)}
                </p>
              </div>

              <div className="border-b border-slate-200 px-4 py-3 text-right sm:border-b-0 sm:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  SOLES - DEP/TAR/YAPE
                </p>
                <p className="text-xl font-semibold text-slate-800">
                  {formatAmount(solesTotals.depTarYape)}
                </p>
              </div>

              <div className="px-4 py-3 text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  SOLES - TOTAL
                </p>
                <p className="text-xl font-semibold text-slate-900">
                  {formatAmount(solesTotals.total)}
                </p>
              </div>
            </div> */}
          </div>
        }
      />
    </div>
  );
};

export default OrderNotesList;
