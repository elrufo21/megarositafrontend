import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { createColumnHelper } from "@tanstack/react-table";
import {
  CheckCircle2,
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

type PosCatalogProduct = Product & {
  catalogKey: string;
  detalleId?: number;
  isVariation?: boolean;
  baseProductId?: number;
  valorUM?: number;
};

const columnHelper = createColumnHelper<PosCatalogProduct>();
const CATALOG_PAGE_SIZE = 50;
const TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100];

const priceLabel = (product: Product) =>
  Number(product.preVenta ?? product.preVentaB ?? 0).toFixed(2);
const sortCatalogProductsByCode = (products: PosCatalogProduct[]) =>
  [...products].sort((a, b) =>
    String(a.codigo ?? "").localeCompare(String(b.codigo ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
const buildVariationDetailId = (baseId: number, index: number) =>
  -1 * (baseId * 1000 + (index + 1));
const getCartItemKey = (item: Pick<PosCartItem, "productId" | "detalleId">) =>
  Number(item.detalleId ?? 0) || Number(item.productId ?? 0);
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
  const navigate = useNavigate();
  const location = useLocation();
  const { products, fetchCatalogProducts, loading, catalogPagination } =
    useProductsStore();
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
    if (!isCardsView) return;

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
      pagina: 1,
      tamanoPagina: CATALOG_PAGE_SIZE,
      append: false,
    });
  }, [debouncedSearchTerm, fetchCatalogProducts, isCardsView]);

  useEffect(() => {
    if (!isCardsView || catalogPage <= 1) return;
    const root = catalogScrollRef.current;
    if (root) {
      appendScrollTopRef.current = root.scrollTop;
    }

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
      pagina: catalogPage,
      tamanoPagina: CATALOG_PAGE_SIZE,
      append: true,
    });
  }, [catalogPage, debouncedSearchTerm, fetchCatalogProducts, isCardsView]);

  useEffect(() => {
    if (isCardsView) return;

    fetchCatalogProducts({
      busqueda: debouncedSearchTerm,
      pagina: tablePage,
      tamanoPagina: tablePageSize,
      append: false,
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
    const minPrice = Math.max(0, Number(item.precioMinimo ?? 0) || 0);
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

  const goToPayment = () => {
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
    const paymentTarget = hasEditingNota
      ? `${paymentBasePath}/${Number(editingNotaId)}?mode=edit`
      : paymentBasePath;

    if (items.some(hasInvalidQuantityForPayment)) {
      toast.error("La cantidad debe ser mayor a 0.");
      return;
    }

    if (items.some(hasInvalidPriceForPayment)) {
      toast.error("El precio no debe ser menor al precio establecido.");
      return;
    }

    navigate(paymentTarget);
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
    const available = Number(product.cantidad ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      openDialog({
        title: "Sin stock",
        content: (
          <p className="text-sm text-slate-700">
            {product.nombre} no tiene stock disponible. ¿Deseas agregarlo de
            todos modos?
          </p>
        ),
        confirmText: "Agregar",
        cancelText: "Cancelar",
        onConfirm: () => {
          addProduct(product, 1);
          toast.success(`${product.nombre} agregado al carrito`, {
            duration: 1200,
          });
          focusSearchInput();
        },
      });
      return;
    }

    addProduct(product, 1);
    toast.success(`${product.nombre} agregado al carrito`, {
      duration: 1200,
    });
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

  const sortedCatalogProducts = useMemo(
    () => sortCatalogProductsByCode(catalogProducts),
    [catalogProducts],
  );

  const filteredProducts = useMemo(
    () => sortedCatalogProducts,
    [sortedCatalogProducts],
  );

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
    const desired = Math.max(1, (item.cantidad ?? 0) + delta);
    updateQuantity(getCartItemKey(item), desired);
  };

  const handleManualQuantity = (item: PosCartItem, value: string) => {
    if (value === "") {
      updateQuantity(getCartItemKey(item), 0);
      return;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    const next = Math.max(1, parsed);
    updateQuantity(getCartItemKey(item), next);
  };

  const handlePriceChange = (item: PosCartItem, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;

    setPriceDrafts((prev) => ({ ...prev, [getCartItemKey(item)]: value }));

    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      updatePrice(getCartItemKey(item), parsed);
    }
  };

  const handlePriceBlur = (item: PosCartItem, value: string) => {
    if (value.trim() === "") {
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      setPriceDrafts((prev) => ({
        ...prev,
        [getCartItemKey(item)]: String(item.precio ?? 0),
      }));
      return;
    }

    setPriceDrafts((prev) => ({
      ...prev,
      [getCartItemKey(item)]: String(parsed),
    }));
    updatePrice(getCartItemKey(item), parsed);
  };

  useEffect(() => {
    setPriceDrafts((prev) => {
      const next: Record<number, string> = {};
      items.forEach((item) => {
        const itemKey = getCartItemKey(item);
        next[itemKey] = prev[itemKey] ?? item.precio?.toString() ?? "";
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
    columnHelper.accessor("codigo", {
      header: "Código",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("nombre", {
      header: "Nombre",
      cell: (info) => info.getValue(),
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
      header: "P. Venta",
      cell: ({ row }) => (
        <span className="font-semibold text-right block">
          S/ {priceLabel(row.original)}
        </span>
      ),
      meta: { tdClassName: "text-right" },
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
          const minPrice = Math.max(0, Number(item.precioMinimo ?? 0) || 0);
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
                    {item.nombre}
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
                      value={priceDrafts[getCartItemKey(item)] ?? item.precio}
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
                    value={item.cantidad === 0 ? "" : item.cantidad}
                    onChange={(value) => handleManualQuantity(item, value)}
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
          disabled={!items.length}
          onClick={goToPayment}
        >
          <CheckCircle2 className="w-5 h-5" />
          Ir a pago
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
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

            {showInitialLoading ? (
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
                                alt={product.nombre}
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
                              {product.nombre}
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
                    data={sortedCatalogProducts}
                    columns={productColumns}
                    filterKeys={["codigo", "nombre", "unidadMedida"]}
                    onRowClick={handleAddProduct}
                    searchPlaceholder="Buscar por código o nombre"
                    globalFilterValue={searchTerm}
                    onGlobalFilterValueChange={setSearchTerm}
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
