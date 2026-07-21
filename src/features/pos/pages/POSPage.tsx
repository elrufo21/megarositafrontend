import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { createColumnHelper } from "@tanstack/react-table";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Autocomplete from "@mui/material/Autocomplete";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import DataTable from "@/components/DataTable";
import CustomerDialogContent, {
  CUSTOMER_DIALOG_FORM_ID,
} from "@/features/pos/components/CustomerDialogContent";
import NavigableNumberInput from "@/components/inputs/NavigableNumberInput";
import { useClientsStore } from "@/store/customers/customers.store";
import { useProductsStore } from "@/store/products/products.store";
import { usePosStore, selectTotals } from "@/store/pos/pos.store";
import { useDialogStore } from "@/store/app/dialog.store";
import { useAuthStore } from "@/store/auth/auth.store";
import { usePosCartDraftPersistence } from "@/features/pos/hooks/usePosCartDraftPersistence";
import type { Product } from "@/types/product";
import type { ProductUnitOption } from "@/types/product";
import type { PosCartItem } from "@/types/pos";
import type { Client } from "@/types/customer";
import { toast } from "@/shared/ui/toast";
import { apiRequest } from "@/shared/helpers/apiRequest";
import { buildApiUrl } from "@/config";
import { getLocalDateTimeISO } from "@/shared/helpers/localDate";
import {
  IGV_FACTOR,
  buildSaleMonetarySummary,
  roundCurrency,
} from "@/shared/helpers/saleMonetary";

type PosCatalogProduct = Product & {
  catalogKey: string;
  detalleId?: number;
  isVariation?: boolean;
  baseProductId?: number;
  valorUM?: number;
};

type PosPriceMode = "A" | "B";

type StockWarehouseRow = {
  almacenNombre: string;
  cantidad: number;
  stock: number;
  unidadMedida: string;
};

type StockInquiryState = {
  productName: string;
  productCode: string;
  unit: string;
  storeStock: number;
  requestedQty: number;
  missingQty: number;
  rows: StockWarehouseRow[];
  loading: boolean;
};

type StockWarehousesResponse = {
  cantidadPedido?: number | string;
  stockTienda?: number | string;
  faltaCompletar?: number | string;
  items?: Array<{
    almacenNombre?: string | null;
    cantidad?: number | string | null;
    stock?: number | string | null;
    unidadMedida?: string | null;
  }>;
};

type PersonalByCodeResponse = {
  personalEstado?: string;
  nombreApellido?: string;
};

type AuthSessionPayload = {
  user?: {
    companyId?: unknown;
    companyName?: unknown;
    displayName?: unknown;
    username?: unknown;
    maxDiscount?: unknown;
    cardPercentage?: unknown;
    tarjetaPorcentaje?: unknown;
    TarjetaPorcentaje?: unknown;
  };
  descuentoMax?: unknown;
  razonSocial?: unknown;
  tarjetaPorcentaje?: unknown;
  TarjetaPorcentaje?: unknown;
  loginPayload?: {
    tarjetaPorcentaje?: unknown;
    TarjetaPorcentaje?: unknown;
  };
};

type PosDocTypeCode = "SELECCIONAR" | "03" | "01" | "101" | "001";
type PosPaymentMethod =
  | "EFECTIVO"
  | "TARJETA"
  | "DEPO. BCP"
  | "DEPO. SCOTIABANK"
  | "DEPO. CONTINENTAL";

type PosSaleSettings = {
  docTypeCode: PosDocTypeCode;
  paymentMethod: PosPaymentMethod;
  clienteId: number | null;
  customerName: string;
  customerId: string;
  customerRuc: string;
  customerDni: string;
  fiscalAddress: string;
  shippingAddress: string;
  phone: string;
  movementCost: string;
  bankEntity: string;
  nroOperacion: string;
  applyDiscount: boolean;
  discount: string;
};

type SaleFocusableElement = HTMLInputElement | HTMLTextAreaElement;
type MuiInputKeyboardEvent = KeyboardEvent<HTMLInputElement> & {
  defaultMuiPrevented?: boolean;
};

type PersonalCodeFieldProps = {
  onInputRef: (node: HTMLInputElement | null) => void;
  onEnter?: () => void;
};

const PersonalCodeField = ({ onInputRef, onEnter }: PersonalCodeFieldProps) => {
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setInputRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    onInputRef(node);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="relative">
      <input
        ref={setInputRef}
        type="text"
        autoFocus
        autoComplete="one-time-code"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        placeholder="Codigo de usuario"
        className={`h-10 w-full rounded-lg border border-slate-300 px-3 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${isCodeVisible ? "" : "[-webkit-text-security:disc]"}`}
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
const DEFAULT_POS_SALE_SETTINGS: PosSaleSettings = {
  docTypeCode: "SELECCIONAR",
  paymentMethod: "EFECTIVO",
  clienteId: PROFORMA_DEFAULT_CONTACT_ID,
  customerName: "VARIOS",
  customerId: "",
  customerRuc: "",
  customerDni: "",
  fiscalAddress: "",
  shippingAddress: "",
  phone: "",
  movementCost: "",
  bankEntity: "-",
  nroOperacion: "",
  applyDiscount: false,
  discount: "",
};
const POS_DOC_TYPE_CONFIG: Record<
  PosDocTypeCode,
  { docu: string; serie: string; label: string }
> = {
  SELECCIONAR: { docu: "", serie: "", label: "Seleccione" },
  "03": { docu: "BOLETA", serie: "BA01", label: "Boleta" },
  "01": { docu: "FACTURA", serie: "FA01", label: "Factura" },
  "101": { docu: "PROFORMA V", serie: "0001", label: "Proforma V" },
  "001": { docu: "PROFORMA", serie: "0001", label: "Proforma" },
};
const POS_DOC_TYPE_OPTIONS: PosDocTypeCode[] = [
  "SELECCIONAR",
  "101",
  "03",
  "01",
  "001",
];
const POS_PAYMENT_METHODS: Array<{ value: PosPaymentMethod; label: string }> = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "DEPO. BCP", label: "DEPO. BCP" },
  { value: "DEPO. SCOTIABANK", label: "DEPO. SCOTIABANK" },
  { value: "DEPO. CONTINENTAL", label: "DEPO. CONTINENTAL" },
];
const normalizePosSaleSettings = (value: unknown): PosSaleSettings | null => {
  const record =
    value && typeof value === "object"
      ? (value as Partial<PosSaleSettings>)
      : null;
  if (!record) return null;

  const docTypeCode = POS_DOC_TYPE_OPTIONS.includes(
    record.docTypeCode as PosDocTypeCode,
  )
    ? (record.docTypeCode as PosDocTypeCode)
    : DEFAULT_POS_SALE_SETTINGS.docTypeCode;
  const customerId = String(record.customerId ?? "");

  return {
    ...DEFAULT_POS_SALE_SETTINGS,
    ...record,
    docTypeCode,
    paymentMethod: (record.paymentMethod ??
      DEFAULT_POS_SALE_SETTINGS.paymentMethod) as PosPaymentMethod,
    clienteId:
      record.clienteId === null || Number.isFinite(Number(record.clienteId))
        ? (record.clienteId ?? null)
        : DEFAULT_POS_SALE_SETTINGS.clienteId,
    customerId,
    customerDni:
      docTypeCode === "01" ? "" : String(record.customerDni ?? customerId),
    customerRuc:
      docTypeCode === "01" ? String(record.customerRuc ?? customerId) : "",
    customerName: String(
      record.customerName ?? DEFAULT_POS_SALE_SETTINGS.customerName,
    ),
    fiscalAddress: String(record.fiscalAddress ?? ""),
    shippingAddress: String(record.shippingAddress ?? ""),
    phone: String(record.phone ?? ""),
    movementCost: String(record.movementCost ?? ""),
    bankEntity: String(
      record.bankEntity ?? DEFAULT_POS_SALE_SETTINGS.bankEntity,
    ),
    nroOperacion: String(record.nroOperacion ?? ""),
    applyDiscount: Boolean(record.applyDiscount),
    discount: String(record.discount ?? ""),
  };
};
const isGenericVariosCustomer = (value: unknown) => {
  const words = String(value ?? "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => word === "VARIOS");
};
const POS_PAYMENT_TEXT_FIELD_SX = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "0.45rem",
    backgroundColor: "#fff",
    minHeight: "2.5rem",
    "@media (max-width:1024px)": {
      minHeight: "2.875rem",
    },
    "& fieldset": {
      borderWidth: "1px",
      borderColor: "#e5e7eb",
    },
    "&.Mui-focused fieldset": {
      borderColor: "#3b82f6",
      boxShadow: "0 0 0 2px rgba(59,130,246,0.25)",
    },
  },
  "& .MuiInputBase-input": {
    fontSize: "0.875rem",
    py: 1,
    "@media (max-width:1024px)": {
      fontSize: "1rem",
      py: 1.2,
    },
  },
};

const roundPrice = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const formatPrice = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0.00";
  return roundPrice(numeric).toFixed(2);
};
const numericPrice = (value: unknown) => {
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};
const priceAValue = (record: { precioA?: unknown; preVenta?: unknown }) =>
  numericPrice(record.precioA ?? record.preVenta);
const priceBValue = (record: { precioB?: unknown; preVentaB?: unknown }) =>
  numericPrice(record.precioB ?? record.preVentaB);
const productPrice = (product: Product, mode: PosPriceMode) => {
  const priceA = priceAValue(product) || priceBValue(product);
  const priceB = priceBValue(product);
  return mode === "B" && priceB > 0 ? priceB : priceA;
};
const samePrice = (left: unknown, right: unknown) =>
  Math.abs(numericPrice(left) - numericPrice(right)) < 0.005;
const parsePercentageLikeValue = (value: unknown, fallback = 0): number => {
  const normalized = String(value ?? "")
    .trim()
    .replace("%", "")
    .replace(",", ".");
  if (!normalized) return fallback;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
};
const normalizePosSearchText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const normalizePosDocumentText = (value: unknown) =>
  String(value ?? "").replace(/\D/g, "");
const tokenizePosSearchText = (value: unknown) =>
  normalizePosSearchText(value).split(/\s+/).filter(Boolean);
const priceLabel = (product: Product, mode: PosPriceMode = "A") =>
  formatPrice(productPrice(product, mode));
const composeProductDisplayName = (name: unknown, brand?: unknown): string =>
  [name, brand]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
