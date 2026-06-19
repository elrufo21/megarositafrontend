import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { createColumnHelper } from "@tanstack/react-table";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ShoppingCart,
  TableProperties,
  Trash2,
  X,
} from "lucide-react";
import DataTable from "@/components/DataTable";
import NavigableNumberInput from "@/components/inputs/NavigableNumberInput";
import { useProductsStore } from "@/store/products/products.store";
import { usePosStore, selectTotals } from "@/store/pos/pos.store";
import { useDialogStore } from "@/store/app/dialog.store";
import { usePosCartDraftPersistence } from "@/features/pos/hooks/usePosCartDraftPersistence";
import type { Product } from "@/types/product";
import type { ProductUnitOption } from "@/types/product";
import type { PosCartItem } from "@/types/pos";
import { toast } from "@/shared/ui/toast";
import { apiRequest } from "@/shared/helpers/apiRequest";
import { buildApiUrl } from "@/config";

type PosCatalogProduct = Product & {
  catalogKey: string;
  detalleId?: number;
  isVariation?: boolean;
  baseProductId?: number;
  valorUM?: number;
};

type PersonalByCodeResponse = {
  personalEstado?: string;
  nombreApellido?: string;
};

type AuthSessionPayload = {
  user?: {
    companyId?: unknown;
    displayName?: unknown;
    username?: unknown;
  };
};

type PersonalCodeFieldProps = {
  onInputRef: (node: HTMLInputElement | null) => void;
  onEnter?: () => void;
};

const PersonalCodeField = ({ onInputRef, onEnter }: PersonalCodeFieldProps) => {
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  return (
    <div className="relative">
      <input
        ref={onInputRef}
        type={isCodeVisible ? "text" : "password"}
        autoFocus
        placeholder="Codigo de usuario"
        className="h-10 w-full rounded-lg border border-slate-300 px-3 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter?.();
        }}
      />
      <button
        type="button"
        onClick={() => setIsCodeVisible((prev) => !prev)}
        className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label={isCodeVisible ? "Ocultar codigo" : "Mostrar codigo"}
        title={isCodeVisible ? "Ocultar codigo" : "Mostrar codigo"}
      >
        {isCodeVisible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
};

const columnHelper = createColumnHelper<PosCatalogProduct>();
const CATALOG_PAGE_SIZE = 50;
const TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100];
const PROFORMA_DEFAULT_CONTACT_ID = 47;

const roundPrice = (value: number) =>
  Math.ceil((value - Number.EPSILON) * 100) / 100;
const formatPrice = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0.00";
  return roundPrice(numeric).toFixed(2);
};
const priceLabel = (product: Product) =>
  formatPrice(product.preVenta ?? product.preVentaB ?? 0);
const composeProductDisplayName = (name: unknown, brand?: unknown): string =>
  [name, brand]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
const buildVariationDetailId = (baseId: number, index: number) =>
  -1 * (baseId * 1000 + (index + 1));
const getCartItemKey = (item: Pick<PosCartItem, "productId" | "detalleId">) =>
  Number(item.detalleId ?? 0) || Number(item.productId ?? 0);
const getMinAllowedPrice = (item: PosCartItem) => {
  const itemWithPriceCost = item as PosCartItem & Record<string, unknown>;
  return Math.max(
    0,
    Number(
      itemWithPriceCost.precioCosto ?? item.costo ?? item.precioMinimo ?? 0,
    ) || 0,
  );
};
const hasInvalidQuantityForPayment = (item: PosCartItem) => {
  const quantity = Number(item.cantidad ?? 0);
  return !Number.isFinite(quantity) || quantity <= 0;
};
const normalizeUnitLabel = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
const canonicalUnit = (value: unknown) => {
  const unit = normalizeUnitLabel(value);
  if (["L", "LT", "LTS", "LITRO", "LITROS"].includes(unit)) return "LITRO";
  if (["ML", "MILILITRO", "MILILITROS"].includes(unit)) return "ML";
  if (["KG", "KGS", "KILO", "KILOS", "KILOGRAMO", "KILOGRAMOS"].includes(unit))
    return "KG";
  if (["G", "GR", "GRAMO", "GRAMOS"].includes(unit)) return "G";
  return unit;
};
const getKnownUnitRatio = (fromUnit: unknown, toUnit: unknown): number => {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (!from || !to || from === to) return 1;
  const key = `${from}>${to}`;
  const ratioMap: Record<string, number> = {
    "LITRO>ML": 1000,
    "ML>LITRO": 0.001,
    "KG>G": 1000,
    "G>KG": 0.001,
  };
  return ratioMap[key] ?? 0;
};
const deriveVariationReductionValue = (
  baseUnit: unknown,
  variation: ProductUnitOption,
) => {
  const rawFactor = Number(variation.valorUM ?? variation.factor ?? 0);
  if (Number.isFinite(rawFactor) && rawFactor > 0) {
    return Number(rawFactor.toFixed(6));
  }

  // Fallback por unidades conocidas: convertir de unidad alterna a unidad principal.
  const knownRatio = getKnownUnitRatio(variation.unidadMedida, baseUnit);
  if (knownRatio > 0) {
    return Number(knownRatio.toFixed(6));
  }

  return 1;
};
const deriveVariationStock = (
  baseStockRaw: unknown,
  baseUnit: unknown,
  variation: ProductUnitOption,
) => {
  const baseStock = Number(baseStockRaw);
  const safeBaseStock =
    Number.isFinite(baseStock) && baseStock >= 0 ? baseStock : 0;
  const reportedVariationStock = Number(variation.cantidad ?? 0);
  const safeReportedStock =
    Number.isFinite(reportedVariationStock) && reportedVariationStock >= 0
      ? reportedVariationStock
      : 0;
  const variationUnit = normalizeUnitLabel(variation.unidadMedida);
  const principalUnit = normalizeUnitLabel(baseUnit);
  const hasDifferentUnit =
    variationUnit !== "" &&
    principalUnit !== "" &&
    variationUnit !== principalUnit;
  const stockLooksUnconverted =
    hasDifferentUnit &&
    Math.abs(safeReportedStock - safeBaseStock) < 0.000001 &&
    safeBaseStock > 0;
  const reductionValue = deriveVariationReductionValue(baseUnit, variation);

  if (!stockLooksUnconverted && safeReportedStock > 0) {
    return safeReportedStock;
  }

  if (Number.isFinite(reductionValue) && reductionValue > 0) {
    const converted = safeBaseStock / reductionValue;
    if (Number.isFinite(converted) && converted >= 0) {
      return Number(converted.toFixed(6));
    }
  }

  return safeReportedStock;
};

