import { create } from "zustand";
import { API_BASE_URL, PRODUCT_IMAGE_BASE_URL } from "@/config";
import { apiRequest } from "@/shared/helpers/apiRequest";
import type { Product } from "@/types/product";
import type { ProductUnitOption } from "@/types/product";
import type { ProductWarehouseItem } from "@/types/product";

interface ApiProduct {
  idProducto?: number;
  idSubLinea?: number | null;
  nombreLinea?: string | null;
  nombreSublinea?: string | null;
  productoCodigo?: string | null;
  productoNombre?: string | null;
  productoMarca?: string | null;
  descripcion?: string | null;
  productoTipoCambio?: number | null;
  productoCostoDolar?: number | null;
  productoUM?: string | null;
  productoCosto?: number | string | null;
  precioCosto?: number | string | null;
  productoVenta?: number | string | null;
  productoVentaB?: number | string | null;
  productoCantidad?: number | string | null;
  almacenNombre?: string | null;
  productoUbicacion?: string | null;
  productoObs?: string | null;
  productoEstado?: string | null;
  productoUsuario?: string | null;
  productoFecha?: string | null;
  productoImagen?: string | null;
  valorCritico?: number | null;
  maxCantVen?: number | string | null;
  aplicaTC?: string | null;
  fechaVencimiento?: string | null;
  aplicaFechaV?: boolean | null;
  aplicaINV?: string | null;
  cantidadANT?: number | null;
  fechaModCant?: string | null;
  unidadImagen?: string | null;
  UnidadImagen?: string | null;
}

interface FetchCatalogProductsParams {
  busqueda?: string;
  pagina?: number;
  tamanoPagina?: number;
  append?: boolean;
}

interface FetchWarehouseProductsParams {
  almacenId?: number | null;
  busqueda?: string;
  pagina?: number;
  tamanoPagina?: number;
}

interface CatalogPaginationState {
  pagina: number;
  tamanoPagina: number;
  totalRegistros: number;
  hasMore: boolean;
}

interface ProductsState {
  products: Product[];
  warehouseProducts: ProductWarehouseItem[];
  loading: boolean;
  warehouseLoading: boolean;
  catalogPagination: CatalogPaginationState;
  warehousePagination: CatalogPaginationState;
  fetchProducts: (estado?: "ACTIVO" | "INACTIVO" | "") => Promise<void>;
  fetchCatalogProducts: (params?: FetchCatalogProductsParams) => Promise<void>;
  fetchWarehouseProducts: (params?: FetchWarehouseProductsParams) => Promise<void>;
  resetCatalogProducts: () => void;
  addProduct: (
    product: Omit<Product, "id"> & {
      imageFile?: File | null;
      imageRemoved?: boolean;
      unidadImagenAlternaFile?: File | null;
    },
  ) => Promise<boolean>;
  updateProduct: (
    id: number,
    data: Omit<Product, "id"> & {
      imageFile?: File | null;
      imageRemoved?: boolean;
      unidadImagenAlternaFile?: File | null;
    },
  ) => Promise<boolean>;
  deleteProduct: (id: number) => Promise<boolean>;
}

const CATALOG_DEFAULT_PAGE_SIZE = 50;
const CATALOG_MAX_PAGE_SIZE = 100;