const resolvePosImageSrc = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw || /^(https?:|blob:|data:)/i.test(raw)) return raw;

  const parts = raw.replace(/\\+/g, "/").split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? "";
  if (!fileName) return "";

  const host = raw.startsWith("\\") ? parts[0] : "192.168.100.44";
  return `http://${host}:8082/${encodeURIComponent(fileName)}`;
};
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
  const [viewMode, setViewMode] = useState<"table" | "cards">("cards");
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(CATALOG_PAGE_SIZE);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [cartTab, setCartTab] = useState<"payment" | "products">("products");
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouseImagePreview, setWarehouseImagePreview] = useState<{
    src: string;
    title: string;
  } | null>(null);
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [warehousePage, setWarehousePage] = useState(1);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    products,
    warehouseProducts,
    fetchCatalogProducts,
    fetchWarehouseProducts,
    resetCatalogProducts,
    loading,
    warehouseLoading,
    catalogPagination,
    warehousePagination,
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
  const setServerItemsInStore = usePosStore(
    (state) => state.setServerItemsFromNota,
  );
  const clients = useClientsStore((state) => state.clients);
  const clientsLoading = useClientsStore((state) => state.loading);
  const fetchClients = useClientsStore((state) => state.fetchClients);
  const addClient = useClientsStore((state) => state.addClient);
  const updateClient = useClientsStore((state) => state.updateClient);
  const openDialog = useDialogStore((state) => state.openDialog);
  const closeDialog = useDialogStore((state) => state.closeDialog);
  const setDialogLoading = useDialogStore((state) => state.setLoading);
  const sessionCompanyId = useAuthStore((state) => state.user?.companyId);
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
  const saleDefaultClientInitializedRef = useRef(false);
  const appendScrollTopRef = useRef<number | null>(null);
  const warehouseSearchTimeoutRef = useRef<number | null>(null);
  const warehouseLastSearchValueRef = useRef("");
  const warehouseSearchInputRef = useRef<HTMLInputElement | null>(null);
  const warehouseWasOpenRef = useRef(false);
  const saleDocTypeInputRef = useRef<SaleFocusableElement | null>(null);
  const salePaymentMethodInputRef = useRef<SaleFocusableElement | null>(null);
  const saleCustomerInputRef = useRef<SaleFocusableElement | null>(null);
  const saleDniInputRef = useRef<SaleFocusableElement | null>(null);
  const saleRucInputRef = useRef<SaleFocusableElement | null>(null);
  const saleFiscalAddressInputRef = useRef<SaleFocusableElement | null>(null);
  const saleShippingAddressInputRef = useRef<SaleFocusableElement | null>(null);
  const salePhoneInputRef = useRef<SaleFocusableElement | null>(null);
  const saleBankEntityInputRef = useRef<SaleFocusableElement | null>(null);
  const saleOperationInputRef = useRef<SaleFocusableElement | null>(null);
  const saleMovementCostInputRef = useRef<SaleFocusableElement | null>(null);
  const saleDiscountInputRef = useRef<SaleFocusableElement | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const priceMode: PosPriceMode = "A";
  const [cartPriceMode, setCartPriceMode] = useState<PosPriceMode>("A");
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>(
    {},
  );
  const [stockInquiry, setStockInquiry] = useState<StockInquiryState | null>(
    null,
  );
  const [isSubmittingQuickSale, setIsSubmittingQuickSale] = useState(false);
  const [saleSettings, setSaleSettings] = useState<PosSaleSettings>(
    DEFAULT_POS_SALE_SETTINGS,
  );
  const [saleCustomerInput, setSaleCustomerInput] = useState("VARIOS");

  const safeTrim = (value: unknown) => String(value ?? "").trim();
  const isPaymentMethodAllowedForCompany = (methodValue: unknown) => {
    const method = safeTrim(methodValue).toUpperCase();
    if (!method || method === "SELECCIONE" || method === "EFECTIVO")
      return true;
    const allowed =
      Number(companyId) === 4
        ? ["DEPO. CONTINENTAL", "DEPO. BCP", "TARJETA"]
        : ["DEPO. BCP", "DEPO. SCOTIABANK"];
    return allowed.includes(method);
  };
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
  const toDecimal = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const raw = safeTrim(value).replace(/[^\d,.-]/g, "");
    if (!raw) return 0;
    const normalized =
      raw.includes(",") && raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const {
    companyId,
    companyNameFromSession,
    usernameFromSession,
    discountMaxFromSession,
    cardPercentageFromSession,
  } = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        companyId: 1,
        companyNameFromSession: "",
        usernameFromSession: "USUARIO",
        discountMaxFromSession: 0,
        cardPercentageFromSession: 5,
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
      parsedSession?.user?.companyId ??
      sessionCompanyId ??
      localStorage.getItem("companiaId");
    const companyIdNum = Number(companyIdRaw);
    const safeCompanyId =
      Number.isFinite(companyIdNum) && companyIdNum > 0 ? companyIdNum : 1;
    const companyNameFromSession = safeTrim(
      parsedSession?.user?.companyName ?? parsedSession?.razonSocial ?? "",
    );
    const username =
      safeTrim(parsedSession?.user?.displayName) ||
      safeTrim(parsedSession?.user?.username) ||
      "USUARIO";
    const discountMaxRaw =
      parsedSession?.user?.maxDiscount ?? parsedSession?.descuentoMax ?? 0;
    const discountMaxNumeric = Number(discountMaxRaw);
    const discountMaxFromSession =
      Number.isFinite(discountMaxNumeric) && discountMaxNumeric > 0
        ? discountMaxNumeric
        : 0;
    const cardPercentageFromSession = parsePercentageLikeValue(
      parsedSession?.user?.cardPercentage ??
        parsedSession?.user?.tarjetaPorcentaje ??
        parsedSession?.user?.TarjetaPorcentaje ??
        parsedSession?.tarjetaPorcentaje ??
        parsedSession?.TarjetaPorcentaje ??
        parsedSession?.loginPayload?.tarjetaPorcentaje ??
        parsedSession?.loginPayload?.TarjetaPorcentaje ??
        5,
      5,
    );

    return {
      companyId: safeCompanyId,
      companyNameFromSession,
      usernameFromSession: username,
      discountMaxFromSession,
      cardPercentageFromSession,
    };
  }, [sessionCompanyId]);

  const uniqueSaleClients = useMemo(() => {
    const seen = new Set<string>();
    return clients.filter((client, index) => {
      const dniKey = safeTrim(client.dni).replace(/\D/g, "");
      const rucKey = safeTrim(client.ruc).replace(/\D/g, "");
      const idKey =
        client.id !== undefined && client.id !== null ? `id-${client.id}` : "";
      const nameKey = client.nombreRazon
        ? `name-${normalizePosSearchText(client.nombreRazon)}`
        : "";
      const key =
        (dniKey && `dni-${dniKey}`) ||
        (rucKey && `ruc-${rucKey}`) ||
        nameKey ||
        idKey ||
        `idx-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [clients]);

  const clientOptions = useMemo(() => {
    const byLabel = new Map<
      string,
      (typeof uniqueSaleClients)[number] & { label: string }
    >();

    uniqueSaleClients
      .filter((client) => Number(client.id) > 0)
      .forEach((client) => {
        const label = safeTrim(client.nombreRazon) || `Cliente ${client.id}`;
        const key = normalizePosSearchText(label);
        const option = {
          ...client,
          label,
        };
        const current = byLabel.get(key);
        const optionScore =
          Number(Boolean(safeTrim(option.ruc))) * 2 +
          Number(Boolean(safeTrim(option.dni)));
        const currentScore = current
          ? Number(Boolean(safeTrim(current.ruc))) * 2 +
            Number(Boolean(safeTrim(current.dni)))
          : -1;

        if (!current || optionScore > currentScore) {
          byLabel.set(key, option);
        }
      });

    return Array.from(byLabel.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [uniqueSaleClients]);
  const selectedSaleClient = useMemo(
    () =>
      clientOptions.find(
        (client) => Number(client.id) === Number(saleSettings.clienteId),
      ) ?? null,
    [clientOptions, saleSettings.clienteId],
  );
  const selectedSaleClientValue =
    selectedSaleClient &&
    normalizePosSearchText(selectedSaleClient.label) ===
      normalizePosSearchText(saleCustomerInput)
      ? selectedSaleClient
      : null;
  const saleDocConfig = POS_DOC_TYPE_CONFIG[saleSettings.docTypeCode];
  const isSaleFactura = saleSettings.docTypeCode === "01";
  const isSaleBoleta = saleSettings.docTypeCode === "03";
  const isSaleProforma =
    saleSettings.docTypeCode === "101" || saleSettings.docTypeCode === "001";
  const shouldShowSaleBankFields = saleSettings.paymentMethod !== "EFECTIVO";
  const saleDiscountAmount = saleSettings.applyDiscount
    ? roundCurrency(
        Math.min(
          Math.max(0, toDecimal(saleSettings.discount)),
          Math.max(0, Number(discountMaxFromSession ?? 0)),
          Math.max(0, Number(totals.total ?? 0)),
        ),
      )
    : 0;
  const saleDiscountBase = isSaleProforma
    ? saleDiscountAmount
    : roundCurrency(saleDiscountAmount / IGV_FACTOR);
  const saleDiscountedTotal = roundCurrency(
    Math.max(0, Number(totals.total ?? 0) - saleDiscountAmount),
  );
  const saleGrossMonetarySummary = useMemo(
    () =>
      isSaleProforma
        ? {
            subtotalWithoutIgv: roundCurrency(Number(totals.total ?? 0)),
            igv: 0,
            totalWithIgv: roundCurrency(Number(totals.total ?? 0)),
          }
        : buildSaleMonetarySummary({
            lines: items.map((item) => ({
              quantity: Number(item.cantidad ?? 0),
              unitPrice: Number(item.precio ?? 0),
              unitMeasure: item.unidadMedida ?? "UND",
            })),
            pricesIncludeIgv: true,
          }),
    [isSaleProforma, items, totals.total],
  );
  const saleMonetarySummary = useMemo(
    () =>
      isSaleProforma
        ? {
            subtotalWithoutIgv: saleDiscountedTotal,
            igv: 0,
            totalWithIgv: saleDiscountedTotal,
          }
        : buildSaleMonetarySummary({
            lines: items.map((item) => ({
              quantity: Number(item.cantidad ?? 0),
              unitPrice: Number(item.precio ?? 0),
              unitMeasure: item.unidadMedida ?? "UND",
            })),
            pricesIncludeIgv: true,
            discountWithoutIgv: saleDiscountBase,
          }),
    [isSaleProforma, items, saleDiscountBase, saleDiscountedTotal],
  );
  const saleOperacionGravada = roundCurrency(
    saleGrossMonetarySummary.subtotalWithoutIgv,
  );
  const saleDocumentGravada = roundCurrency(
    saleMonetarySummary.subtotalWithoutIgv,
  );
  const saleDocumentTotal = roundCurrency(saleMonetarySummary.totalWithIgv);
  const saleMovementAmount = roundCurrency(
    Math.max(0, toDecimal(saleSettings.movementCost)),
  );
  const saleCardChargeBase = roundCurrency(
    Math.max(
      0,
      Number(totals.total ?? 0) + saleMovementAmount - saleDiscountAmount,
    ),
  );
  const saleCardAdditional =
    saleSettings.paymentMethod === "TARJETA"
      ? roundCurrency(
          saleCardChargeBase *
            (Math.max(0, Number(cardPercentageFromSession ?? 0)) / 100),
        )
      : 0;
  const saleTotalAmount = roundCurrency(
    saleDocumentTotal + saleMovementAmount + saleCardAdditional,
  );
  const saleTaxableTotal = roundCurrency(
    saleDocumentTotal + saleMovementAmount,
  );
  const saleAdjustmentBase = isSaleProforma
    ? 0
    : roundCurrency(saleMovementAmount / IGV_FACTOR);
  const saleGravada = isSaleProforma
    ? saleDocumentGravada
    : roundCurrency(saleDocumentGravada + saleAdjustmentBase);
  const saleIgvAmount = isSaleProforma
    ? 0
    : roundCurrency(saleTaxableTotal - saleGravada);
  const useSaleCommercialCardTotals =
    !isSaleProforma && saleSettings.paymentMethod === "TARJETA";
  const saleCommercialSubtotal = roundCurrency(Number(totals.total ?? 0));
  const saleTicketSubtotal = useSaleCommercialCardTotals
    ? roundCurrency(saleTotalAmount / IGV_FACTOR)
    : saleGravada;
  const saleTicketIgv = useSaleCommercialCardTotals
    ? roundCurrency(saleTotalAmount - saleTicketSubtotal)
    : saleIgvAmount;
  const saleTicketGravada = saleOperacionGravada;
  const saleTicketDescuento = saleDiscountBase;
  const saleDisplayOperacionGravada = useSaleCommercialCardTotals
    ? saleTotalAmount
    : saleOperacionGravada;
  const saleDisplaySubtotal = useSaleCommercialCardTotals
    ? saleCommercialSubtotal
    : saleGravada;
  const saleDisplayIgv = useSaleCommercialCardTotals ? 0 : saleIgvAmount;
  const focusSaleField = (
    ref: RefObject<SaleFocusableElement | null>,
    select = false,
  ) => {
    window.setTimeout(() => {
      const node = ref.current;
      node?.focus();
      if (select) node?.select();
    }, 0);
  };
  const nextSaleDocumentFieldRef =
    saleSettings.docTypeCode === "01" ? saleRucInputRef : saleDniInputRef;
  const nextSaleAfterCustomerRef = isSaleProforma
    ? saleFiscalAddressInputRef
    : nextSaleDocumentFieldRef;
  const nextSaleAfterPhoneRef = shouldShowSaleBankFields
    ? saleBankEntityInputRef
    : saleMovementCostInputRef;
  const nextSaleAfterMovementRef = saleSettings.applyDiscount
    ? saleDiscountInputRef
    : null;
  const handleSaleEnterFocus =
    (
      nextRef: RefObject<SaleFocusableElement | null> | null,
      selectNext = false,
    ) =>
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" || event.shiftKey || !nextRef) return;
      const input = event.currentTarget as HTMLInputElement;
      if (input.getAttribute("aria-expanded") === "true") return;
      event.preventDefault();
      focusSaleField(nextRef, selectNext);
    };
  const saleClientOptions = useMemo(
    () =>
      isSaleFactura
        ? clientOptions.filter(
            (client) => client.label.toUpperCase() !== "VARIOS",
          )
        : clientOptions,
    [clientOptions, isSaleFactura],
  );
  const saleClientByName = useMemo(() => {
    const byName = new Map<string, (typeof saleClientOptions)[number]>();
    saleClientOptions.forEach((client) => {
      byName.set(normalizePosSearchText(client.label), client);
    });
    return byName;
  }, [saleClientOptions]);

  const documentForClient = useCallback(
    (
      client: (typeof clientOptions)[number] | null,
      docTypeCode = saleSettings.docTypeCode,
    ) => safeTrim(docTypeCode === "01" ? client?.ruc : client?.dni),
    [saleSettings.docTypeCode],
  );
  const customerFieldsFromClient = useCallback(
    (
      client: (typeof clientOptions)[number] | null,
      docTypeCode: PosDocTypeCode,
    ) => ({
      customerId: documentForClient(client, docTypeCode),
      customerRuc: safeTrim(client?.ruc),
      customerDni: safeTrim(client?.dni),
      fiscalAddress: safeTrim(client?.direccionFiscal),
      shippingAddress: safeTrim(client?.direccionDespacho),
      phone: safeTrim(client?.telefonoMovil),
    }),
    [documentForClient],
  );

  const applyClientToSale = useCallback(
    (client: Client) => {
      const option = {
        ...client,
        label: safeTrim(client.nombreRazon) || `Cliente ${client.id}`,
      };
      setSaleCustomerInput(option.label);
      setSaleSettings((prev) => ({
        ...prev,
        clienteId: option.id,
        customerName: option.label,
        ...customerFieldsFromClient(option, prev.docTypeCode),
      }));
    },
    [customerFieldsFromClient],
  );

  const handleSelectClientFromDialog = useCallback(
    (client: Client) => {
      applyClientToSale(client);
      closeDialog();
    },
    [applyClientToSale, closeDialog],
  );

  const handleCreateClientFromDialog = useCallback(
    async (data: Omit<Client, "id">) => {
      const payload: Omit<Client, "id"> = {
        nombreRazon: safeTrim(data.nombreRazon).toUpperCase(),
        ruc: safeTrim(data.ruc),
        dni: safeTrim(data.dni),
        direccionFiscal: safeTrim(data.direccionFiscal),
        direccionDespacho: safeTrim(data.direccionDespacho),
        telefonoMovil: safeTrim(data.telefonoMovil),
        email: safeTrim(data.email),
        registradoPor: safeTrim(data.registradoPor) || usernameFromSession,
        estado: safeTrim(data.estado) || "ACTIVO",
        fecha: data.fecha ?? null,
      };

      if (!payload.nombreRazon) {
        toast.error("El nombre o razon social es obligatorio.");
        return false;
      }

      const result = await addClient(payload);
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo crear el cliente.");
        return false;
      }

      await fetchClients("");
      const refreshedClients = useClientsStore.getState().clients;
      const normalizedName = normalizePosSearchText(payload.nombreRazon);
      const normalizedRuc = safeTrim(payload.ruc);
      const normalizedDni = safeTrim(payload.dni);
      const createdClient =
        refreshedClients.find((client) => {
          const clientRuc = safeTrim(client.ruc);
          const clientDni = safeTrim(client.dni);
          return (
            (normalizedRuc && clientRuc === normalizedRuc) ||
            (normalizedDni && clientDni === normalizedDni) ||
            normalizePosSearchText(client.nombreRazon) === normalizedName
          );
        }) ?? null;

      applyClientToSale(
        createdClient ?? {
          id: 0,
          ...payload,
        },
      );
      toast.success("Cliente creado correctamente.");
      closeDialog();
      return true;
    },
    [
      addClient,
      applyClientToSale,
      closeDialog,
      fetchClients,
      usernameFromSession,
    ],
  );

  const handleUpdateClientFromDialog = useCallback(
    async (client: Client, data: Omit<Client, "id">) => {
      const payload: Omit<Client, "id"> = {
        nombreRazon: safeTrim(data.nombreRazon).toUpperCase(),
        ruc: safeTrim(data.ruc),
        dni: safeTrim(data.dni),
        direccionFiscal: safeTrim(data.direccionFiscal),
        direccionDespacho: safeTrim(data.direccionDespacho),
        telefonoMovil: safeTrim(data.telefonoMovil),
        email: safeTrim(data.email),
        registradoPor: safeTrim(data.registradoPor) || usernameFromSession,
        estado: safeTrim(data.estado) || "ACTIVO",
        fecha: data.fecha ?? null,
      };

      if (!payload.nombreRazon) {
        toast.error("El nombre o razon social es obligatorio.");
        return false;
      }

      const result = await updateClient(client.id, { ...client, ...payload });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo actualizar el cliente.");
        return false;
      }

      await fetchClients("");
      const refreshedClients = useClientsStore.getState().clients;
      const normalizedName = normalizePosSearchText(payload.nombreRazon);
      const normalizedRuc = safeTrim(payload.ruc);
      const normalizedDni = safeTrim(payload.dni);
      const updatedClient =
        refreshedClients.find((item) => Number(item.id) === Number(client.id)) ??
        refreshedClients.find((item) => {
          const itemRuc = safeTrim(item.ruc);
          const itemDni = safeTrim(item.dni);
          return (
            (normalizedRuc && itemRuc === normalizedRuc) ||
            (normalizedDni && itemDni === normalizedDni) ||
            normalizePosSearchText(item.nombreRazon) === normalizedName
          );
        }) ??
        ({ ...client, ...payload } as Client);
      applyClientToSale(updatedClient);
      toast.success("Cliente actualizado correctamente.");
      closeDialog();
      return true;
    },
    [
      applyClientToSale,
      closeDialog,
      fetchClients,
      updateClient,
      usernameFromSession,
    ],
  );

  const openSaleCustomerDialog = useCallback(() => {
    openDialog({
      maxWidth: "lg",
      fullWidth: true,
      cancelText: "Cerrar",
      confirmText: "Guardar",
      onConfirm: () => {
        (
          document.getElementById(CUSTOMER_DIALOG_FORM_ID) as
            | HTMLFormElement
            | null
        )?.requestSubmit();
        return false;
      },
      content: (
        <CustomerDialogContent
          initialEditingClient={
            selectedSaleClient &&
            !isGenericVariosCustomer(selectedSaleClient.label)
              ? selectedSaleClient
              : null
          }
          initialQuery={
            safeTrim(saleCustomerInput).toUpperCase() === "VARIOS"
              ? ""
              : saleCustomerInput
          }
          onSelectClient={handleSelectClientFromDialog}
          onCreateClient={handleCreateClientFromDialog}
          onUpdateClient={handleUpdateClientFromDialog}
        />
      ),
    });
  }, [
    handleCreateClientFromDialog,
    handleSelectClientFromDialog,
    handleUpdateClientFromDialog,
    openDialog,
    saleCustomerInput,
    selectedSaleClient,
  ]);
  const saleDniOptions = useMemo(() => {
    const byDocument = new Map<
      string,
      { value: string; label: string; client: (typeof clientOptions)[number] }
    >();

    saleClientOptions.forEach((client) => {
      const value = safeTrim(client.dni);
      const key = normalizePosDocumentText(value);
      if (!key || byDocument.has(key)) return;
      byDocument.set(key, {
        value,
        label: value,
        client,
      });
    });

    return Array.from(byDocument.values());
  }, [saleClientOptions]);
  const saleRucOptions = useMemo(() => {
    const byDocument = new Map<
      string,
      { value: string; label: string; client: (typeof clientOptions)[number] }
    >();

    saleClientOptions.forEach((client) => {
      const value = safeTrim(client.ruc);
      const key = normalizePosDocumentText(value);
      if (!key || byDocument.has(key)) return;
      byDocument.set(key, {
        value,
        label: value,
        client,
      });
    });

    return Array.from(byDocument.values());
  }, [saleClientOptions]);
  const filterSaleClientOptions = useCallback(
    (options: typeof saleClientOptions, inputValue: string) => {
      const input = normalizePosSearchText(inputValue);
      if (!input) return options.slice(0, 100);
      const tokens = tokenizePosSearchText(input);

      return options
        .map((client) => {
          const label = normalizePosSearchText(client.label);
          const document = normalizePosSearchText(
            `${client.dni ?? ""} ${client.ruc ?? ""}`,
          );
          const matches = tokens.every(
            (token) => label.includes(token) || document.includes(token),
          );
          if (!matches) return null;

          let score = 4;
          if (label === input || document === input) score = 0;
          else if (label.startsWith(input)) score = 1;
          else if (
            tokens.every((token) =>
              label.split(" ").some((part) => part.startsWith(token)),
            )
          ) {
            score = 2;
          } else if (document.startsWith(input)) score = 3;

          return { client, score };
        })
        .filter(
          (
            item,
          ): item is {
            client: (typeof saleClientOptions)[number];
            score: number;
          } => item !== null,
        )
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.client.label.localeCompare(b.client.label, "es", {
            sensitivity: "base",
          });
        })
        .map((item) => item.client)
        .slice(0, 100);
    },
    [],
  );
  const filterSaleDocumentOptions = useCallback(
    <
      TOption extends {
        value: string;
        label: string;
        client: { label: string };
      },
    >(
      options: TOption[],
      inputValue: string,
    ) => {
      const input = normalizePosSearchText(inputValue);
      const inputDocument = normalizePosDocumentText(inputValue);
      if (!input && !inputDocument) return options.slice(0, 100);

      return options
        .filter((option) => {
          const doc = normalizePosDocumentText(option.value);
          const clientLabel = normalizePosSearchText(option.client.label);
          return (
            (inputDocument !== "" && doc.includes(inputDocument)) ||
            (input !== "" && clientLabel.includes(input))
          );
        })
        .sort((a, b) => {
          const aDoc = normalizePosDocumentText(a.value);
          const bDoc = normalizePosDocumentText(b.value);
          const aStarts =
            inputDocument !== "" && aDoc.startsWith(inputDocument);
          const bStarts =
            inputDocument !== "" && bDoc.startsWith(inputDocument);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return aDoc.localeCompare(bDoc);
        })
        .slice(0, 100);
    },
    [],
  );
  const selectSaleClientOption = (client: (typeof saleClientOptions)[number]) => {
    setSaleCustomerInput(client.label);
    setSaleSettings((prev) => ({
      ...prev,
      clienteId: client.id,
      customerName: client.label,
      ...customerFieldsFromClient(client, prev.docTypeCode),
    }));
    focusSaleField(nextSaleAfterCustomerRef, true);
  };
  const selectSaleDocumentOption = (
    type: "dni" | "ruc",
    option: (typeof saleDniOptions)[number],
  ) => {
    setSaleCustomerInput(option.client.label);
    setSaleSettings((prev) => ({
      ...prev,
      clienteId: option.client.id,
      customerName: option.client.label,
      ...customerFieldsFromClient(option.client, prev.docTypeCode),
      ...(type === "ruc"
        ? {
          customerRuc: option.value,
          customerId:
              prev.docTypeCode === "01"
                ? option.value
                : safeTrim(option.client.dni),
        }
        : {
            customerDni: option.value,
            customerId:
              prev.docTypeCode === "01"
                ? safeTrim(option.client.ruc)
                : option.value,
          }),
    }));
    focusSaleField(
      type === "ruc" ? saleFiscalAddressInputRef : saleRucInputRef,
      true,
    );
  };
  const selectOnlySaleClientMatch = (inputValue: string) => {
    const matches = filterSaleClientOptions(saleClientOptions, inputValue);
    if (matches.length !== 1) return false;
    selectSaleClientOption(matches[0]);
    return true;
  };
  const selectOnlySaleDocumentMatch = (
    type: "dni" | "ruc",
    inputValue: string,
  ) => {
    const options = type === "ruc" ? saleRucOptions : saleDniOptions;
    const matches = filterSaleDocumentOptions(options, inputValue);
    if (matches.length !== 1) return false;
    selectSaleDocumentOption(type, matches[0]);
    return true;
  };
  const renderSaleDocumentOption = (
    type: "dni" | "ruc",
    props: HTMLAttributes<HTMLLIElement>,
    option: (typeof saleDniOptions)[number],
  ) => (
    <li
      {...props}
      onMouseDown={(event) => {
        props.onMouseDown?.(event);
        selectSaleDocumentOption(type, option);
      }}
      onTouchStart={(event) => {
        props.onTouchStart?.(event);
        selectSaleDocumentOption(type, option);
      }}
    >
      {option.label}
    </li>
  );
  const applySaleCustomerInput = useCallback(
    (value: string) => {
      const typedName = normalizePosSearchText(value);
      const matchedClient = saleClientByName.get(typedName) ?? null;

      setSaleCustomerInput(value);
      setSaleSettings((prev) => ({
        ...prev,
        clienteId: matchedClient?.id ?? null,
        customerName: value,
        ...(matchedClient
          ? customerFieldsFromClient(matchedClient, prev.docTypeCode)
          : {}),
      }));
    },
    [customerFieldsFromClient, saleClientByName],
  );
  const ensureExistingSaleCustomer = (rawName: string) => {
    const typedName = safeTrim(rawName);
    if (!typedName) return;
    const matchedClient = saleClientByName.get(
      normalizePosSearchText(typedName),
    );
    if (matchedClient) {
      setSaleCustomerInput(matchedClient.label);
      setSaleSettings((prev) => ({
        ...prev,
        clienteId: matchedClient.id,
        customerName: matchedClient.label,
        ...customerFieldsFromClient(matchedClient, prev.docTypeCode),
      }));
      return;
    }
    if (isSaleProforma) return;
    toast.error(
      "Intentaste seleccionar un cliente que no existe, por favor agrega el cliente y seleccionalo.",
    );
    setSaleCustomerInput("");
    setSaleSettings((prev) => ({
      ...prev,
      clienteId: null,
      customerName: "",
      customerId: "",
      customerRuc: "",
      customerDni: "",
      fiscalAddress: "",
      shippingAddress: "",
      phone: "",
    }));
  };
  const ensureExistingSaleDocument = (
    type: "dni" | "ruc",
    rawValue: string,
  ) => {
    const typedDocument = normalizePosDocumentText(rawValue);
    if (!typedDocument || isSaleProforma) return;
    const options = type === "ruc" ? saleRucOptions : saleDniOptions;
    const matchedOption = options.find(
      (option) => normalizePosDocumentText(option.value) === typedDocument,
    );
    if (matchedOption) {
      setSaleCustomerInput(matchedOption.client.label);
      setSaleSettings((prev) => ({
        ...prev,
        clienteId: matchedOption.client.id,
        customerName: matchedOption.client.label,
        ...customerFieldsFromClient(matchedOption.client, prev.docTypeCode),
        ...(type === "ruc"
          ? { customerRuc: matchedOption.value }
          : { customerDni: matchedOption.value }),
      }));
      return;
    }
    toast.error(
      `El ${type === "ruc" ? "RUC" : "DNI"} no existe. Agrega el cliente y seleccionalo.`,
    );
    setSaleCustomerInput("");
    setSaleSettings((prev) => ({
      ...prev,
      clienteId: null,
      customerName: "",
      customerId: "",
      customerRuc: "",
      customerDni: "",
    }));
  };

  useEffect(() => {
    if (!clients.length) void fetchClients("ACTIVO");
  }, [clients.length, fetchClients]);

  useEffect(() => {
    if (saleDefaultClientInitializedRef.current || !clientOptions.length)
      return;
    const defaultClient =
      clientOptions.find(
        (client) => Number(client.id) === PROFORMA_DEFAULT_CONTACT_ID,
      ) ??
      clientOptions.find((client) => client.label.toUpperCase() === "VARIOS") ??
      clientOptions[0];
    if (!defaultClient) return;
    setSaleCustomerInput(defaultClient.label);
    setSaleSettings((prev) => ({
      ...prev,
      clienteId: defaultClient.id,
      customerName: defaultClient.label,
      ...customerFieldsFromClient(defaultClient, prev.docTypeCode),
    }));
    saleDefaultClientInitializedRef.current = true;
  }, [clientOptions, customerFieldsFromClient]);

  const handleSaleDocTypeChange = (docTypeCode: PosDocTypeCode) => {
    setSaleSettings((prev) => {
      const selectedClient =
        clientOptions.find(
          (client) => Number(client.id) === Number(prev.clienteId),
        ) ?? null;
      const documentValue = documentForClient(selectedClient, docTypeCode);
      const isFacturaDoc = docTypeCode === "01";
      const isInvalidFacturaClient =
        isFacturaDoc &&
        (!selectedClient || selectedClient.label.toUpperCase() === "VARIOS");

      return {
        ...prev,
        docTypeCode,
        clienteId: isInvalidFacturaClient ? null : prev.clienteId,
        customerName: isInvalidFacturaClient ? "" : prev.customerName,
        customerId: isInvalidFacturaClient ? "" : documentValue,
        customerRuc: isInvalidFacturaClient ? "" : prev.customerRuc,
        customerDni: isInvalidFacturaClient ? "" : prev.customerDni,
        fiscalAddress: isInvalidFacturaClient ? "" : prev.fiscalAddress,
        shippingAddress: isInvalidFacturaClient ? "" : prev.shippingAddress,
        phone: isInvalidFacturaClient ? "" : prev.phone,
      };
    });
    if (docTypeCode === "01") {
      const currentClient = selectedSaleClientValue;
      if (!currentClient || currentClient.label.toUpperCase() === "VARIOS") {
        setSaleCustomerInput("");
      }
    }
  };

  const validateSaleSettings = () => {
    const customerName = safeTrim(saleSettings.customerName);
    const customerDocument = safeTrim(saleSettings.customerId).replace(
      /\D/g,
      "",
    );
    const discount = saleSettings.applyDiscount
      ? toDecimal(saleSettings.discount)
      : 0;

    if (saleSettings.docTypeCode === "SELECCIONAR") {
      toast.error("Selecciona el tipo de documento.");
      setCartTab("payment");
      return false;
    }

    if (
      !isSaleProforma &&
      !isPaymentMethodAllowedForCompany(saleSettings.paymentMethod)
    ) {
      const method = safeTrim(saleSettings.paymentMethod).toUpperCase();
      const company =
        safeTrim(companyNameFromSession) || `COMPANIA ${companyId}`;
      openDialog({
        title: "AVISO",
        content: (
          <p className="text-sm text-slate-700 uppercase leading-relaxed">
            LA FORMA DE PAGO EN {method} NO TIENE RELACION CON {company}.
            IMPRIMIR O GUARDAR COMO PROFORMA V Y EMITIR LA BOLETA EN LA COMPANIA
            CORRESPONDIENTE.
          </p>
        ),
        confirmText: "Aceptar",
        hideCancelButton: true,
        disableBackdropClose: true,
        onConfirm: () => true,
      });
      setCartTab("payment");
      return false;
    }

    if (
      saleSettings.docTypeCode === "101" &&
      saleSettings.paymentMethod === "TARJETA" &&
      isGenericVariosCustomer(customerName)
    ) {
      toast.error(
        "Para Proforma V con tarjeta ingresa un cliente distinto a VARIOS.",
      );
      setCartTab("payment");
      window.setTimeout(() => saleCustomerInputRef.current?.focus(), 0);
      return false;
    }

    if (isSaleFactura) {
      if (!customerName || isGenericVariosCustomer(customerName)) {
        toast.error("Para factura selecciona un cliente valido.");
        return false;
      }
      if (!selectedSaleClient) {
        toast.error("Para factura debes seleccionar un cliente registrado.");
        return false;
      }
      if (customerDocument.length !== 11) {
        toast.error("Para factura ingresa un RUC valido de 11 digitos.");
        return false;
      }
    }

    if (isSaleBoleta && saleSettings.paymentMethod === "TARJETA") {
      if (!customerName || isGenericVariosCustomer(customerName)) {
        toast.error("Para boleta con tarjeta selecciona un cliente valido.");
        return false;
      }
      if (!selectedSaleClient) {
        toast.error(
          "Para boleta con tarjeta debes seleccionar un cliente registrado.",
        );
        return false;
      }
      if (customerDocument.length !== 8) {
        toast.error(
          "Para boleta con tarjeta ingresa un DNI valido de 8 digitos.",
        );
        return false;
      }
    }

    if (
      !isSaleFactura &&
      !isSaleProforma &&
      customerDocument &&
      customerDocument.length !== 8
    ) {
      toast.error("El DNI debe tener 8 digitos.");
      return false;
    }

    if (discount < 0) {
      toast.error("El descuento no puede ser negativo.");
      return false;
    }
    if (discount > Math.max(0, Number(discountMaxFromSession ?? 0))) {
      toast.error(
        `El descuento no puede superar S/ ${roundCurrency(
          Number(discountMaxFromSession ?? 0),
        ).toFixed(2)}.`,
      );
      return false;
    }

    return true;
  };

  const focusSearchInput = () => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    });
  };

  useEffect(() => {
    if (warehouseModalOpen) {
      warehouseWasOpenRef.current = true;
      window.requestAnimationFrame(() => {
        const input = warehouseSearchInputRef.current;
        if (!input || input.disabled) return;
        input.focus({ preventScroll: true });
        const length = input.value.length;
        input.setSelectionRange(length, length);
      });
      return;
    }

    if (!warehouseWasOpenRef.current) return;
    warehouseWasOpenRef.current = false;
    focusSearchInput();
  }, [warehouseModalOpen]);

  const handleSearchTermInput = (event: FormEvent<HTMLInputElement>) => {
    setSearchTerm(event.currentTarget.value);
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

  useEffect(
    () => () => {
      if (warehouseSearchTimeoutRef.current !== null) {
        window.clearTimeout(warehouseSearchTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const routeState =
      (location.state as {
        preserveCart?: boolean;
        resetCart?: boolean;
        saleSettings?: Partial<PosSaleSettings>;
      } | null) ?? null;
    const restoredSaleSettings = normalizePosSaleSettings(
      routeState?.saleSettings,
    );
    const preserveCart = routeState?.preserveCart === true;
    const resetCart = routeState?.resetCart === true;
    if (resetCart) {
      clearCart();
      clearEditingNota();
      setSaleSettings(DEFAULT_POS_SALE_SETTINGS);
      setSaleCustomerInput(DEFAULT_POS_SALE_SETTINGS.customerName);
      void resetDraftForNewSale();
      return;
    }
    if (restoredSaleSettings) {
      setSaleSettings(restoredSaleSettings);
      setSaleCustomerInput(restoredSaleSettings.customerName);
      setCartTab("payment");
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
      const submitPersonalCode = async () => {
        setDialogLoading(true);
        try {
          const isValid = await validatePersonalCode();
          if (isValid) {
            closeDialog();
          }
        } finally {
          setDialogLoading(false);
        }
      };

      openDialog({
        title: "Validar usuario",
        confirmText: "Validar",
        cancelText: "Cerrar",
        disableBackdropClose: true,
        hideMobileConfirmButton: true,
        mobileActions: <></>,
        content: (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Ingrese su codigo de usuario para confirmar el pago.
            </p>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <PersonalCodeField
                  onInputRef={(node) => {
                    codeInputRef = node;
                  }}
                  onEnter={() => {
                    void submitPersonalCode();
                  }}
                />
              </div>
              <button
                type="button"
                className="h-10 shrink-0 rounded-md bg-blue-600 px-4 text-sm font-semibold uppercase text-white shadow-sm hover:bg-blue-700 lg:hidden"
                onClick={() => {
                  void submitPersonalCode();
                }}
              >
                Validar
              </button>
            </div>
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

  const updateMissingSaleClientContact = async () => {
    if (!selectedSaleClient) return;
    if (safeTrim(selectedSaleClient.label).toUpperCase() === "VARIOS") return;

    const nextShippingAddress = safeTrim(saleSettings.shippingAddress);
    const nextPhone = safeTrim(saleSettings.phone);
    const patch: Partial<typeof selectedSaleClient> = {};

    if (
      !safeTrim(selectedSaleClient.direccionDespacho) &&
      nextShippingAddress
    ) {
      patch.direccionDespacho = nextShippingAddress;
    }
    if (!safeTrim(selectedSaleClient.telefonoMovil) && nextPhone) {
      patch.telefonoMovil = nextPhone;
    }
    if (!Object.keys(patch).length) return;

    const result = await updateClient(selectedSaleClient.id, {
      ...selectedSaleClient,
      ...patch,
    });
    if (!result.ok) {
      toast.error(result.error ?? "No se pudo actualizar el cliente.");
      return;
    }
    await fetchClients("ACTIVO");
  };

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
    const editingNotaIdNumber = Number(editingNotaId);
    const hasEditingNota =
      isEditingMode &&
      Number.isFinite(editingNotaIdNumber) &&
      editingNotaIdNumber > 0;

    if (items.some(hasInvalidQuantityForPayment)) {
      toast.error("La cantidad debe ser mayor a 0.");
      return;
    }

    if (items.some(hasInvalidPriceForPayment)) {
      toast.error("El precio no debe ser menor al precio costo.");
      return;
    }

    if (!validateSaleSettings()) return;

    const authorizedPersonalName =
      await requestPersonalAuthorizationForPayment();
    if (!authorizedPersonalName) return;
    const resolvedPaymentUsername =
      toFirstName(authorizedPersonalName) ||
      toFirstName(usernameFromSession) ||
      "USUARIO";
    const safeCommercialSubtotal = saleCommercialSubtotal;
    const safeDiscount = saleDiscountAmount;
    const safePayTotal = saleTotalAmount;
    const isCashPayment = saleSettings.paymentMethod === "EFECTIVO";
    const isCardPayment = saleSettings.paymentMethod === "TARJETA";
    const selectedClienteId = Number(saleSettings.clienteId ?? 0);
    const clienteId =
      Number.isFinite(selectedClienteId) && selectedClienteId > 0
        ? selectedClienteId
        : PROFORMA_DEFAULT_CONTACT_ID;
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
    const flagMovil = 1;
    const notaFecha = getLocalDateTimeISO();

    const payload = {
      nota: {
        ...(hasEditingNota ? { notaId: editingNotaIdNumber } : {}),
        notaDocu: saleDocConfig.docu,
        notaFecha,
        clienteId,
        notaUsuario: resolvedPaymentUsername,
        notaFormaPago: saleSettings.paymentMethod,
        notaCondicion: "ALCONTADO",
        notaDireccion: safeTrim(saleSettings.shippingAddress),
        notaTelefono: safeTrim(saleSettings.phone),
        notaSubtotal: safeCommercialSubtotal,
        notaMovilidad: saleMovementAmount,
        notaDescuento: safeDiscount,
        notaTotal: safePayTotal,
        notaAcuenta: 0,
        notaSaldo: safePayTotal,
        notaAdicional: saleCardAdditional,
        notaTarjeta: isCardPayment ? safePayTotal : 0,
        notaPagar: safePayTotal,
        notaEstado: saleDocConfig.docu === "BOLETA" ? "EMITIDO" : "PENDIENTE",
        companiaId: companyId,
        notaEntrega: "INMEDIATA",
        notaConcepto: "MERCADERIA",
        notaSerie: saleDocConfig.serie,
        notaNumero: "",
        notaGanancia,
        icbper: 0,
        docuSubtotal: saleTicketSubtotal,
        docuIgv: saleTicketIgv,
        docuAdicional: saleCardAdditional,
        docuGravada: saleTicketGravada,
        docuDescuento: saleTicketDescuento,
        entidadBancaria: shouldShowSaleBankFields
          ? safeTrim(saleSettings.bankEntity)
          : "",
        nroOperacion: shouldShowSaleBankFields
          ? safeTrim(saleSettings.nroOperacion)
          : "",
        efectivo: isCashPayment ? safePayTotal : 0,
        deposito: isCashPayment ? 0 : safePayTotal,
        flagMovil,
        ...(hasEditingNota
          ? {
              modificadoPor: resolvedPaymentUsername,
              fechaEdita: new Date().toISOString(),
            }
          : {}),
      },
      detalles: safeItems.map((item) => ({
        detalleId: Number(item.detalleId ?? 0),
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
        detalleEstado:
          saleDocConfig.docu === "BOLETA" ? "EMITIDO" : "PENDIENTE",
        valorUM:
          Number.isFinite(Number(item.valorUM ?? 1)) &&
          Number(item.valorUM ?? 1) > 0
            ? Number(item.valorUM ?? 1)
            : 1,
      })),
    };

    setIsSubmittingQuickSale(true);
    try {
      await updateMissingSaleClientContact();
      const result = await apiRequest({
        url: buildApiUrl(
          hasEditingNota ? "/Nota/editarOrden" : "/Nota/register-with-detail",
        ),
        method: hasEditingNota ? "PUT" : "POST",
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
        toast.error(
          resolveApiMessage(result) ||
            (hasEditingNota
              ? "No se pudo actualizar el pedido"
              : "Fallo la creacion de pedido"),
        );
        return;
      }

      if (hasEditingNota) {
        setServerItemsInStore(safeItems);
        toast.success("Pedido actualizado");
        const paymentQuery = isSaleFactura
          ? "mode=view"
          : "mode=view&autoprint=1";
        navigate(`${paymentBasePath}/${editingNotaIdNumber}?${paymentQuery}`);
        return;
      }

      const createdNotaId = parseNotaId(result);
      toast.success("Pedido registrado");
      if (createdNotaId) {
        const paymentQuery = isSaleFactura
          ? "mode=view"
          : "mode=view&autoprint=1";
        navigate(`${paymentBasePath}/${createdNotaId}?${paymentQuery}`);
        window.setTimeout(() => {
          clearCart();
          clearEditingNota();
          setPriceDrafts({});
          setCartPriceMode("A");
          setQuantityDrafts({});
          void resetDraftForNewSale();
        }, 0);
        return;
      }
      clearCart();
      clearEditingNota();
      setPriceDrafts({});
      setCartPriceMode("A");
      setQuantityDrafts({});
      setMobileCartOpen(false);
      await resetDraftForNewSale();
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
    if (items.length === 0) {
      toast.info("No ha seleccionado ningun item.");
      return;
    }
    setCartTab("products");
    setMobileCartOpen(true);
  };

  const handleWarehouseSearchChange = (value: string) => {
    if (warehouseLastSearchValueRef.current === value) return;
    warehouseLastSearchValueRef.current = value;
    setWarehouseSearch(value);
    setWarehousePage(1);

    if (warehouseSearchTimeoutRef.current !== null) {
      window.clearTimeout(warehouseSearchTimeoutRef.current);
    }

    warehouseSearchTimeoutRef.current = window.setTimeout(() => {
      void fetchWarehouseProducts({
        busqueda: value,
        pagina: 1,
      });
      warehouseSearchTimeoutRef.current = null;
    }, 250);
  };

  const openWarehouseProducts = () => {
    const initialSearch = searchTerm.trim();
    setWarehouseModalOpen(true);
    setWarehouseSearch(initialSearch);
    warehouseLastSearchValueRef.current = initialSearch;
    setWarehousePage(1);
    void fetchWarehouseProducts({
      busqueda: initialSearch,
      pagina: 1,
    });
  };

  const closeWarehouseProducts = () => {
    if (warehouseSearchTimeoutRef.current !== null) {
      window.clearTimeout(warehouseSearchTimeoutRef.current);
      warehouseSearchTimeoutRef.current = null;
    }
    warehouseLastSearchValueRef.current = "";
    setWarehouseSearch("");
    setWarehousePage(1);
    setWarehouseModalOpen(false);
  };

  const searchWarehouseProducts = () => {
    const query = warehouseSearchInputRef.current?.value ?? warehouseSearch;
    warehouseLastSearchValueRef.current = query;
    if (warehouseSearchTimeoutRef.current !== null) {
      window.clearTimeout(warehouseSearchTimeoutRef.current);
      warehouseSearchTimeoutRef.current = null;
    }
    setWarehouseSearch(query);
    setWarehousePage(1);
    void fetchWarehouseProducts({
      busqueda: query,
      pagina: 1,
    });
  };

  const changeWarehousePage = (nextPage: number) => {
    const page = Math.max(1, nextPage);
    setWarehousePage(page);
    void fetchWarehouseProducts({
      busqueda: warehouseSearch,
      pagina: page,
    });
  };

  const openWarehouseImage = (item: (typeof warehouseProducts)[number]) => {
    const src = resolvePosImageSrc(item.productoImagen);
    if (!src) {
      toast.error("Este producto no tiene imagen.");
      return;
    }
    setWarehouseImagePreview({
      src,
      title: item.descripcion || item.productoNombre || item.productoCodigo,
    });
  };

  const confirmStockInquiry = (
    product: Pick<
      PosCatalogProduct,
      | "id"
      | "baseProductId"
      | "codigo"
      | "nombre"
      | "productoMarca"
      | "unidadMedida"
      | "cantidad"
    >,
    requestedQty: number,
    onConfirm?: () => void,
    onCancel?: () => void,
  ) => {
    openDialog({
      title: "Sin stock suficiente",
      content: (
        <p className="text-sm text-slate-700">
          No hay stock suficiente. ¿Desea consultar al almacén?
        </p>
      ),
      confirmText: "Consultar",
      cancelText: "Ignorar",
      onConfirm: () => {
        onConfirm?.();
        void openStockInquiry(product, requestedQty);
        focusSearchInput();
      },
      onCancel,
    });
  };

  const handleAddProduct = (product: PosCatalogProduct) => {
    const productForCart = {
      ...product,
      preVenta: productPrice(product, priceMode),
      precioA: productPrice(product, "A") || undefined,
      precioB: priceBValue(product) || undefined,
    };
    const available = Number(product.cantidad ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      confirmStockInquiry(product, 1, () => {
        addProduct(productForCart, 1);
        setCartTab("products");
      });
      return;
    }

    addProduct(productForCart, 1);
    setCartTab("products");
    if (1 > available) confirmStockInquiry(product, 1);

    focusSearchInput();
  };

  const openStockInquiry = async (
    product: Pick<
      PosCatalogProduct,
      | "id"
      | "baseProductId"
      | "codigo"
      | "nombre"
      | "productoMarca"
      | "unidadMedida"
      | "cantidad"
    >,
    requestedQty: number,
  ) => {
    const storeStock = Math.max(0, toDecimal(product.cantidad));
    const missingQty = Math.max(0, requestedQty - storeStock);
    const productName = composeProductDisplayName(
      product.nombre,
      product.productoMarca,
    );

    setStockInquiry({
      productName,
      productCode: product.codigo,
      unit: product.unidadMedida || "UNIDAD",
      storeStock,
      requestedQty,
      missingQty,
      rows: [],
      loading: true,
    });

    const response = await apiRequest<
      StockWarehousesResponse,
      null,
      StockWarehousesResponse
    >({
      url: buildApiUrl(
        `/Productos/${Number(product.baseProductId ?? product.id)}/stock-almacenes?cantidad=${encodeURIComponent(
          String(requestedQty),
        )}&unidad=${encodeURIComponent(product.unidadMedida || "")}`,
      ),
      method: "GET",
      fallback: { items: [] },
    });
    const nextStoreStock = toDecimal(response.stockTienda ?? storeStock);
    const nextRequestedQty = toDecimal(response.cantidadPedido ?? requestedQty);
    const nextMissingQty = Math.max(
      0,
      toDecimal(response.faltaCompletar ?? missingQty),
    );
    const unit = normalizeUnitLabel(product.unidadMedida);
    const rows = (response.items ?? [])
      .map((item): StockWarehouseRow => {
        const stock = Math.max(0, toDecimal(item.stock));
        return {
          almacenNombre: safeTrim(item.almacenNombre) || "ALMACEN",
          cantidad: Math.max(
            0,
            toDecimal(item.cantidad) || Math.min(nextMissingQty, stock),
          ),
          stock,
          unidadMedida:
            safeTrim(item.unidadMedida) || product.unidadMedida || "UNIDAD",
        };
      })
      .filter((row) => row.stock > 0)
      .filter((row) => !unit || normalizeUnitLabel(row.unidadMedida) === unit);

    setStockInquiry((current) =>
      current && current.productCode === product.codigo
        ? {
            ...current,
            storeStock: nextStoreStock,
            requestedQty: nextRequestedQty,
            missingQty: nextMissingQty,
            rows,
            loading: false,
          }
        : current,
    );
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
        const variationImage = resolvePosImageSrc(variation.unidadImagen);
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
  const getCartItemPriceB = (item: PosCartItem) => {
    const savedPriceB = priceBValue(item);
    if (savedPriceB > 0) return savedPriceB;
    const itemKey = getCartItemKey(item);
    const catalogProduct = catalogProducts.find(
      (product) =>
        (Number(product.detalleId ?? 0) || Number(product.id ?? 0)) === itemKey,
    );
    return catalogProduct ? priceBValue(catalogProduct) : 0;
  };
  const getCartItemPriceA = (item: PosCartItem) => {
    const savedPriceA = priceAValue(item);
    if (savedPriceA > 0) return savedPriceA;
    const itemKey = getCartItemKey(item);
    const catalogProduct = catalogProducts.find(
      (product) =>
        (Number(product.detalleId ?? 0) || Number(product.id ?? 0)) === itemKey,
    );
    return catalogProduct ? productPrice(catalogProduct, "A") : 0;
  };

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
    if (desired > Math.max(0, Number(item.stock ?? 0))) {
      confirmStockInquiry(
        {
          id: item.productId,
          codigo: item.codigo,
          nombre: item.nombre,
          productoMarca: item.productoMarca,
          unidadMedida: item.unidadMedida ?? "UNIDAD",
          cantidad: item.stock ?? 0,
        },
        desired,
        undefined,
        () => clearCartItemQuantity(itemKey),
      );
    }
  };

  function clearCartItemQuantity(itemKey: number) {
    updateQuantity(itemKey, 0);
    setQuantityDrafts((prev) => {
      if (!(itemKey in prev)) return prev;
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
  }

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
      const desired = Math.max(0, parsed);
      updateQuantity(itemKey, desired);
      if (desired > Math.max(0, Number(item.stock ?? 0))) {
        confirmStockInquiry(
          {
            id: item.productId,
            codigo: item.codigo,
            nombre: item.nombre,
            productoMarca: item.productoMarca,
            unidadMedida: item.unidadMedida ?? "UNIDAD",
            cantidad: item.stock ?? 0,
          },
          desired,
          undefined,
          () => clearCartItemQuantity(itemKey),
        );
      }
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

  const handleToggleCartPrice = (item: PosCartItem) => {
    const priceA = getCartItemPriceA(item);
    const priceB = getCartItemPriceB(item);
    const nextPrice = samePrice(item.precio, priceB) ? priceA : priceB;
    if (nextPrice <= 0) return;
    const itemKey = getCartItemKey(item);
    const safePrice = roundPrice(Math.max(nextPrice, getMinAllowedPrice(item)));
    updatePrice(itemKey, safePrice);
    setPriceDrafts((prev) => ({ ...prev, [itemKey]: safePrice.toFixed(2) }));
  };

  const applyCartPriceMode = (mode: PosPriceMode) => {
    if (!items.length) return;
    let changed = 0;
    const nextDrafts: Record<number, string> = {};

    items.forEach((item) => {
      const nextPrice =
        mode === "A" ? getCartItemPriceA(item) : getCartItemPriceB(item);
      if (nextPrice <= 0) return;
      const itemKey = getCartItemKey(item);
      const safePrice = roundPrice(
        Math.max(nextPrice, getMinAllowedPrice(item)),
      );
      updatePrice(itemKey, safePrice);
      nextDrafts[itemKey] = safePrice.toFixed(2);
      changed += 1;
    });

    setCartPriceMode(mode);
    setCartTab("products");
    if (window.matchMedia("(max-width: 1279px)").matches) {
      setMobileCartOpen(true);
    }
    if (changed) setPriceDrafts((prev) => ({ ...prev, ...nextDrafts }));
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
        setSaleSettings(DEFAULT_POS_SALE_SETTINGS);
        setSaleCustomerInput(DEFAULT_POS_SALE_SETTINGS.customerName);
        setCartPriceMode("A");
        setCartTab("products");
        setMobileCartOpen(false);
        setViewMode("cards");
        window.setTimeout(focusSearchInput, 0);
      },
      confirmText: "Vaciar",
      cancelText: "Cancelar",
    });

  const handleNewSaleFromPos = () => {
    clearCart();
    clearEditingNota();
    setSaleSettings(DEFAULT_POS_SALE_SETTINGS);
    setSaleCustomerInput(DEFAULT_POS_SALE_SETTINGS.customerName);
    setCartPriceMode("A");
    setCartTab("products");
    setMobileCartOpen(false);
    setViewMode("cards");
    void resetDraftForNewSale();
    window.setTimeout(focusSearchInput, 0);
  };

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
      header: () => (
        <span className="whitespace-nowrap">P. Venta {priceMode} S/</span>
      ),
      cell: ({ row }) => (
        <span className="font-semibold text-right block">
          {priceLabel(row.original, priceMode)}
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
      className={`bg-white rounded-xl shadow p-4 md:p-6 xl:p-4 flex flex-col ${mobile ? "h-full" : ""}`}
    >
      <div className="order-2 mb-3 flex gap-2">
        <div className="grid flex-1 grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              cartTab === "payment"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-600 hover:bg-white"
            }`}
            onClick={() => setCartTab("payment")}
          >
            Pago
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              cartTab === "products"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-600 hover:bg-white"
            }`}
            onClick={() => setCartTab("products")}
          >
            Productos
          </button>
        </div>
        {isEditingMode && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmittingQuickSale}
            onClick={handleNewSaleFromPos}
            title="Nuevo registro"
          >
            Nuevo registro
          </button>
        )}
        {cartTab === "payment" ? (
          <button
            type="button"
            className={`${mobile ? "hidden" : "inline-flex"} shrink-0 items-center justify-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!items.length || isSubmittingQuickSale}
            onClick={goToPayment}
            title="Confirmar"
          >
            {isSubmittingQuickSale ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Confirmar
          </button>
        ) : (
          <button
            type="button"
            className={`${mobile ? "hidden" : "inline-flex"} shrink-0 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!items.length || isSubmittingQuickSale}
            onClick={confirmClear}
            title="Vaciar carrito"
          >
            <Trash2 className="h-4 w-4" />
            Vaciar
          </button>
        )}
      </div>

      <div
        className={`order-4 mt-3 space-y-3 overflow-y-auto pr-1 ${
          cartTab !== "products" ? "hidden" : ""
        } ${
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
          const stockValue = Number(item.stock ?? 0);
          const isStockNegative =
            item.stock !== undefined &&
            (stockValue < 0 || Number(item.cantidad ?? 0) > stockValue);
          const minPrice = getMinAllowedPrice(item);
          const itemPriceA = getCartItemPriceA(item);
          const itemPriceB = getCartItemPriceB(item);
          const currentPriceMode = samePrice(item.precio, itemPriceB)
            ? "B"
            : samePrice(item.precio, itemPriceA)
              ? "A"
              : "Manual";
          const nextPriceMode = currentPriceMode === "B" ? "A" : "B";
          const nextModePrice = nextPriceMode === "A" ? itemPriceA : itemPriceB;
          const highlightClass =
            isZeroOrNegative || isStockNegative
              ? "border-red-200 bg-red-50"
              : "border-slate-200 bg-gray-50";

          return (
            <article
              key={getCartItemKey(item)}
              className={`border rounded-lg p-3 hover:border-slate-300 transition-colors md:p-5 xl:p-3 ${highlightClass}`}
            >
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800 md:text-lg xl:text-sm">
                    {composeProductDisplayName(item.nombre, item.productoMarca)}
                  </p>
                  <p className="text-xs text-gray-500 md:text-sm xl:text-xs">
                    {item.unidadMedida ?? "UND"}
                  </p>
                  {item.stock !== undefined && (
                    <p className="text-xs text-gray-500 md:text-sm xl:text-xs">
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
                  <button
                    type="button"
                    className="mt-1 text-left text-xs font-semibold text-blue-700 hover:text-blue-900 md:text-sm xl:text-xs"
                    onClick={() =>
                      void openStockInquiry(
                        {
                          id: item.productId,
                          codigo: item.codigo,
                          nombre: item.nombre,
                          productoMarca: item.productoMarca,
                          unidadMedida: item.unidadMedida ?? "UNIDAD",
                          cantidad: item.stock ?? 0,
                        },
                        Number(item.cantidad ?? 0),
                      )
                    }
                  >
                    Consultar almacenes
                  </button>
                </div>

                <div className="w-32 text-right md:w-40 xl:w-32">
                  <label className="block text-left text-xs text-gray-500 md:text-sm xl:text-xs">
                    P. Unitario
                  </label>

                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-sm text-gray-500 md:text-base xl:text-sm">
                      S/
                    </span>
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
                      className="w-full rounded-md border px-2 py-1 text-right text-sm md:py-2 md:text-lg xl:py-1 xl:text-sm"
                    />
                  </div>
                  {(itemPriceA > 0 || itemPriceB > 0) && (
                    <div className="mt-1 space-y-1 text-left">
                      <p className="text-[11px] font-medium text-slate-500">
                        Actual: {currentPriceMode}
                      </p>
                      {nextModePrice > 0 && (
                        <button
                          type="button"
                          className="w-full rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          onClick={() => handleToggleCartPrice(item)}
                        >
                          Cambiar a {nextPriceMode} S/{" "}
                          {formatPrice(nextModePrice)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    className="rounded border bg-white p-1 hover:bg-slate-50 md:p-2 xl:p-1"
                    onClick={() => handleQuantityChange(item, -1)}
                  >
                    <Minus className="h-4 w-4 md:h-5 md:w-5 xl:h-4 xl:w-4" />
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
                    className="w-16 rounded-md border py-1 text-center md:w-20 md:py-2 md:text-lg xl:w-16 xl:py-1 xl:text-base"
                  />
                  <button
                    className="rounded border bg-white p-1 hover:bg-slate-50 md:p-2 xl:p-1"
                    onClick={() => handleQuantityChange(item, 1)}
                  >
                    <Plus className="h-4 w-4 md:h-5 md:w-5 xl:h-4 xl:w-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 md:text-sm xl:text-xs">
                      Subtotal
                    </p>
                    <p
                      className={`text-base font-semibold md:text-xl xl:text-base ${
                        isZeroOrNegative ? "text-red-600" : "text-slate-800"
                      }`}
                    >
                      S/ {(item.precio * item.cantidad).toFixed(2)}
                    </p>
                  </div>
                  <button
                    className="rounded bg-red-50 p-2 text-red-600 hover:bg-red-100 md:p-3 xl:p-2"
                    onClick={() => removeItem(getCartItemKey(item))}
                    title="Quitar"
                  >
                    <Trash2 className="h-4 w-4 md:h-5 md:w-5 xl:h-4 xl:w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <button
        className={`order-4 mt-3 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-white transition-colors hover:bg-emerald-600 disabled:opacity-50 md:py-3 md:text-lg xl:py-2.5 xl:text-base ${
          cartTab === "products" ? "inline-flex" : "hidden"
        }`}
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

      <div
        className={`order-3 mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 ${
          cartTab !== "payment" ? "hidden" : ""
        } ${mobile ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Datos de venta
            </p>
            <p className="text-xs text-slate-500">Se enviarán listos a pago</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={openSaleCustomerDialog}
          >
            <Plus className="h-3.5 w-3.5" />
            Cliente
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <TextField
            fullWidth
            select
            variant="outlined"
            size="small"
            label="Tipo de documento"
            InputLabelProps={{ shrink: true }}
            SelectProps={{ displayEmpty: true }}
            inputRef={saleDocTypeInputRef}
            value={saleSettings.docTypeCode}
            onChange={(event) => {
              const nextDocType = event.target.value as PosDocTypeCode;
              handleSaleDocTypeChange(nextDocType);
              focusSaleField(salePaymentMethodInputRef);
            }}
            onKeyDown={handleSaleEnterFocus(salePaymentMethodInputRef)}
            sx={POS_PAYMENT_TEXT_FIELD_SX}
          >
            {POS_DOC_TYPE_OPTIONS.map((value) => (
              <MenuItem key={value} value={value}>
                {POS_DOC_TYPE_CONFIG[value].label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            select
            variant="outlined"
            size="small"
            label="Forma de pago"
            InputLabelProps={{ shrink: true }}
            SelectProps={{ displayEmpty: true }}
            inputRef={salePaymentMethodInputRef}
            value={saleSettings.paymentMethod}
            onChange={(event) => {
              setSaleSettings((prev) => ({
                ...prev,
                paymentMethod: event.target.value as PosPaymentMethod,
              }));
              focusSaleField(saleCustomerInputRef);
            }}
            onKeyDown={handleSaleEnterFocus(saleCustomerInputRef)}
            sx={POS_PAYMENT_TEXT_FIELD_SX}
          >
            {POS_PAYMENT_METHODS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Autocomplete
            className="col-span-full"
            fullWidth
            size="small"
            loading={clientsLoading}
            loadingText="Cargando clientes..."
            options={saleClientOptions}
            value={selectedSaleClientValue}
            inputValue={saleCustomerInput}
            getOptionLabel={(option) => option?.label ?? ""}
            isOptionEqualToValue={(option, value) =>
              Number(option.id) === Number(value.id)
            }
            filterOptions={(options, state) =>
              filterSaleClientOptions(options, state.inputValue)
            }
            onInputChange={(_, value, reason) => {
              if (reason === "reset") return;
              applySaleCustomerInput(value);
            }}
            onBlur={() => ensureExistingSaleCustomer(saleCustomerInput)}
            onChange={(_, client) => {
              if (!client) {
                setSaleCustomerInput("");
                setSaleSettings((prev) => ({
                  ...prev,
                  clienteId: null,
                  customerName: "",
                  customerId: "",
                  customerRuc: "",
                  customerDni: "",
                  fiscalAddress: "",
                  shippingAddress: "",
                  phone: "",
                }));
                return;
              }
              selectSaleClientOption(client);
            }}
            renderInput={(params) => {
              const inputProps =
                params.inputProps as InputHTMLAttributes<HTMLInputElement>;
              return (
                <TextField
                  {...params}
                  variant="outlined"
                  label="Nombre del cliente"
                  placeholder="Seleccionar cliente"
                  sx={POS_PAYMENT_TEXT_FIELD_SX}
                  inputRef={saleCustomerInputRef}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {clientsLoading ? (
                          <CircularProgress color="inherit" size={16} />
                        ) : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  inputProps={{
                    ...params.inputProps,
                    name: "pos-sale-customer-name-autocomplete",
                    "data-no-history-guard": "true",
                    "data-no-uppercase": "true",
                    "data-auto-next": "true",
                    autoComplete: "one-time-code",
                    autoCorrect: "off",
                    autoCapitalize: "off",
                    spellCheck: false,
                    "aria-autocomplete": "none",
                    "data-lpignore": "true",
                    "data-1p-ignore": "true",
                    "data-bwignore": "true",
                    "data-form-type": "other",
                    "data-autocomplete": "off",
                    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                      inputProps.onKeyDown?.(event);
                      if (
                        !event.defaultPrevented &&
                        !(event as MuiInputKeyboardEvent).defaultMuiPrevented
                      ) {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          selectOnlySaleClientMatch(event.currentTarget.value)
                        ) {
                          event.preventDefault();
                          return;
                        }
                        handleSaleEnterFocus(
                          nextSaleAfterCustomerRef,
                          true,
                        )(event);
                      }
                    },
                  }}
                />
              );
            }}
          />

          <>
            <Autocomplete
              fullWidth
              size="small"
              loading={clientsLoading}
              loadingText="Cargando clientes..."
              options={saleDniOptions}
              value={
                saleDniOptions.find(
                  (option) => option.value === saleSettings.customerDni,
                ) ?? null
              }
              inputValue={saleSettings.customerDni}
              getOptionLabel={(option) =>
                typeof option === "string" ? option : option.label
              }
              isOptionEqualToValue={(option, value) =>
                option.value === value.value
              }
              filterOptions={(options, state) =>
                filterSaleDocumentOptions(options, state.inputValue)
              }
              renderOption={(props, option) =>
                renderSaleDocumentOption("dni", props, option)
              }
              onInputChange={(_, value, reason) => {
                if (reason === "reset") return;
                const numericValue = value.replace(/\D/g, "");
                setSaleSettings((prev) => ({
                  ...prev,
                  customerDni: numericValue,
                  customerId:
                    prev.docTypeCode === "01" ? prev.customerRuc : numericValue,
                  clienteId: null,
                }));
              }}
              onChange={(_, option) => {
                if (!option) return;
                selectSaleDocumentOption("dni", option);
              }}
              onBlur={() =>
                ensureExistingSaleDocument(
                  "dni",
                  saleDniInputRef.current?.value ?? saleSettings.customerDni,
                )
              }
              renderInput={(params) => {
                const inputProps =
                  params.inputProps as InputHTMLAttributes<HTMLInputElement>;
                return (
                  <TextField
                    {...params}
                    variant="outlined"
                    label="DNI"
                    placeholder="Número de DNI"
                    sx={POS_PAYMENT_TEXT_FIELD_SX}
                    inputRef={saleDniInputRef}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {clientsLoading ? (
                            <CircularProgress color="inherit" size={16} />
                          ) : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                    inputProps={{
                      ...params.inputProps,
                      "data-no-uppercase": "true",
                      "data-auto-next": "true",
                      inputMode: "numeric",
                      pattern: "[0-9]*",
                      autoComplete: "one-time-code",
                      autoCorrect: "off",
                      autoCapitalize: "off",
                      spellCheck: false,
                      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                        inputProps.onKeyDown?.(event);
                        if (
                          !event.defaultPrevented &&
                          !(event as MuiInputKeyboardEvent).defaultMuiPrevented
                        ) {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            selectOnlySaleDocumentMatch(
                              "dni",
                              event.currentTarget.value,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          handleSaleEnterFocus(saleRucInputRef, true)(event);
                        }
                      },
                    }}
                  />
                );
              }}
            />

            <Autocomplete
              fullWidth
              size="small"
              loading={clientsLoading}
              loadingText="Cargando clientes..."
              options={saleRucOptions}
              value={
                saleRucOptions.find(
                  (option) => option.value === saleSettings.customerRuc,
                ) ?? null
              }
              inputValue={saleSettings.customerRuc}
              getOptionLabel={(option) =>
                typeof option === "string" ? option : option.label
              }
              isOptionEqualToValue={(option, value) =>
                option.value === value.value
              }
              filterOptions={(options, state) =>
                filterSaleDocumentOptions(options, state.inputValue)
              }
              renderOption={(props, option) =>
                renderSaleDocumentOption("ruc", props, option)
              }
              onInputChange={(_, value, reason) => {
                if (reason === "reset") return;
                const numericValue = value.replace(/\D/g, "");
                setSaleSettings((prev) => ({
                  ...prev,
                  customerRuc: numericValue,
                  customerId:
                    prev.docTypeCode === "01" ? numericValue : prev.customerDni,
                  clienteId: null,
                }));
              }}
              onChange={(_, option) => {
                if (!option) return;
                selectSaleDocumentOption("ruc", option);
              }}
              onBlur={() =>
                ensureExistingSaleDocument(
                  "ruc",
                  saleRucInputRef.current?.value ?? saleSettings.customerRuc,
                )
              }
              renderInput={(params) => {
                const inputProps =
                  params.inputProps as InputHTMLAttributes<HTMLInputElement>;
                return (
                  <TextField
                    {...params}
                    variant="outlined"
                    label="RUC"
                    placeholder="Número de RUC"
                    sx={POS_PAYMENT_TEXT_FIELD_SX}
                    inputRef={saleRucInputRef}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {clientsLoading ? (
                            <CircularProgress color="inherit" size={16} />
                          ) : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                    inputProps={{
                      ...params.inputProps,
                      "data-no-uppercase": "true",
                      "data-auto-next": "true",
                      inputMode: "numeric",
                      pattern: "[0-9]*",
                      autoComplete: "one-time-code",
                      autoCorrect: "off",
                      autoCapitalize: "off",
                      spellCheck: false,
                      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                        inputProps.onKeyDown?.(event);
                        if (
                          !event.defaultPrevented &&
                          !(event as MuiInputKeyboardEvent).defaultMuiPrevented
                        ) {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            selectOnlySaleDocumentMatch(
                              "ruc",
                              event.currentTarget.value,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          handleSaleEnterFocus(saleFiscalAddressInputRef)(
                            event,
                          );
                        }
                      },
                    }}
                  />
                );
              }}
            />
          </>

          <TextField
            className="col-span-full"
            fullWidth
            variant="outlined"
            size="small"
            label="Dirección fiscal"
            multiline
            minRows={2}
            value={saleSettings.fiscalAddress}
            InputLabelProps={{ shrink: true }}
            InputProps={{ readOnly: true }}
            inputRef={saleFiscalAddressInputRef}
            onKeyDown={handleSaleEnterFocus(saleShippingAddressInputRef)}
            onChange={(event) =>
              setSaleSettings((prev) => ({
                ...prev,
                fiscalAddress: event.target.value,
              }))
            }
            sx={POS_PAYMENT_TEXT_FIELD_SX}
          />

          <TextField
            fullWidth
            variant="outlined"
            className="col-span-full"
            size="small"
            label="Dirección despacho"
            multiline
            minRows={2}
            value={saleSettings.shippingAddress}
            InputLabelProps={{ shrink: true }}
            inputRef={saleShippingAddressInputRef}
            onKeyDown={handleSaleEnterFocus(salePhoneInputRef)}
            onChange={(event) =>
              setSaleSettings((prev) => ({
                ...prev,
                shippingAddress: event.target.value,
              }))
            }
            sx={POS_PAYMENT_TEXT_FIELD_SX}
          />

          <TextField
            fullWidth
            variant="outlined"
            className="col-span-full"
            size="small"
            label="Teléfono/Cel."
            value={saleSettings.phone}
            inputRef={salePhoneInputRef}
            onKeyDown={handleSaleEnterFocus(nextSaleAfterPhoneRef, true)}
            onChange={(event) =>
              setSaleSettings((prev) => ({
                ...prev,
                phone: event.target.value,
              }))
            }
            sx={POS_PAYMENT_TEXT_FIELD_SX}
          />

          {shouldShowSaleBankFields && (
            <>
              <TextField
                fullWidth
                select
                variant="outlined"
                size="small"
                label="Entidad bancaria"
                InputLabelProps={{ shrink: true }}
                SelectProps={{ displayEmpty: true }}
                inputRef={saleBankEntityInputRef}
                value={saleSettings.bankEntity}
                onChange={(event) => {
                  setSaleSettings((prev) => ({
                    ...prev,
                    bankEntity: event.target.value,
                  }));
                  focusSaleField(saleOperationInputRef, true);
                }}
                onKeyDown={handleSaleEnterFocus(saleOperationInputRef, true)}
                sx={POS_PAYMENT_TEXT_FIELD_SX}
              >
                <MenuItem value="-">-</MenuItem>
                <MenuItem value="BCP">BCP</MenuItem>
                <MenuItem value="INTERBANK">INTERBANK</MenuItem>
                <MenuItem value="CONTINENTAL">CONTINENTAL</MenuItem>
              </TextField>

              <TextField
                fullWidth
                variant="outlined"
                size="small"
                label="N° Operación"
                value={saleSettings.nroOperacion}
                inputRef={saleOperationInputRef}
                onKeyDown={handleSaleEnterFocus(saleMovementCostInputRef, true)}
                onChange={(event) =>
                  setSaleSettings((prev) => ({
                    ...prev,
                    nroOperacion: event.target.value,
                  }))
                }
                sx={POS_PAYMENT_TEXT_FIELD_SX}
              />
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-slate-700"
              checked={saleSettings.applyDiscount}
              onChange={(event) => {
                const checked = event.target.checked;
                setSaleSettings((prev) => ({
                  ...prev,
                  applyDiscount: checked,
                  discount: checked ? prev.discount : "",
                }));
                if (checked) focusSaleField(saleDiscountInputRef, true);
              }}
            />
            Aplica descuento
          </label>
          <div className="relative ml-auto w-36">
            <TextField
              type="number"
              variant="outlined"
              size="small"
              label="Movilidad"
              value={saleSettings.movementCost}
              inputRef={saleMovementCostInputRef}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">S/</InputAdornment>
                ),
              }}
              inputProps={{
                min: 0,
                max: roundCurrency(discountMaxFromSession),
                step: "0.01",
              }}
              onChange={(event) =>
                setSaleSettings((prev) => ({
                  ...prev,
                  movementCost: event.target.value,
                }))
              }
              onKeyDown={handleSaleEnterFocus(nextSaleAfterMovementRef, true)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => {
                if (event.currentTarget.value.trim() === "") {
                  setSaleSettings((prev) => ({ ...prev, movementCost: "" }));
                  return;
                }
                const normalized = roundCurrency(
                  Math.max(0, toDecimal(event.currentTarget.value)),
                );
                setSaleSettings((prev) => ({
                  ...prev,
                  movementCost: String(normalized),
                }));
              }}
              sx={{
                ...POS_PAYMENT_TEXT_FIELD_SX,
                "& input[type=number]": {
                  MozAppearance: "textfield",
                  textAlign: "right",
                },
                "& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
                  {
                    WebkitAppearance: "none",
                    margin: 0,
                  },
              }}
            />
          </div>
          {saleSettings.applyDiscount && (
            <div className="relative w-36">
              <TextField
                type="number"
                variant="outlined"
                size="small"
                label="Descuento"
                value={saleSettings.discount}
                inputRef={saleDiscountInputRef}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">S/</InputAdornment>
                  ),
                }}
                inputProps={{
                  min: 0,
                  max: roundCurrency(discountMaxFromSession),
                  step: "0.01",
                }}
                onChange={(event) =>
                  setSaleSettings((prev) => ({
                    ...prev,
                    discount: event.target.value,
                  }))
                }
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => {
                  if (event.currentTarget.value.trim() === "") {
                    setSaleSettings((prev) => ({ ...prev, discount: "" }));
                    return;
                  }
                  const clamped = roundCurrency(
                    Math.min(
                      Math.max(0, toDecimal(event.currentTarget.value)),
                      Math.max(0, Number(discountMaxFromSession ?? 0)),
                      Math.max(0, Number(totals.total ?? 0)),
                    ),
                  );
                  setSaleSettings((prev) => ({
                    ...prev,
                    discount: String(clamped),
                  }));
                }}
                sx={{
                  ...POS_PAYMENT_TEXT_FIELD_SX,
                  "& input[type=number]": {
                    MozAppearance: "textfield",
                    textAlign: "right",
                  },
                  "& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
                    {
                      WebkitAppearance: "none",
                      margin: 0,
                    },
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div
        className={`order-5 mt-4 border-t pt-3 space-y-2 ${
          cartTab !== "payment" ? "hidden" : ""
        }`}
      >
        <div className="flex justify-between text-sm text-gray-700 md:text-lg xl:text-sm">
          <span>Op. gravada</span>
          <span className="font-semibold">
            S/ {saleDisplayOperacionGravada.toFixed(2)}
          </span>
        </div>
        {saleSettings.paymentMethod === "TARJETA" && (
          <div className="flex justify-between text-sm text-gray-700 md:text-lg xl:text-sm">
            <span>
              Adicional {roundCurrency(cardPercentageFromSession).toFixed(2)}%
            </span>
            <span className="font-semibold">
              S/ {saleCardAdditional.toFixed(2)}
            </span>
          </div>
        )}
        {saleMovementAmount > 0 && (
          <div className="flex justify-between text-sm text-rose-700 md:text-lg xl:text-sm">
            <span>Movilidad</span>
            <span className="font-semibold">
              S/ {saleMovementAmount.toFixed(2)}
            </span>
          </div>
        )}
        {saleDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-rose-700 md:text-lg xl:text-sm">
            <span>Descuento</span>
            <span className="font-semibold">
              - S/ {saleDiscountAmount.toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm text-gray-700 md:text-lg xl:text-sm">
          <span>Sub total</span>
          <span className="font-semibold">
            S/ {saleDisplaySubtotal.toFixed(2)}
          </span>
        </div>
        {saleDisplayIgv > 0 && (
          <div className="flex justify-between text-sm text-gray-700 md:text-lg xl:text-sm">
            <span>IGV (18%)</span>
            <span className="font-semibold">
              S/ {saleDisplayIgv.toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-slate-800 md:text-xl xl:text-base">
          <span>Total pago</span>
          <span>S/ {saleTotalAmount.toFixed(2)}</span>
        </div>
        <button
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-white transition-colors hover:bg-emerald-600 disabled:opacity-50 md:py-3 md:text-lg xl:py-2.5 xl:text-base"
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
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                onClick={openWarehouseProducts}
                title="Ver productos de almacén"
              >
                <Warehouse className="w-4 h-4" />
                Almacén
              </button>
              <button
                type="button"
                className={`inline-flex items-center rounded-lg border px-3 py-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  cartPriceMode === "B"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() =>
                  applyCartPriceMode(cartPriceMode === "A" ? "B" : "A")
                }
                disabled={!items.length}
                title={`Cambiar carrito a precio ${
                  cartPriceMode === "A" ? "B" : "A"
                }`}
              >
                Carrito a precio {cartPriceMode === "A" ? "B" : "A"}
              </button>
            </div>
            <button
              type="button"
              className="fixed right-3 top-[calc(var(--app-shell-header-h)+2.25rem)] z-30 flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white shadow-lg xl:static xl:z-auto xl:shadow-sm"
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
                      const image = resolvePosImageSrc(product.images?.[0]);
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
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                onClick={() =>
                                  setWarehouseImagePreview({
                                    src: image,
                                    title: composeProductDisplayName(
                                      product.nombre,
                                      product.productoMarca,
                                    ),
                                  })
                                }
                                title="Ver imagen"
                              >
                                <img
                                  src={image}
                                  alt={composeProductDisplayName(
                                    product.nombre,
                                    product.productoMarca,
                                  )}
                                  className="w-full h-full object-contain"
                                />
                              </button>
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
                                S/ {priceLabel(product, priceMode)}
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
          <div className="absolute inset-0 bg-slate-100 p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-50 md:text-base"
                onClick={confirmClear}
                disabled={!items.length}
              >
                <RotateCcw className="h-4 w-4 md:h-5 md:w-5" />
                Vaciar
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200 md:h-11 md:w-11"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4 md:h-6 md:w-6" />
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)] pb-[max(env(safe-area-inset-bottom),0.5rem)]">
              {renderCartPanel({ mobile: true })}
            </div>
          </div>
        </div>
      )}
      {stockInquiry && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]"
          onClick={() => setStockInquiry(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-800 text-white">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    Stock en otros almacenes
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {stockInquiry.productName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                onClick={() => setStockInquiry(null)}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">
                    Stock tienda
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {stockInquiry.storeStock.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-500">{stockInquiry.unit}</p>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-700">
                    Pedido total
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-amber-900">
                    {stockInquiry.requestedQty.toFixed(2)}
                  </p>
                  <p className="text-xs text-amber-700">{stockInquiry.unit}</p>
                </div>
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-medium text-rose-700">
                    Falta completar
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-rose-900">
                    {stockInquiry.missingQty.toFixed(2)}
                  </p>
                  <p className="text-xs text-rose-700">{stockInquiry.unit}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-slate-200">
                <div className="max-h-72 overflow-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-semibold">Almacén</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Cantidad
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Stock
                        </th>
                        <th className="px-3 py-2 font-semibold">UM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                      {stockInquiry.loading ? (
                        <tr>
                          <td className="px-3 py-8 text-center" colSpan={4}>
                            <div className="inline-flex items-center gap-2 text-slate-500">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Consultando almacenes...
                            </div>
                          </td>
                        </tr>
                      ) : stockInquiry.rows.length ? (
                        stockInquiry.rows.map((row) => (
                          <tr
                            key={`${row.almacenNombre}-${row.unidadMedida}`}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-3 py-2 font-medium">
                              {row.almacenNombre}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                              {row.cantidad.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.stock.toFixed(2)}
                            </td>
                            <td className="px-3 py-2">{row.unidadMedida}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            className="px-3 py-8 text-center text-slate-500"
                            colSpan={4}
                          >
                            No se encontró stock en otros almacenes.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                  <span>{stockInquiry.rows.length} almacenes disponibles</span>
                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <span>Cant. total</span>
                    <span className="rounded-md bg-slate-800 px-3 py-1 text-base text-white">
                      {(
                        stockInquiry.storeStock +
                        stockInquiry.rows.reduce(
                          (sum, row) => sum + row.stock,
                          0,
                        )
                      ).toFixed(2)}
                    </span>
                    <span>{stockInquiry.unit}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {warehouseModalOpen && (
        <div
          className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]"
          onClick={closeWarehouseProducts}
        >
          <div
            className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-800 text-white">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    Productos de almacén
                  </p>
                  <p className="text-xs text-slate-500">
                    Stock disponible por almacén y unidad de medida
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                onClick={closeWarehouseProducts}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  searchWarehouseProducts();
                }}
              >
                <input
                  ref={warehouseSearchInputRef}
                  value={warehouseSearch}
                  onInput={(event) =>
                    handleWarehouseSearchChange(event.currentTarget.value)
                  }
                  onChange={(event) =>
                    handleWarehouseSearchChange(event.target.value)
                  }
                  placeholder="Buscar por código, producto o almacén"
                  className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
                >
                  Buscar
                </button>
              </form>

              <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200">
                <div className="h-full overflow-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-semibold">Código</th>
                        <th className="px-3 py-2 font-semibold">Producto</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Cantidad
                        </th>
                        <th className="px-3 py-2 font-semibold">UM</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          P. Venta S/
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Acción
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                      {warehouseLoading ? (
                        <tr>
                          <td className="px-3 py-8 text-center" colSpan={7}>
                            <div className="inline-flex items-center gap-2 text-slate-500">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Cargando productos...
                            </div>
                          </td>
                        </tr>
                      ) : warehouseProducts.length ? (
                        warehouseProducts.map((item) => (
                          <tr
                            key={`${item.idStock}-${item.productoUM}`}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-3 py-2">{item.productoCodigo}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {item.descripcion}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                              {item.cantidad.toFixed(2)}
                            </td>
                            <td className="px-3 py-2">{item.productoUM}</td>
                            <td className="px-3 py-2 text-right">
                              {formatPrice(item.productoVenta)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                                onClick={() => openWarehouseImage(item)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Imagen
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            className="px-3 py-8 text-center text-slate-500"
                            colSpan={7}
                          >
                            No se encontraron productos de almacén.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {warehouseProducts.length} de{" "}
                  {warehousePagination.totalRegistros.toLocaleString("en-US")}{" "}
                  resultados
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                    disabled={warehousePage <= 1 || warehouseLoading}
                    onClick={() => changeWarehousePage(warehousePage - 1)}
                  >
                    Anterior
                  </button>
                  <span>Página {warehousePage}</span>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                    disabled={!warehousePagination.hasMore || warehouseLoading}
                    onClick={() => changeWarehousePage(warehousePage + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {warehouseImagePreview && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]"
          onClick={() => setWarehouseImagePreview(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <p className="truncate text-sm font-semibold text-slate-900">
                {warehouseImagePreview.title}
              </p>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                onClick={() => setWarehouseImagePreview(null)}
                aria-label="Cerrar imagen"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-[76vh] items-center justify-center bg-slate-100 p-3">
              <img
                src={warehouseImagePreview.src}
                alt={warehouseImagePreview.title}
                className="max-h-[72vh] max-w-full rounded-md object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSPage;