const POSPage = () => {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(CATALOG_PAGE_SIZE);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    products,
    fetchCatalogProducts,
    resetCatalogProducts,
    loading,
    catalogPagination,
  } = useProductsStore();
  const items = usePosStore((state) => state.items);
  const totals = usePosStore(selectTotals);
  const addProduct = usePosStore((state) => state.addProduct);
  const updateQuantity = usePosStore((state) => state.updateQuantity);
  const updatePrice = usePosStore((state) => state.updatePrice);
  const removeItem = usePosStore((state) => state.removeItem);
  const clearCart = usePosStore((state) => state.clearCart);
  const clearEditingNota = usePosStore((state) => state.clearEditingNota);
  const editingNotaId = usePosStore((state) => state.editingNotaId);
  const isEditingMode = usePosStore((state) => state.isEditingMode);
  const openDialog = useDialogStore((state) => state.openDialog);
  const closeDialog = useDialogStore((state) => state.closeDialog);
  const setDialogLoading = useDialogStore((state) => state.setLoading);
  const { resetDraftForNewSale } = usePosCartDraftPersistence({
    enabled: true,
    autosave: true,
    hydrateFromStorage: true,
  });
  const isCardsView = viewMode === "cards";
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const catalogScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreArmedRef = useRef(true);
  const appendScrollTopRef = useRef<number | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>(
    {},
  );
  const [isSubmittingQuickSale, setIsSubmittingQuickSale] = useState(false);

  const safeTrim = (value: unknown) => String(value ?? "").trim();
  const parseRecordLikeValue = (
    value: unknown,
  ): Record<string, unknown> | null => {
    if (!value) return null;
    if (typeof value === "object") return value as Record<string, unknown>;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const resolveHttpStatus = (payload: unknown) => {
    const payloadRecord = parseRecordLikeValue(payload);
    const status = Number(
      payloadRecord?.response &&
        typeof payloadRecord.response === "object" &&
        payloadRecord.response !== null
        ? ((payloadRecord.response as Record<string, unknown>).status ??
            payloadRecord.status)
        : payloadRecord?.status,
    );
    return Number.isFinite(status) && status > 0 ? Math.floor(status) : 0;
  };
  const resolveApiMessage = (payload: unknown) => {
    const payloadRecord = parseRecordLikeValue(payload);
    const responseRecord = parseRecordLikeValue(payloadRecord?.response);
    const responseDataRecord = parseRecordLikeValue(responseRecord?.data);
    return safeTrim(
      payloadRecord?.mensaje ??
        payloadRecord?.message ??
        payloadRecord?.Message ??
        responseDataRecord?.mensaje ??
        responseDataRecord?.message ??
        responseDataRecord?.Message ??
        "",
    );
  };
  const parseNotaId = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    }
    if (typeof value === "string") {
      const match = value.match(/\d+/);
      if (match?.[0]) {
        const numeric = Number(match[0]);
        return Number.isFinite(numeric) && numeric > 0
          ? Math.floor(numeric)
          : null;
      }
      return null;
    }

    const record = parseRecordLikeValue(value);
    if (!record) return null;
    const nested =
      record.notaId ??
      record.NotaId ??
      parseRecordLikeValue(record.nota)?.notaId ??
      parseRecordLikeValue(record.nota)?.NotaId ??
      record.idNota ??
      record.IdNota ??
      record.id ??
      record.ID ??
      record.resultado ??
      record.Resultado ??
      record.result ??
      record.Result ??
      parseRecordLikeValue(record.data)?.notaId ??
      parseRecordLikeValue(record.data)?.NotaId ??
      parseRecordLikeValue(record.data)?.idNota ??
      parseRecordLikeValue(record.data)?.IdNota ??
      parseRecordLikeValue(record.data)?.id ??
      parseRecordLikeValue(record.data)?.ID ??
      parseRecordLikeValue(record.data)?.resultado ??
      parseRecordLikeValue(record.data)?.Resultado ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.notaId ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.NotaId ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.idNota ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.IdNota ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)?.id ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)?.ID ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.resultado ??
      parseRecordLikeValue(parseRecordLikeValue(record.response)?.data)
        ?.Resultado ??
      record.data;

    return parseNotaId(nested);
  };
  const toFirstName = (value: unknown) => {
    const normalized = safeTrim(value).replace(/\s+/g, " ");
    if (!normalized) return "";
    return normalized.split(" ")[0] ?? "";
  };
  const { companyId, usernameFromSession } = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        companyId: 1,
        usernameFromSession: "USUARIO",
      };
    }

    let parsedSession: AuthSessionPayload | null = null;
    const sessionRaw = localStorage.getItem("sgo.auth.session");
    if (sessionRaw) {
      try {
        parsedSession = JSON.parse(sessionRaw) as AuthSessionPayload;
      } catch {
        parsedSession = null;
      }
    }

    const companyIdRaw =
      parsedSession?.user?.companyId ?? localStorage.getItem("companiaId");
    const companyIdNum = Number(companyIdRaw);
    const safeCompanyId =
      Number.isFinite(companyIdNum) && companyIdNum > 0 ? companyIdNum : 1;
    const username =
      safeTrim(parsedSession?.user?.displayName) ||
      safeTrim(parsedSession?.user?.username) ||
      "USUARIO";

    return {
      companyId: safeCompanyId,
      usernameFromSession: username,
    };
  }, []);

  const focusSearchInput = () => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    });
  };

  const handleSearchTermInput = (event: FormEvent<HTMLInputElement>) => {
    setSearchTerm(event.currentTarget.value);
  };

  const switchToCardsView = () => {
    if (viewMode === "cards") return;
    setViewMode("cards");
    setCatalogPage(1);
    loadMoreArmedRef.current = true;
    appendScrollTopRef.current = null;
  };

  const switchToTableView = () => {
    if (viewMode === "table") return;
    setViewMode("table");
    setTablePage(1);
  };

  const handleTablePageChange = (nextPage: number) => {
    setTablePage(Math.max(1, Math.trunc(nextPage)));
  };

  const handleTablePageSizeChange = (nextPageSize: number) => {
    const normalized = Math.max(1, Math.trunc(nextPageSize));
    setTablePageSize(normalized);
    setTablePage(1);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
      setCatalogPage(1);
      setTablePage(1);
      loadMoreArmedRef.current = true;
      appendScrollTopRef.current = null;

      const root = catalogScrollRef.current;
      if (root) {
        root.scrollTop = 0;
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (debouncedSearchTerm) return;
    resetCatalogProducts();
  }, [debouncedSearchTerm, resetCatalogProducts]);

  useEffect(() => {
    if (!isCardsView || !debouncedSearchTerm) return;

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
    });
  }, [debouncedSearchTerm, fetchCatalogProducts, isCardsView]);

  useEffect(() => {
    if (!isCardsView || !debouncedSearchTerm || catalogPage <= 1) return;
    const root = catalogScrollRef.current;
    if (root) {
      appendScrollTopRef.current = root.scrollTop;
    }

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
    });
  }, [catalogPage, debouncedSearchTerm, fetchCatalogProducts, isCardsView]);

  useEffect(() => {
    if (isCardsView || !debouncedSearchTerm) return;

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
    });
  }, [
    debouncedSearchTerm,
    fetchCatalogProducts,
    isCardsView,
    tablePage,
    tablePageSize,
  ]);

  useEffect(() => {
    if (loading) return;
    const root = catalogScrollRef.current;
    const previousScrollTop = appendScrollTopRef.current;
    if (!root || previousScrollTop === null) return;

    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTop = Math.min(previousScrollTop, maxTop);
    appendScrollTopRef.current = null;
  }, [loading, products.length]);

  useEffect(() => {
    const routeState =
      (location.state as {
        preserveCart?: boolean;
        resetCart?: boolean;
      } | null) ?? null;
    const preserveCart = routeState?.preserveCart === true;
    const resetCart = routeState?.resetCart === true;
    if (resetCart) {
      clearCart();
      clearEditingNota();
      void resetDraftForNewSale();
      return;
    }
    if (preserveCart) return;

    clearEditingNota();
  }, [clearCart, clearEditingNota, location.state, resetDraftForNewSale]);

  const hasInvalidPriceForPayment = (item: PosCartItem) => {
    const minPrice = getMinAllowedPrice(item);
    const draftValue = priceDrafts[getCartItemKey(item)];
    if (draftValue === undefined) {
      const storedPrice = Number(item.precio ?? 0);
      return !Number.isFinite(storedPrice) || storedPrice < minPrice;
    }

    const normalizedDraft = draftValue.trim();
    if (!normalizedDraft) return true;
    const draftPrice = Number(normalizedDraft);
    return !Number.isFinite(draftPrice) || draftPrice < minPrice;
  };

  const requestPersonalAuthorizationForPayment = () =>
    new Promise<string | null>((resolve) => {
      let codeInputRef: HTMLInputElement | null = null;
      const validatePersonalCode = async (): Promise<boolean> => {
        const codigoUsuario = safeTrim(codeInputRef?.value ?? "");
        if (!codigoUsuario) {
          toast.error("Ingrese su codigo de usuario.");
          return false;
        }

        const response = await apiRequest<PersonalByCodeResponse | null>({
          url: buildApiUrl(
            `/Personal/by-code/${encodeURIComponent(codigoUsuario)}`,
          ),
          method: "GET",
          fallback: null,
        });
        const responseRecord = parseRecordLikeValue(response);
        const nestedDataRecord = parseRecordLikeValue(responseRecord?.data);
        const personalRecord = nestedDataRecord ?? responseRecord;
        const httpStatus = resolveHttpStatus(response);
        const hasHttpError =
          typeof httpStatus === "number" && httpStatus >= 400;
        const nombreApellido = safeTrim(
          personalRecord?.nombreApellido ??
            personalRecord?.NombreApellido ??
            personalRecord?.nombreCompleto ??
            personalRecord?.NombreCompleto,
        );
        const personalEstado = safeTrim(
          personalRecord?.personalEstado ??
            personalRecord?.PersonalEstado ??
            personalRecord?.estado ??
            personalRecord?.Estado,
        ).toUpperCase();

        if (httpStatus === 404) {
          toast.error("CODIGO INCORRECTO");
          return false;
        }

        if (hasHttpError || !nombreApellido) {
          toast.error(
            resolveApiMessage(response) ||
              "Codigo de usuario no encontrado. Verifique y reintente.",
          );
          return false;
        }

        if (personalEstado && personalEstado !== "ACTIVO") {
          toast.error(
            "El usuario consultado no esta activo. Verifique y reintente.",
          );
          return false;
        }

        resolve(nombreApellido);
        return true;
      };

      openDialog({
        title: "Validar usuario",
        confirmText: "Validar",
        cancelText: "Cancelar",
        disableBackdropClose: true,
        content: (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Ingrese su codigo de usuario para confirmar el pago.
            </p>
            <PersonalCodeField
              onInputRef={(node) => {
                codeInputRef = node;
              }}
              onEnter={() => {
                void (async () => {
                  setDialogLoading(true);
                  try {
                    const isValid = await validatePersonalCode();
                    if (isValid) {
                      closeDialog();
                    }
                  } finally {
                    setDialogLoading(false);
                  }
                })();
              }}
            />
            <p className="text-xs text-slate-500">
              Si el codigo no existe o esta inactivo, no se permitira confirmar.
            </p>
          </div>
        ),
        onConfirm: validatePersonalCode,
        onCancel: () => {
          resolve(null);
        },
      });
    });

  const confirmFromPos = async () => {
    if (isSubmittingQuickSale) return;
    if (!items.length) {
      toast.error("Agrega productos antes de procesar");
      return;
    }

    const normalizedPath = location.pathname.toLowerCase();
    const paymentBasePath = normalizedPath.includes("/sales/pos")
      ? "/sales/pos/payment"
      : "/pos/payment";
    const hasEditingNota =
      isEditingMode &&
      Number.isFinite(Number(editingNotaId)) &&
      Number(editingNotaId) > 0;
    if (hasEditingNota) {
      const paymentTarget = `${paymentBasePath}/${Number(editingNotaId)}?mode=edit`;
      navigate(paymentTarget);
      return;
    }

    if (items.some(hasInvalidQuantityForPayment)) {
      toast.error("La cantidad debe ser mayor a 0.");
      return;
    }

    if (items.some(hasInvalidPriceForPayment)) {
      toast.error("El precio no debe ser menor al precio costo.");
      return;
    }

    const authorizedPersonalName =
      await requestPersonalAuthorizationForPayment();
    if (!authorizedPersonalName) return;
    const resolvedPaymentUsername =
      toFirstName(authorizedPersonalName) ||
      toFirstName(usernameFromSession) ||
      "USUARIO";
    const safeSubtotal = roundPrice(Math.max(0, Number(totals.subTotal ?? 0)));
    const safeTotal = roundPrice(Math.max(0, Number(totals.total ?? 0)));
    const safeItems = items.map((item) => ({
      ...item,
      cantidad: Math.max(0, Number(item.cantidad ?? 0)),
      precio: Math.max(0, Number(item.precio ?? 0)),
    }));
    const notaGanancia = roundPrice(
      safeItems.reduce((acc, item) => {
        const costo = Math.max(0, Number(item.costo ?? 0));
        return acc + (item.precio - costo) * item.cantidad;
      }, 0),
    );

    const payload = {
      nota: {
        notaDocu: "PROFORMA V",
        clienteId: PROFORMA_DEFAULT_CONTACT_ID,
        notaUsuario: resolvedPaymentUsername,
        notaFormaPago: "EFECTIVO",
        notaCondicion: "ALCONTADO",
        notaDireccion: "",
        notaTelefono: "",
        notaSubtotal: safeSubtotal,
        notaMovilidad: 0,
        notaDescuento: 0,
        notaTotal: safeTotal,
        notaAcuenta: 0,
        notaSaldo: safeTotal,
        notaAdicional: 0,
        notaTarjeta: 0,
        notaPagar: safeTotal,
        notaEstado: "PENDIENTE",
        companiaId: companyId,
        notaEntrega: "INMEDIATA",
        notaConcepto: "MERCADERIA",
        notaSerie: "0001",
        notaNumero: "",
        notaGanancia,
        icbper: 0,
        entidadBancaria: "",
        nroOperacion: "",
        efectivo: safeTotal,
        deposito: 0,
      },
      detalles: safeItems.map((item) => ({
        idProducto: Number(item.productId ?? 0),
        detalleCantidad: Number(item.cantidad ?? 0),
        detalleUm: safeTrim(item.unidadMedida || "UND") || "UND",
        detalleDescripcion: composeProductDisplayName(
          item.nombre,
          item.productoMarca,
        ),
        detalleCosto: Math.max(0, Number(item.costo ?? item.precio ?? 0)),
        detallePrecio: Math.max(0, Number(item.precio ?? 0)),
        detalleImporte: roundPrice(
          Math.max(0, Number(item.precio ?? 0)) *
            Math.max(0, Number(item.cantidad ?? 0)),
        ),
        detalleEstado: "PENDIENTE",
        valorUM:
          Number.isFinite(Number(item.valorUM ?? 1)) &&
          Number(item.valorUM ?? 1) > 0
            ? Number(item.valorUM ?? 1)
            : 1,
      })),
    };

    setIsSubmittingQuickSale(true);
    try {
      const result = await apiRequest({
        url: buildApiUrl("/Nota/register-with-detail"),
        method: "POST",
        data: payload,
        config: {
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json",
          },
        },
        fallback: null,
      });
      const httpStatus = resolveHttpStatus(result);
      const hasHttpError = typeof httpStatus === "number" && httpStatus >= 400;
      if (
        !result ||
        result === false ||
        hasHttpError ||
        Boolean((result as Record<string, unknown>)?.isAxiosError)
      ) {
        toast.error(resolveApiMessage(result) || "Fallo la creacion de pedido");
        return;
      }

      const createdNotaId = parseNotaId(result);
      toast.success("Pedido registrado");
      clearCart();
      clearEditingNota();
      setPriceDrafts({});
      setQuantityDrafts({});
      setMobileCartOpen(false);
      await resetDraftForNewSale();
      if (createdNotaId) {
        navigate(`${paymentBasePath}/${createdNotaId}?mode=view&autoprint=1`);
        return;
      }
      console.error("No se pudo resolver notaId desde response", result);
      toast.error(
        "Se registró, pero no se pudo abrir la nota automáticamente (sin notaId en respuesta).",
      );
      focusSearchInput();
    } catch (error) {
      console.error("Error al confirmar desde POS", error);
      toast.error("No se pudo confirmar el pedido.");
    } finally {
      setIsSubmittingQuickSale(false);
    }
  };

  const goToPayment = () => {
    void confirmFromPos();
  };

  const handleCartShortcut = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      goToPayment();
      return;
    }

    setMobileCartOpen(true);
  };

  const handleAddProduct = (product: PosCatalogProduct) => {
    const productDisplayName = composeProductDisplayName(
      product.nombre,
      product.productoMarca,
    );
    const available = Number(product.cantidad ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      openDialog({
        title: "Sin stock",
        content: (
          <p className="text-sm text-slate-700">
            {productDisplayName} no tiene stock disponible. ¿Deseas agregarlo de
            todos modos?
          </p>
        ),
        confirmText: "Agregar",
        cancelText: "Cancelar",
        onConfirm: () => {
          addProduct(product, 1);

          focusSearchInput();
        },
      });
      return;
    }

    addProduct(product, 1);

    focusSearchInput();
  };

  const catalogProducts = useMemo<PosCatalogProduct[]>(() => {
    const expanded: PosCatalogProduct[] = [];
    products.forEach((product) => {
      expanded.push({
        ...product,
        valorUM: 1,
        catalogKey: `base-${product.id}`,
      });

      const variations = Array.isArray(product.unidadesAlternas)
        ? product.unidadesAlternas
        : [];
      variations.forEach((variation, index) => {
        const variationReductionValue = deriveVariationReductionValue(
          product.unidadMedida,
          variation,
        );
        const variationImage = String(variation.unidadImagen ?? "").trim();
        const variationStock = deriveVariationStock(
          product.cantidad,
          product.unidadMedida,
          variation,
        );
        expanded.push({
          ...product,
          detalleId: buildVariationDetailId(product.id, index),
          isVariation: true,
          baseProductId: product.id,
          unidadMedida: variation.unidadMedida || product.unidadMedida,
          valorUM: variationReductionValue,
          cantidad: variationStock,
          preCosto: Number(variation.preCosto ?? product.preCosto ?? 0),
          preVenta: Number(variation.preVenta ?? product.preVenta ?? 0),
          preVentaB: Number(variation.preVentaB ?? product.preVentaB ?? 0),
          images: variationImage ? [variationImage] : (product.images ?? []),
          catalogKey: `var-${product.id}-${index}`,
        });
      });
    });

    return expanded;
  }, [products]);

  const filteredProducts = useMemo(() => catalogProducts, [catalogProducts]);

  const visibleProducts = useMemo(() => {
    if (viewMode !== "cards") return filteredProducts;
    return filteredProducts;
  }, [filteredProducts, viewMode]);

  const hasMoreProducts = viewMode === "cards" && catalogPagination.hasMore;
  const showInitialLoading = loading && products.length === 0;
  const showLoadingMore = loading && products.length > 0;
  const totalResults =
    catalogPagination.totalRegistros > 0
      ? catalogPagination.totalRegistros
      : filteredProducts.length;

  useEffect(() => {
    if (!isCardsView || !hasMoreProducts || loading) return;
    const node = loadMoreRef.current;
    const root = catalogScrollRef.current;
    if (!node || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (!entry.isIntersecting) {
          loadMoreArmedRef.current = true;
          return;
        }

        if (loadMoreArmedRef.current) {
          loadMoreArmedRef.current = false;
          appendScrollTopRef.current = root.scrollTop;
          setCatalogPage((prev) => prev + 1);
        }
      },
      {
        root,
        rootMargin: "0px 0px 220px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreProducts, isCardsView, loading]);

  useEffect(() => {
    if (!isCardsView) return;
    loadMoreArmedRef.current = true;
  }, [isCardsView]);

  useEffect(() => {
    if (!isCardsView) return;

    const input = searchInputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }, [isCardsView]);

  const handleQuantityChange = (item: PosCartItem, delta: number) => {
    const itemKey = getCartItemKey(item);
    const desired = Math.max(0, (item.cantidad ?? 0) + delta);
    setQuantityDrafts((prev) => {
      if (!(itemKey in prev)) return prev;
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
    updateQuantity(itemKey, desired);
  };

  const handleManualQuantity = (item: PosCartItem, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;

    const itemKey = getCartItemKey(item);
    setQuantityDrafts((prev) => ({ ...prev, [itemKey]: value }));

    if (value === "") {
      updateQuantity(itemKey, 0);
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    const next = Math.max(0, parsed);
    updateQuantity(itemKey, next);
  };

  const handleQuantityBlur = (item: PosCartItem, value: string) => {
    const itemKey = getCartItemKey(item);
    const normalized = value.trim();
    const parsed = Number(normalized);

    if (normalized === "" || Number.isNaN(parsed)) {
      updateQuantity(itemKey, 0);
    } else {
      updateQuantity(itemKey, Math.max(0, parsed));
    }

    setQuantityDrafts((prev) => {
      if (!(itemKey in prev)) return prev;
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
  };

  const handlePriceChange = (item: PosCartItem, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;

    const itemKey = getCartItemKey(item);
    setPriceDrafts((prev) => ({ ...prev, [itemKey]: value }));

    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      const minPrice = getMinAllowedPrice(item);
      const safePrice = roundPrice(Math.max(parsed, minPrice));
      updatePrice(itemKey, safePrice);
    }
  };

  const handlePriceBlur = (item: PosCartItem, value: string) => {
    const itemKey = getCartItemKey(item);
    if (value.trim() === "") {
      setPriceDrafts((prev) => ({
        ...prev,
        [itemKey]: formatPrice(item.precio),
      }));
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      setPriceDrafts((prev) => ({
        ...prev,
        [itemKey]: formatPrice(item.precio),
      }));
      return;
    }
    const minPrice = getMinAllowedPrice(item);
    const safePrice = roundPrice(Math.max(parsed, minPrice));

    setPriceDrafts((prev) => ({
      ...prev,
      [itemKey]: safePrice.toFixed(2),
    }));
    updatePrice(itemKey, safePrice);
  };

  useEffect(() => {
    setPriceDrafts((prev) => {
      const next: Record<number, string> = {};
      items.forEach((item) => {
        const itemKey = getCartItemKey(item);
        next[itemKey] = prev[itemKey] ?? formatPrice(item.precio);
      });
      return next;
    });
  }, [items]);

  const confirmClear = () =>
    openDialog({
      title: "Vaciar carrito",
      content: <p>¿Seguro que deseas eliminar todos los ítems del carrito?</p>,
      onConfirm: () => {
        clearCart();
        toast.success("Carrito limpiado");
      },
      confirmText: "Vaciar",
      cancelText: "Cancelar",
    });

  const productColumns = [
    columnHelper.accessor("nombre", {
      header: () => <span className="block text-left">Nombre</span>,

      cell: ({ row }) => (
        <span className="font-semibold text-left block ">
          {composeProductDisplayName(
            row.original.nombre,
            row.original.productoMarca,
          )}
        </span>
      ),
    }),
    columnHelper.display({
      id: "unidad",
      header: "U.M.",
      cell: ({ row }) => {
        const unit = row.original.unidadMedida ?? "UND";
        return row.original.isVariation ? `${unit}` : unit;
      },
    }),
    columnHelper.display({
      id: "precio",
      header: () => <span className="whitespace-nowrap">P. Venta S/</span>,
      cell: ({ row }) => (
        <span className="font-semibold text-right block">
          {priceLabel(row.original)}
        </span>
      ),
      meta: {
        align: "right",
        thClassName: "whitespace-nowrap min-w-[110px]",
        tdClassName: "text-right",
      },
    }),
    columnHelper.display({
      id: "stock",
      header: "Stock",
      cell: ({ row }) => {
        const stockValue = Number(row.original.cantidad ?? 0);
        const isNegative = stockValue < 0;
        return (
          <span
            className={`text-right block ${
              isNegative ? "text-red-600 font-semibold" : ""
            }`}
          >
            {stockValue}
          </span>
        );
      },
      meta: { tdClassName: "text-right" },
    }),
    columnHelper.display({
      id: "action",
      header: "",
      cell: ({ row }) => (
        <button
          className="ml-auto flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-700 text-white hover:bg-slate-800 transition-colors text-sm"
          onClick={(e) => {
            e.stopPropagation();
            handleAddProduct(row.original);
          }}
        >
          <Plus className="w-4 h-4" />
          Añadir
        </button>
      ),
      meta: { tdClassName: "text-right" },
    }),
  ];

  const renderCartPanel = ({ mobile = false }: { mobile?: boolean } = {}) => (
    <div
      className={`bg-white rounded-xl shadow p-4 ${mobile ? "h-full flex flex-col" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Carrito</h3>
          <p className="text-xs text-gray-500">Actualización en tiempo real</p>
        </div>
        <button
          className="flex items-center gap-2 text-sm text-slate-700 hover:text-slate-900"
          onClick={confirmClear}
          disabled={!items.length}
        >
          <RotateCcw className="w-4 h-4" />
          Vaciar
        </button>
      </div>

      <div
        className={`space-y-3 overflow-y-auto pr-1 ${
          mobile
            ? "flex-1 min-h-0 max-h-none"
            : "max-h-[min(56vh,520px)] md:max-h-[58vh]"
        }`}
      >
        {items.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-6">
            No hay productos en el carrito.
          </div>
        )}

        {items.map((item) => {
          const isZeroOrNegative = (item.cantidad ?? 0) <= 0;
          const isStockNegative = Number(item.stock ?? 0) < 0;
          const minPrice = getMinAllowedPrice(item);
          const highlightClass =
            isZeroOrNegative || isStockNegative
              ? "border-red-200 bg-red-50"
              : "border-slate-200 bg-gray-50";

          return (
            <article
              key={getCartItemKey(item)}
              className={`border rounded-lg p-3 hover:border-slate-300 transition-colors ${highlightClass}`}
            >
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {composeProductDisplayName(item.nombre, item.productoMarca)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.unidadMedida ?? "UND"}
                  </p>
                  {item.stock !== undefined && (
                    <p className="text-xs text-gray-500">
                      Stock:{" "}
                      <span
                        className={
                          isStockNegative ? "text-red-600 font-semibold" : ""
                        }
                      >
                        {item.stock}
                      </span>
                    </p>
                  )}
                </div>

                <div className="text-right w-32">
                  <label className="text-xs text-gray-500 block text-left">
                    P. Unitario
                  </label>

                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-sm text-gray-500">S/</span>
                    <NavigableNumberInput
                      min={minPrice}
                      step="0.01"
                      value={
                        priceDrafts[getCartItemKey(item)] ??
                        formatPrice(item.precio)
                      }
                      onChange={(value) => handlePriceChange(item, value)}
                      onBlur={(event) =>
                        handlePriceBlur(item, event.currentTarget.value)
                      }
                      navGroup="pos-price-input"
                      className="w-full text-right border rounded-md px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    className="p-1 rounded bg-white border hover:bg-slate-50"
                    onClick={() => handleQuantityChange(item, -1)}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <NavigableNumberInput
                    min="0"
                    step="any"
                    value={
                      quantityDrafts[getCartItemKey(item)] ??
                      (item.cantidad === 0 ? "" : item.cantidad)
                    }
                    onChange={(value) => handleManualQuantity(item, value)}
                    onBlur={(event) =>
                      handleQuantityBlur(item, event.currentTarget.value)
                    }
                    navGroup="pos-quantity-input"
                    className="w-16 text-center border rounded-md py-1"
                  />
                  <button
                    className="p-1 rounded bg-white border hover:bg-slate-50"
                    onClick={() => handleQuantityChange(item, 1)}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Subtotal</p>
                    <p
                      className={`text-base font-semibold ${
                        isZeroOrNegative ? "text-red-600" : "text-slate-800"
                      }`}
                    >
                      S/ {(item.precio * item.cantidad).toFixed(2)}
                    </p>
                  </div>
                  <button
                    className="p-2 rounded bg-red-50 text-red-600 hover:bg-red-100"
                    onClick={() => removeItem(getCartItemKey(item))}
                    title="Quitar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 border-t pt-3 space-y-2">
        <div className="flex justify-between text-sm text-gray-700">
          <span>Importe</span>
          <span className="font-semibold">S/ {totals.subTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-base text-slate-800 font-bold">
          <span>Total</span>
          <span>S/ {totals.total.toFixed(2)}</span>
        </div>
        <button
          className="w-full mt-3 inline-flex justify-center items-center gap-2 py-2.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
          disabled={!items.length || isSubmittingQuickSale}
          onClick={goToPayment}
        >
          {isSubmittingQuickSale ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
          {isSubmittingQuickSale ? "Confirmando..." : "Confirmar"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {isSubmittingQuickSale && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl border border-slate-200">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
            <div className="text-sm font-medium text-slate-800">
              Registrando pedido, por favor espera...
            </div>
          </div>
        </div>
      )}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div></div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border bg-gray-50 overflow-hidden">
                <button
                  className={`flex items-center gap-1 px-3 py-1 text-sm ${
                    viewMode === "cards"
                      ? "bg-slate-700 text-white"
                      : "text-slate-700"
                  }`}
                  onClick={switchToCardsView}
                  title="Ver como cards"
                >
                  <LayoutGrid className="w-4 h-4" />
                  Cards
                </button>
                <button
                  className={`flex items-center gap-1 px-3 py-1 text-sm ${
                    viewMode === "table"
                      ? "bg-slate-700 text-white"
                      : "text-slate-700"
                  }`}
                  onClick={switchToTableView}
                  title="Ver como tabla"
                >
                  <TableProperties className="w-4 h-4" />
                  Tabla
                </button>
              </div>
            </div>
            <button
              type="button"
              className="fixed right-3 top-[calc(var(--app-shell-header-h)+0.75rem)] z-30 flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white shadow-lg xl:static xl:z-auto xl:shadow-sm"
              onClick={handleCartShortcut}
              aria-label="Abrir carrito"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>{items.length} ítems</span>
              <span className="text-gray-300">|</span>
            </button>
          </div>

          <div
            className={`bg-white rounded-xl shadow p-3 space-y-3 flex flex-col ${
              isCardsView ? "md:h-[min(74vh,720px)] md:min-h-[420px]" : ""
            }`}
          >
            {isCardsView && (
              <div className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
                <input
                  ref={searchInputRef}
                  autoFocus
                  data-no-uppercase="true"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onInput={handleSearchTermInput}
                  placeholder="Buscar por código o nombre"
                  className="w-full border px-3 py-2 rounded-lg focus:ring focus:ring-slate-200 text-sm"
                />
                <span className="text-xs text-gray-500 sm:whitespace-nowrap">
                  {filteredProducts.length} / {totalResults} resultados
                </span>
              </div>
            )}

            {showInitialLoading && isCardsView ? (
              <div className="flex items-center justify-center py-12 gap-3 text-slate-600">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Cargando productos...</span>
              </div>
            ) : (
              <div
                ref={catalogScrollRef}
                className={`flex-1 min-h-0 pr-1 ${
                  isCardsView ? "overflow-y-auto" : "overflow-visible"
                }`}
              >
                {isCardsView ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {visibleProducts.map((product) => {
                      const image = product.images?.[0];
                      const stockValue = Number(product.cantidad ?? 0);
                      const isOutOfStock =
                        !Number.isFinite(stockValue) || stockValue <= 0;
                      const cardHighlight = isOutOfStock
                        ? "border-red-200 bg-red-50"
                        : "border-slate-200 bg-gray-50";

                      return (
                        <article
                          key={product.catalogKey}
                          className={`border rounded-xl p-3 hover:border-slate-300 transition-colors flex flex-col ${cardHighlight}`}
                        >
                          <div className="aspect-video rounded-lg overflow-hidden bg-white border flex items-center justify-center">
                            {image ? (
                              <img
                                src={image}
                                alt={composeProductDisplayName(
                                  product.nombre,
                                  product.productoMarca,
                                )}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="text-sm text-gray-500">
                                Sin imagen
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex-1 flex flex-col gap-1">
                            <p className="text-xs text-gray-500">
                              {product.codigo}
                            </p>
                            <h3 className="text-sm font-semibold text-slate-800 line-clamp-2">
                              {composeProductDisplayName(
                                product.nombre,
                                product.productoMarca,
                              )}
                            </h3>
                            {product.isVariation ? (
                              <p className="text-xs font-medium text-blue-700">
                                Variacion: {product.unidadMedida}
                              </p>
                            ) : null}
                            <div className="flex items-center justify-between text-sm text-gray-600">
                              <span
                                className={
                                  isOutOfStock
                                    ? "text-red-600 font-semibold"
                                    : ""
                                }
                              >
                                Stock: {stockValue} {product.unidadMedida}
                              </span>
                              <span className="font-semibold text-slate-800">
                                S/ {priceLabel(product)}
                              </span>
                            </div>
                          </div>

                          <button
                            className="mt-3 inline-flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-800 transition-colors text-sm"
                            onClick={() => handleAddProduct(product)}
                          >
                            <Plus className="w-4 h-4" />
                            Añadir
                          </button>
                        </article>
                      );
                    })}
                    {!visibleProducts.length && (
                      <div className="col-span-full py-10 text-center text-sm text-gray-500">
                        No se encontraron productos.
                      </div>
                    )}
                  </div>
                ) : (
                  <DataTable
                    data={filteredProducts}
                    columns={productColumns}
                    filterKeys={[
                      "codigo",
                      "nombre",
                      "productoMarca",
                      "descripcion",
                      "unidadMedida",
                    ]}
                    onRowClick={handleAddProduct}
                    searchPlaceholder="Buscar por código o nombre"
                    globalFilterValue={searchTerm}
                    onGlobalFilterValueChange={setSearchTerm}
                    toolbarAction={
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {filteredProducts.length} / {totalResults} resultados
                      </span>
                    }
                    toolbarActionAlign="right"
                    isLoading={loading}
                    manualPagination
                    disableLocalFiltering
                    page={tablePage}
                    pageSize={tablePageSize}
                    pageSizeOptions={TABLE_PAGE_SIZE_OPTIONS}
                    totalRows={catalogPagination.totalRegistros}
                    onPageChange={handleTablePageChange}
                    onPageSizeChange={handleTablePageSizeChange}
                  />
                )}
                {isCardsView && (hasMoreProducts || showLoadingMore) && (
                  <div
                    ref={loadMoreRef}
                    className="mt-3 h-10 flex items-center justify-center text-xs text-gray-500"
                  >
                    {showLoadingMore
                      ? "Cargando productos..."
                      : "Cargando más productos..."}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="hidden xl:block space-y-3 xl:sticky xl:top-0 xl:self-start">
          {renderCartPanel()}
        </section>
      </div>

      {mobileCartOpen && (
        <div className="xl:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45"
            aria-label="Cerrar carrito"
            onClick={() => setMobileCartOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 h-[min(84vh,720px)] rounded-t-2xl bg-slate-100 p-3 shadow-2xl">
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300" />
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-slate-700">
                Resumen de carrito
              </p>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)] pb-[max(env(safe-area-inset-bottom),0.5rem)]">
              {renderCartPanel({ mobile: true })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSPage;