const toNumberValue = (value: unknown, fallback = 0) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  // Soporta formatos "1234.56", "1,234.56" y "1.234,56".
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return fallback;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0].replace(/\./g, "")}.${parts[1]}`;
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Math.trunc(toNumberValue(value, fallback));
  return parsed > 0 ? parsed : fallback;
};

const normalizeCatalogPageSize = (value: unknown) =>
  Math.min(
    CATALOG_MAX_PAGE_SIZE,
    Math.max(1, toPositiveInt(value, CATALOG_DEFAULT_PAGE_SIZE)),
  );

const normalizeSegment = (value: unknown) =>
  String(value ?? "")
    .replace(/[|;[\]\r\n]/g, " ")
    .trim();
const toImageFileName = (value: unknown) => {
  const normalized = normalizeSegment(value);
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower.startsWith("blob:") || lower.startsWith("data:")) return "";

  try {
    const url = new URL(normalized);
    const fileName = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).pop() ?? "",
    );
    return fileName.trim();
  } catch {
    const fileName =
      normalized.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
    return fileName.trim();
  }
};
const normalizePersistedImageSegment = (value: unknown) => {
  return toImageFileName(value);
};
export const resolveProductImageUrl = (value: unknown) => {
  const normalized = normalizeSegment(value);
  if (!normalized) return "";
  if (/^(https?:|blob:|data:)/i.test(normalized)) return normalized;

  const fileName = toImageFileName(normalized);
  if (!fileName) return "";

  const uncMatch = normalized.match(/^\\+([^\\]+)\\/);
  const baseUrl = uncMatch
    ? `http://${uncMatch[1]}:8082`
    : PRODUCT_IMAGE_BASE_URL;
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
};
const normalizeUpperSegment = (value: unknown) =>
  normalizeSegment(value).toLocaleUpperCase("es-PE");

const formatDecimal = (value: unknown, decimals: number) =>
  toNumberValue(value, 0).toFixed(decimals);

const resolveAplicaINV = (value: unknown) =>
  String(value ?? "").trim().toUpperCase() === "N" ||
  String(value ?? "").trim().toLowerCase() === "servicio"
    ? "N"
    : "S";

const parseScalarId = (value: unknown): number => {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : value &&
            typeof value === "object" &&
            "id" in (value as Record<string, unknown>)
          ? Number((value as Record<string, unknown>).id)
          : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

const hasExistsMessage = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.toLowerCase().includes("existe");
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(
    (item) => typeof item === "string" && item.toLowerCase().includes("existe"),
  );
};

const isAxiosLikeError = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.isAxiosError) || ("response" in record && "config" in record);
};

const normalizeEstado = (value: unknown): Product["estado"] => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "INACTIVO") return "INACTIVO";
  if (normalized === "archivado") return "archivado";
  return "ACTIVO";
};

const parseDelimitedProducts = (rawValue: string): ApiProduct[] => {
  const raw = String(rawValue ?? "").trim();
  if (!raw || raw === "~" || raw.toUpperCase() === "FORMATO_INVALIDO") {
    return [];
  }

  return raw
    .split("¬")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): ApiProduct | null => {
      const parts = chunk.split("|");
      const at = (index: number) => String(parts[index] ?? "").trim();

      const idProducto = toNumberValue(at(0), 0);
      if (!idProducto) return null;

      const idSubLineaRaw = at(1);
      return {
        idProducto,
        idSubLinea:
          idSubLineaRaw === "" ? null : toNumberValue(idSubLineaRaw, 0),
        productoCodigo: at(2),
        productoNombre: at(3),
        productoUM: at(4),
        productoCosto: toNumberValue(at(5), 0),
        productoVenta: toNumberValue(at(6), 0),
        productoVentaB: toNumberValue(at(7), 0),
        productoCantidad: toNumberValue(at(8), 0),
        productoEstado: at(9),
        productoUsuario: at(10),
        productoFecha: at(11),
        productoImagen: at(12),
        valorCritico: toNumberValue(at(13), 0),
        aplicaINV: at(14),
      };
    })
    .filter((item): item is ApiProduct => Boolean(item));
};

