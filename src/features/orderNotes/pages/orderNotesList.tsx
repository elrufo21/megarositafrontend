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
import { Eye, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { loadOrderNoteView } from "@/features/orderNotes/orderNoteViewLoader";

const columnHelper = createColumnHelper<OrderNote>();
const ORDER_NOTES_RANGE_STORAGE_KEY = "sgo.orderNotes.range";
const DEFAULT_ORDER_NOTES_PAGE_SIZE = 50;

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
const getCustomerDni = (note: OrderNote) => note.clienteDni || "-";
const getCustomerRuc = (note: OrderNote) => note.clienteRuc || "-";

const OrderNotesList = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { notes, fetchNotes, loading } = useOrderNoteStore();
  const [openingNoteId, setOpeningNoteId] = useState<string | null>(null);
  const initialDate = useMemo(() => getLocalDateISO(), []);
  const resetRangeFromMainLayout = useMemo(() => {
    if (!state || typeof state !== "object") return false;
    return (state as Record<string, unknown>).resetOrderNotesFilters === true;
  }, [state]);
  const initialRange = useMemo(() => {
    const returnState =
      state && typeof state === "object"
        ? (state as Record<string, unknown>).orderNotesReturnState
        : null;
    if (
      !resetRangeFromMainLayout &&
      returnState &&
      typeof returnState === "object"
    ) {
      const record = returnState as Record<string, unknown>;
      const from = String(record.fechaInicio ?? "").trim();
      const to = String(record.fechaFin ?? "").trim();
      if (from && to && from <= to) return { from, to };
    }

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
  }, [initialDate, resetRangeFromMainLayout, state]);
  const [fechaInicio, setFechaInicio] = useState(initialRange.from);
  const [fechaFin, setFechaFin] = useState(initialRange.to);
  const [tableSearch, setTableSearch] = useState(() => {
    if (resetRangeFromMainLayout || !state || typeof state !== "object") {
      return "";
    }
    const returnState = (state as Record<string, unknown>)
      .orderNotesReturnState;
    return returnState && typeof returnState === "object"
      ? String((returnState as Record<string, unknown>).tableSearch ?? "")
      : "";
  });
  const fechaInicioRef = useRef(fechaInicio);
  const fechaFinRef = useRef(fechaFin);
  const endDateAcceptedRef = useRef(false);
  const hasBootstrappedFetchRef = useRef(false);
  const lastFetchedRangeRef = useRef<{
    from: string;
    to: string;
  } | null>({
    from: initialRange.from,
    to: initialRange.to,
  });

  useEffect(() => {
    fechaInicioRef.current = fechaInicio;
  }, [fechaInicio]);

  useEffect(() => {
    fechaFinRef.current = fechaFin;
  }, [fechaFin]);

  const requestNotesByRange = useCallback(
    (fromValue: string, toValue: string) => {
      const from = String(fromValue ?? "").trim();
      const to = String(toValue ?? "").trim();

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
      });
      lastFetchedRangeRef.current = {
        from,
        to,
      };
      return true;
    },
    [fetchNotes],
  );

  useEffect(() => {
    if (!resetRangeFromMainLayout || typeof window === "undefined") return;
    window.sessionStorage.removeItem(ORDER_NOTES_RANGE_STORAGE_KEY);
  }, [resetRangeFromMainLayout]);

  useEffect(() => {
    if (hasBootstrappedFetchRef.current) return;
    hasBootstrappedFetchRef.current = true;
    requestNotesByRange(fechaInicioRef.current, fechaFinRef.current);
  }, [requestNotesByRange]);

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
    requestNotesByRange(fechaInicio, fechaFin);
  }, [fechaFin, fechaInicio, requestNotesByRange]);

  const parsePickerDate = useCallback((value: Dayjs | null) => {
    const formatted = value?.format("YYYY-MM-DD") ?? "";
    return formatted.trim();
  }, []);

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
                      orderNotesReturnState: {
                        fechaInicio,
                        fechaFin,
                        tableSearch,
                      },
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
      columnHelper.display({
        id: "clienteDni",
        header: "DNI",
        cell: ({ row }) => getCustomerDni(row.original),
      }),
      columnHelper.display({
        id: "clienteRuc",
        header: "RUC",
        cell: ({ row }) => getCustomerRuc(row.original),
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
            : value.includes("CANCELAD")
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : value.includes("EMITID")
                ? "bg-cyan-100 text-cyan-700 border-cyan-200"
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
    [fechaFin, fechaInicio, navigate, openingNoteId, tableSearch],
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
          "clienteDni",
          "clienteRuc",
          "formaPago",
          "usuario",
        ]}
        globalFilterValue={tableSearch}
        onGlobalFilterValueChange={setTableSearch}
        pageSize={DEFAULT_ORDER_NOTES_PAGE_SIZE}
        pageSizeOptions={[20, 50, 100]}
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
                    requestNotesByRange(fechaInicioRef.current, nextValue);
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
                      lastRange.to !== currentEnd;

                    if (mustFetch) {
                      requestNotesByRange(currentStart, currentEnd);
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
      />
    </div>
  );
};

export default OrderNotesList;