const parseProductsResponse = (payload: unknown): ApiProduct[] => {
  if (Array.isArray(payload)) {
    return payload as ApiProduct[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const arrayCandidate = Object.values(record).find(Array.isArray);
    if (Array.isArray(arrayCandidate)) {
      return arrayCandidate as ApiProduct[];
    }

    const stringCandidate = Object.values(record).find(
      (value) => typeof value === "string",
    );
    if (typeof stringCandidate === "string") {
      return parseDelimitedProducts(stringCandidate);
    }

    return [];
  }

  if (typeof payload === "string") {
    return parseDelimitedProducts(payload);
  }

  return [];
};

const parsePaginatedProductsResponse = (
  payload: unknown,
  fallbackPage: number,
  fallbackPageSize: number,
) => {
  const defaults = {
    pagina: fallbackPage,
    tamanoPagina: normalizeCatalogPageSize(fallbackPageSize),
    totalRegistros: 0,
    items: [] as ApiProduct[],
  };

  if (Array.isArray(payload)) {
    const items = parseProductsResponse(payload);
    const tamanoPagina =
      items.length > 0
        ? normalizeCatalogPageSize(items.length)
        : defaults.tamanoPagina;
    return {
      pagina: 1,
      tamanoPagina,
      totalRegistros: items.length,
      items,
    };
  }

  if (!payload || typeof payload !== "object") {
    return defaults;
  }

  const record = payload as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? (record.items as ApiProduct[])
    : parseProductsResponse(payload);
  const pagina = toPositiveInt(record.pagina, defaults.pagina);
  const tamanoPagina = Array.isArray(record.items)
    ? normalizeCatalogPageSize(record.tamanoPagina)
    : items.length > 0
      ? normalizeCatalogPageSize(items.length)
      : defaults.tamanoPagina;
  const totalRegistrosRaw = toNumberValue(record.totalRegistros, items.length);
  const totalRegistros = Math.max(0, Math.trunc(totalRegistrosRaw));

  return {
    pagina,
    tamanoPagina,
    totalRegistros,
    items,
  };
};

const mapApiToProduct = (item: ApiProduct): Product => {
  // Soporta variantes de payload sin romper el catalogo.
  // Algunos backends envian "marca" en lugar de "productoMarca".
  const raw = item as Record<string, unknown>;
  const productImage = resolveProductImageUrl(item.productoImagen);
  const marca = String(
    item.productoMarca ?? raw.marca ?? raw.Marca ?? "",
  ).trim();
  const descripcion = String(
    item.descripcion ?? raw.productoDescripcion ?? "",
  ).trim();

  return {
    id: item.idProducto ?? 0,
    nombreLinea: item.nombreLinea ?? "",
    nombreSublinea: item.nombreSublinea ?? "",
    codigo: item.productoCodigo ?? "",
    nombre: item.productoNombre ?? "",
    productoMarca: marca,
    descripcion,
    unidadMedida: item.productoUM ?? "",
    valorCritico: toNumberValue(item.valorCritico, 0),
    preCosto: toNumberValue(item.productoCosto ?? item.precioCosto, 0),
    preVenta: toNumberValue(item.productoVenta, 0),
    aplicaINV: String(item.aplicaINV ?? "").toUpperCase() === "N" ? "N" : "S",
    cantidad: toNumberValue(item.productoCantidad, 0),
    almacenNombre: item.almacenNombre ?? undefined,
    productoUbicacion: item.productoUbicacion ?? undefined,
    maxCantVen: item.maxCantVen ?? undefined,
    usuario: item.productoUsuario ?? "",
    estado: normalizeEstado(item.productoEstado),
    images: productImage ? [productImage] : [],
    idSubLinea: item.idSubLinea,
    preVentaB: toNumberValue(item.productoVentaB, 0),
  };
};

const mapApiToUnitOption = (item: ApiProduct): ProductUnitOption => {
  const rawItem = item as Record<string, unknown>;
  const factorValue = toNumberValue(
    rawItem.valorUM ?? rawItem.factor ?? rawItem.ValorUM ?? rawItem.Factor,
    0,
  );
  const unidadImagen = resolveProductImageUrl(
    rawItem.unidadImagen ??
      rawItem.UnidadImagen ??
      item.unidadImagen ??
      item.UnidadImagen ??
      item.productoImagen ??
      "",
  );

  return {
    unidadMedida: (item.productoUM ?? "").trim(),
    cantidad: toNumberValue(item.productoCantidad, 0),
    preCosto: toNumberValue(item.productoCosto ?? item.precioCosto, 0),
    preVenta: toNumberValue(item.productoVenta, 0),
    preVentaB: toNumberValue(item.productoVentaB, 0),
    factor: factorValue > 0 ? factorValue : undefined,
    valorUM: factorValue > 0 ? factorValue : undefined,
    unidadImagen: unidadImagen || undefined,
  };
};

const mapApiToWarehouseProduct = (
  item: Record<string, unknown>,
): ProductWarehouseItem => ({
  totalRegistros: toNumberValue(item.totalRegistros, 0),
  idStock: toNumberValue(item.idStock, 0),
  almacenId: toNumberValue(item.almacenId, 0),
  almacenNombre: normalizeSegment(item.almacenNombre),
  idProducto: toNumberValue(item.idProducto, 0),
  productoCodigo: normalizeSegment(item.productoCodigo),
  productoNombre: normalizeSegment(item.productoNombre),
  productoMarca: normalizeSegment(item.productoMarca) || undefined,
  descripcion: normalizeSegment(item.descripcion),
  cantidad: toNumberValue(item.cantidad, 0),
  productoUM: normalizeSegment(item.productoUM),
  productoVenta: toNumberValue(item.productoVenta, 0),
  productoVentaB: toNumberValue(item.productoVentaB, 0),
  precioCosto: toNumberValue(item.precioCosto, 0),
  valorUM: toNumberValue(item.valorUM, 0),
  valorCritico: toNumberValue(item.valorCritico, 0),
  productoImagen: resolveProductImageUrl(item.productoImagen) || undefined,
  productoUbicacion: normalizeSegment(item.productoUbicacion) || undefined,
  usuario: normalizeSegment(item.usuario) || undefined,
  fechaEdicion: normalizeSegment(item.fechaEdicion) || undefined,
  inversion: toNumberValue(item.inversion, 0),
  esUnidadAlterna: Boolean(item.esUnidadAlterna),
});

const groupProductsByHeader = (items: ApiProduct[]): Product[] => {
  if (!items.length) return [];

  const grouped = new Map<number, ApiProduct[]>();
  const orderedIds: number[] = [];

  items.forEach((item) => {
    const id = toNumberValue(item.idProducto, 0);
    if (!id) return;
    if (!grouped.has(id)) {
      grouped.set(id, []);
      orderedIds.push(id);
    }
    grouped.get(id)!.push(item);
  });

  return orderedIds
    .map((id) => {
      const rows = grouped.get(id) ?? [];
      if (!rows.length) return null;

      // El SP devuelve primero la fila base (unidad principal), luego alternas.
      // Mantener ese orden evita invertir principal/secundaria cuando la alterna
      // tiene stock convertido mayor.
      const headerRow = rows[0];

      const header = mapApiToProduct(headerRow);
      const headerUm = (headerRow.productoUM ?? "").trim().toLowerCase();
      const headerQty = toNumberValue(headerRow.productoCantidad, 0);

      const alternativas = rows
        .filter((row) => row !== headerRow)
        .filter((row) => {
          const um = (row.productoUM ?? "").trim().toLowerCase();
          return um !== "" && um !== headerUm;
        })
        .map(mapApiToUnitOption)
        .map((row) => {
          const explicitFactor = toNumberValue(row.valorUM ?? row.factor, 0);
          if (explicitFactor > 0) {
            return {
              ...row,
              factor: Number(explicitFactor.toFixed(6)),
              valorUM: Number(explicitFactor.toFixed(6)),
            };
          }

          const altQty = toNumberValue(row.cantidad, 0);
          const derivedFactor =
            headerQty > 0 && altQty > 0 ? headerQty / altQty : 0;
          if (derivedFactor > 0) {
            return {
              ...row,
              factor: Number(derivedFactor.toFixed(6)),
              valorUM: Number(derivedFactor.toFixed(6)),
            };
          }

          return row;
        });

      const uniqueAlternativas = alternativas.filter((row, idx, list) => {
        const key = row.unidadMedida.trim().toLowerCase();
        return list.findIndex((x) => x.unidadMedida.trim().toLowerCase() === key) === idx;
      });

      if (uniqueAlternativas.length > 0) {
        header.unidadesAlternas = uniqueAlternativas;
      }

      return header;
    })
    .filter((item): item is Product => Boolean(item));
};

const mapProductToApi = (
  product: Partial<Product>,
  idOverride?: number,
): ApiProduct => ({
  idProducto: idOverride ?? product.id ?? 0,
  idSubLinea:
    product.idSubLinea === undefined || product.idSubLinea === null
      ? 0
      : Number(product.idSubLinea),
  productoCodigo: product.codigo ?? "",
  productoNombre: product.nombre ?? "",
  productoUM: normalizeUpperSegment(product.unidadMedida ?? ""),
  valorCritico: product.valorCritico ?? 0,
  productoCosto: product.preCosto ?? 0,
  productoVenta: product.preVenta ?? 0,
  // Precio de venta B deshabilitado en frontend; se fuerza 0 en todos los envios.
  productoVentaB: 0,
  productoCantidad: product.cantidad ?? 0,
  productoObs: "",
  productoEstado: product.estado ?? "BUENO",
  productoUsuario: product.usuario ?? "",
  productoFecha: new Date().toISOString(),
  productoImagen: normalizePersistedImageSegment(product.images?.[0] ?? ""),
  productoTipoCambio: 0,
  productoCostoDolar: 0,
  aplicaTC: null,
  fechaVencimiento: null,
  aplicaFechaV: false,
  aplicaINV:
    product.aplicaINV === "N" || product.aplicaINV === "servicio" ? "N" : "S",
  cantidadANT: product.cantidad ?? 0,
  fechaModCant: null,
});

const buildProductDataString = (
  product: Partial<Product> & {
    imageFile?: File | null;
    imageRemoved?: boolean;
    aplicaOtraUnidad?: boolean;
    unidadAlterna?: string;
    unidadImagenAlterna?: string;
    unidadImagenAlternaFile?: File | null;
    unidadesPorEmpaque?: number | null;
    preVentaUnidadAlterna?: number | null;
    valorUMUnidadAlterna?: number | null;
    unidadesAlternas?: Array<{
      unidad?: string;
      unidadMedida?: string;
      factor?: number;
      valorUM?: number;
      preVenta?: number;
      unidadImagen?: string;
    }>;
  },
  payload: ApiProduct,
) => {
  const hasUploadedImage = product.imageFile instanceof File;
  const imageFromPayload = product.imageRemoved
    ? ""
    : hasUploadedImage
      ? ""
      : normalizePersistedImageSegment(payload.productoImagen ?? "");

  const header = [
    String(toNumberValue(payload.idProducto, 0)),
    String(toNumberValue(payload.idSubLinea, 0)),
    normalizeSegment(payload.productoCodigo ?? ""),
    normalizeSegment(payload.productoNombre ?? ""),
    normalizeSegment(payload.productoUM ?? ""),
    formatDecimal(payload.productoCosto, 4),
    formatDecimal(payload.productoVenta, 2),
    formatDecimal(payload.productoVentaB, 2),
    formatDecimal(payload.productoCantidad, 2),
    normalizeSegment(payload.productoEstado ?? "ACTIVO"),
    normalizeSegment(payload.productoUsuario ?? ""),
    imageFromPayload,
    formatDecimal(payload.valorCritico, 2),
    resolveAplicaINV(payload.aplicaINV),
  ].join("|");

  const fromArray = Array.isArray(product.unidadesAlternas)
    ? product.unidadesAlternas
        .map((row) => ({
          unidad: normalizeUpperSegment(row?.unidad ?? row?.unidadMedida ?? ""),
          factor: toNumberValue(row?.factor ?? row?.valorUM, 0),
          preVenta: toNumberValue(row?.preVenta, 0),
          unidadImagen: normalizePersistedImageSegment(row?.unidadImagen ?? ""),
        }))
        .filter((row) => row.unidad !== "" && row.factor > 0)
    : [];

  const fallbackUnidad = normalizeUpperSegment(product.unidadAlterna ?? "");
  const fallbackFactor = toNumberValue(product.valorUMUnidadAlterna, 0);
  const fallbackUnitsPerPackage = toNumberValue(product.unidadesPorEmpaque, 0);
  const fallbackPreVentaUnidadAlterna = toNumberValue(
    product.preVentaUnidadAlterna,
    0,
  );
  const fallbackUnidadImagenAlterna = normalizePersistedImageSegment(
    product.unidadImagenAlterna ?? "",
  );
  const fallbackUnidadNormalizada = fallbackUnidad || "UNIDAD";
  const resolveDivisor = (factor: number, explicitUnitsPerPackage = 0) => {
    if (explicitUnitsPerPackage > 0) return explicitUnitsPerPackage;
    if (factor > 1) return factor;
    if (factor > 0 && factor < 1) return 1 / factor;
    return 1;
  };

  const selectedUnit =
    fromArray[0] ??
    (fallbackFactor > 0
        ? {
            unidad: fallbackUnidadNormalizada,
            factor: fallbackFactor,
            divisor: resolveDivisor(fallbackFactor, fallbackUnitsPerPackage),
            preVenta: fallbackPreVentaUnidadAlterna,
            unidadImagen: fallbackUnidadImagenAlterna || imageFromPayload,
          }
      : null);

  if (!product.aplicaOtraUnidad || !selectedUnit) {
    return header;
  }

  // Detail row for UnidadMedida: precio de venta editable desde el modal.
  const unitDivisor = resolveDivisor(
    toNumberValue(selectedUnit.factor, 0),
    toNumberValue((selectedUnit as { divisor?: unknown }).divisor, 0),
  );
  const detailVenta =
    toNumberValue(selectedUnit.preVenta, 0) > 0
      ? toNumberValue(selectedUnit.preVenta, 0)
      : toNumberValue(payload.productoVenta, 0) / unitDivisor;
  const detailVentaB = toNumberValue(payload.productoVentaB, 0) / unitDivisor;
  const detailCosto = toNumberValue(payload.productoCosto, 0) / unitDivisor;
  const detailUnidadImagen = normalizePersistedImageSegment(
    (selectedUnit as { unidadImagen?: unknown }).unidadImagen ?? imageFromPayload,
  );

  const detail = [
    selectedUnit.unidad,
    formatDecimal(selectedUnit.factor, 2),
    formatDecimal(detailVenta, 2),
    formatDecimal(detailVentaB, 2),
    formatDecimal(detailCosto, 2),
    detailUnidadImagen,
  ].join("|");

  return `${header}[${detail}]`;
};

const baseUrl = `${API_BASE_URL}/Productos`;

const buildProductFormData = (
  product: Partial<Product> & {
    imageFile?: File | null;
    imageRemoved?: boolean;
    aplicaOtraUnidad?: boolean;
    unidadAlterna?: string;
    unidadImagenAlterna?: string;
    unidadImagenAlternaFile?: File | null;
    unidadesPorEmpaque?: number | null;
    preVentaUnidadAlterna?: number | null;
    valorUMUnidadAlterna?: number | null;
    unidadesAlternas?: Array<{
      unidad?: string;
      unidadMedida?: string;
      factor?: number;
      valorUM?: number;
      preVenta?: number;
      unidadImagen?: string;
    }>;
  },
  idOverride?: number,
) => {
  const payload = mapProductToApi(product, idOverride);
  const formData = new FormData();
  const dataSerialized = buildProductDataString(product, payload);

  formData.append("Data", dataSerialized);
  formData.append("data", dataSerialized);

  Object.entries(payload).forEach(([key, value]) => {
    // El backend asigna la imagen; no enviar productoImagen.
    if (key === "productoImagen") return;
    const normalized = value === undefined || value === null ? "" : String(value);
    formData.append(key, normalized);
  });

  if (product.imageFile instanceof File) {
    formData.append("imagen", product.imageFile);
  }
  if (product.unidadImagenAlternaFile instanceof File) {
    formData.append("imagenUnidad", product.unidadImagenAlternaFile);
  }
  if (product.imageRemoved) {
    formData.append("eliminarImagen", "true");
  }

  return { formData, payload };
};

const toSavedApiProduct = (
  response: unknown,
  payload: ApiProduct,
  idFallback = 0,
): ApiProduct => {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return response as ApiProduct;
  }

  const idFromResponse = parseScalarId(response);
  if (idFromResponse > 0) {
    return {
      ...payload,
      idProducto: idFromResponse,
    };
  }

  if ((payload.idProducto ?? 0) > 0) return payload;
  return { ...payload, idProducto: idFallback };
};

export const useProductsStore = create<ProductsState>((set) => ({
  products: [],
  warehouseProducts: [],
  loading: false,
  warehouseLoading: false,
  catalogPagination: {
    pagina: 1,
    tamanoPagina: CATALOG_DEFAULT_PAGE_SIZE,
    totalRegistros: 0,
    hasMore: false,
  },
  warehousePagination: {
    pagina: 1,
    tamanoPagina: CATALOG_DEFAULT_PAGE_SIZE,
    totalRegistros: 0,
    hasMore: false,
  },

  fetchProducts: async (estado = "ACTIVO") => {
    set({ loading: true });
    try {
      void estado;
      const pagina = 1;
      const tamanoPagina = CATALOG_DEFAULT_PAGE_SIZE;
      const params = new URLSearchParams({
        pagina: String(pagina),
        tamanoPagina: String(tamanoPagina),
      });

      const response = await apiRequest<unknown>({
        url: `${baseUrl}/listar-productos?${params.toString()}`,
        method: "GET",
        fallback: {
          pagina,
          tamanoPagina,
          totalRegistros: 0,
          items: [],
        },
      });
      const parsed = parsePaginatedProductsResponse(
        response,
        pagina,
        tamanoPagina,
      );
      const grouped = groupProductsByHeader(parsed.items);
      const totalRegistros = Math.max(parsed.totalRegistros, grouped.length);
      const hasMore = grouped.length > 0 && grouped.length < totalRegistros;
      set({
        products: grouped,
        catalogPagination: {
          pagina: parsed.pagina,
          tamanoPagina: parsed.tamanoPagina,
          totalRegistros,
          hasMore,
        },
        loading: false,
      });
    } catch (error) {
      console.error("Error loading products", error);
      set({ loading: false });
    }
  },

  fetchCatalogProducts: async ({
    busqueda = "",
    pagina = 1,
    tamanoPagina = CATALOG_DEFAULT_PAGE_SIZE,
    append = false,
  } = {}) => {
    set({ loading: true });
    const normalizedBusqueda = String(busqueda ?? "").trim();
    void pagina;
    void tamanoPagina;
    void append;

    try {
      const params = new URLSearchParams();
      if (normalizedBusqueda) {
        params.set("busqueda", normalizedBusqueda);
      }
      const query = params.toString();

      const response = await apiRequest<unknown>({
        url: query
          ? `${baseUrl}/listar-productos?${query}`
          : `${baseUrl}/listar-productos`,
        method: "GET",
        fallback: {
          pagina: 1,
          tamanoPagina: CATALOG_DEFAULT_PAGE_SIZE,
          totalRegistros: 0,
          items: [],
        },
      });

      const parsed = parsePaginatedProductsResponse(
        response,
        1,
        CATALOG_DEFAULT_PAGE_SIZE,
      );
      const mappedPage = groupProductsByHeader(parsed.items);
      const totalRegistros = Math.max(parsed.totalRegistros, mappedPage.length);

      set({
        products: mappedPage,
        catalogPagination: {
          pagina: 1,
          tamanoPagina: parsed.tamanoPagina,
          totalRegistros,
          hasMore: false,
        },
        loading: false,
      });
    } catch (error) {
      console.error("Error loading paginated products", error);
      set({ loading: false });
    }
  },

  fetchWarehouseProducts: async ({
    almacenId = null,
    busqueda = "",
    pagina = 1,
    tamanoPagina = CATALOG_DEFAULT_PAGE_SIZE,
  } = {}) => {
    set({ warehouseLoading: true });
    const normalizedPage = toPositiveInt(pagina, 1);
    const normalizedPageSize = normalizeCatalogPageSize(tamanoPagina);

    try {
      const params = new URLSearchParams({
        pagina: String(normalizedPage),
        tamanoPagina: String(normalizedPageSize),
      });
      const normalizedBusqueda = String(busqueda ?? "").trim();
      if (normalizedBusqueda) params.set("busqueda", normalizedBusqueda);
      if (Number(almacenId ?? 0) > 0) params.set("almacenId", String(almacenId));

      const response = await apiRequest<unknown>({
        url: `${baseUrl}/almacen-productos?${params.toString()}`,
        method: "GET",
        fallback: [],
      });
      const rawItems = Array.isArray(response)
        ? (response as Record<string, unknown>[])
        : [];
      const items = rawItems.map(mapApiToWarehouseProduct);
      const totalRegistros = Math.max(
        ...items.map((item) => item.totalRegistros ?? 0),
        items.length,
      );

      set({
        warehouseProducts: items,
        warehousePagination: {
          pagina: normalizedPage,
          tamanoPagina: normalizedPageSize,
          totalRegistros,
          hasMore: normalizedPage * normalizedPageSize < totalRegistros,
        },
        warehouseLoading: false,
      });
    } catch (error) {
      console.error("Error loading warehouse products", error);
      set({ warehouseLoading: false });
    }
  },

  resetCatalogProducts: () => {
    set({
      products: [],
      catalogPagination: {
        pagina: 1,
        tamanoPagina: CATALOG_DEFAULT_PAGE_SIZE,
        totalRegistros: 0,
        hasMore: false,
      },
    });
  },

  addProduct: async (product) => {
    try {
      set({ loading: true });
      const { formData, payload } = buildProductFormData(product, 0);
      const created = await apiRequest<unknown>({
        url: `${baseUrl}/register`,
        method: "POST",
        data: formData,
        fallback: payload,
      });

      if (isAxiosLikeError(created)) {
        return false;
      }

      if (hasExistsMessage(created)) {
        return false;
      }

      const apiSaved = toSavedApiProduct(created, payload);
      const newItem = mapApiToProduct(apiSaved);
      set((state) => ({ products: [...state.products, newItem] }));
      return true;
    } catch (error) {
      console.error("Error creating product", error);
      return false;
    } finally {
      set({ loading: false });
    }
  },

  updateProduct: async (id, data) => {
    try {
      set({ loading: true });
      const { formData, payload } = buildProductFormData(data, id);
      const updated = await apiRequest<unknown>({
        url: `${baseUrl}/register`,
        method: "POST",
        data: formData,
        fallback: payload,
      });

      if (isAxiosLikeError(updated)) {
        return false;
      }

      if (hasExistsMessage(updated)) {
        return false;
      }

      const apiSaved = toSavedApiProduct(updated, payload, id);
      const updatedItem = mapApiToProduct(apiSaved);
      set((state) => ({
        products: state.products.map((p) => (p.id === id ? updatedItem : p)),
      }));
      return true;
    } catch (error) {
      console.error("Error updating product", error);
      return false;
    } finally {
      set({ loading: false });
    }
  },

  deleteProduct: async (id) => {
    try {
      const result = await apiRequest({
        url: `${baseUrl}/${id}`,
        method: "DELETE",
        config: { headers: { Accept: "*/*" } },
        fallback: true,
      });

      set((state) => ({
        products: state.products.filter((p) => p.id !== id),
      }));

      return result !== false;
    } catch (error) {
      console.error("Error deleting product", error);
      return false;
    }
  },
}));
