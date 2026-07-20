import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

import { useEffect, useMemo, useState } from "react";
import type { PosCartItem, PosTotals } from "@/types/pos";
import { generateTicketQrBase64 } from "@/components/ticketQr";

const MM_TO_PT = 2.834645669;
const TICKET_WIDTH_MM = 77;
const TICKET_PAGE_WIDTH_PT = TICKET_WIDTH_MM * MM_TO_PT;

export type TicketDocumentProps = {
  clientName?: string;
  clientId?: string;
  clientAddress?: string;
  notaUsuario?: string;
  docType?: "boleta" | "factura" | "proforma";
  documentTitle?: string;
  paymentMethod?: string;
  items?: PosCartItem[];
  totals?: PosTotals;
  documentNumber?: string;
  noteId?: number | string | null;
  companyName?: string;
  companyRuc?: string;
  companyAddress?: string;
  companyDistrict?: string;
  companyLogo?: string;
  summary?: {
    operacionGravada?: number;
    cardAdditional?: number;
    cardPercentage?: number;
    showCardAdditional?: boolean;
    movilidad?: number;
    descuento?: number;
    showDiscount?: boolean;
    subtotal?: number;
    igv?: number;
    total?: number;
  };
  preGeneratedQrBase64?: string;
};

const AUTH_STORAGE_KEY = "sgo.auth.session";
const FALLBACK_LOGO_SRC = "/LogoHuillca.PNG";

const formatTicketMoney = (value: number): string =>
  Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const normalizePhoneLine = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const lowerRaw = raw.toLowerCase();
  const telefIndex = lowerRaw.indexOf("telef:");
  if (telefIndex >= 0) {
    return raw.slice(telefIndex).trim();
  }

  const telIndex = lowerRaw.indexOf("tel:");
  if (telIndex >= 0) {
    return raw.slice(telIndex).trim();
  }

  return raw;
};

const readCompanyPhoneFromStorage = (): string => {
  if (typeof window === "undefined") return "";

  try {
    const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawSession) return "";

    const parsed = JSON.parse(rawSession) as {
      user?: { companyPhone?: unknown } | null;
      loginPayload?: { companiaTelefono?: unknown } | null;
    } | null;

    const rawPhone =
      parsed?.user?.companyPhone ?? parsed?.loginPayload?.companiaTelefono;
    return normalizePhoneLine(rawPhone);
  } catch {
    return "";
  }
};

const readCompanyLogoFromStorage = (): string => {
  if (typeof window === "undefined") return "";

  try {
    const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawSession) return "";

    const parsed = JSON.parse(rawSession) as {
      user?: { companyLogo?: unknown } | null;
      loginPayload?: {
        logoCompania?: unknown;
        LogoCompania?: unknown;
      } | null;
    } | null;

    const rawLogo =
      parsed?.user?.companyLogo ??
      parsed?.loginPayload?.logoCompania ??
      parsed?.loginPayload?.LogoCompania;
    return typeof rawLogo === "string" ? rawLogo.trim() : "";
  } catch {
    return "";
  }
};

const toAbsoluteLogoUrl = (value: string): string => {
  const raw = value.trim();
  if (!raw) return "";

  if (raw.startsWith("data:")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window === "undefined") return raw;

  const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
  try {
    return new URL(normalizedPath, window.location.origin).toString();
  } catch {
    return `${window.location.origin}${normalizedPath}`;
  }
};

const mapLogoToDevProxyUrl = (source: string): string => {
  const normalizedSource = source.trim();
  if (!normalizedSource) return "";
  if (!import.meta.env.DEV) return normalizedSource;
  if (normalizedSource.startsWith("data:")) return normalizedSource;

  try {
    const parsed = new URL(normalizedSource);
    const uploadPath = parsed.pathname.startsWith("/uploads/")
      ? parsed.pathname
      : "";
    if (!uploadPath) return normalizedSource;
    return `${uploadPath}${parsed.search}${parsed.hash}`;
  } catch {
    return normalizedSource;
  }
};

const loadImageElement = (
  source: string,
  options?: { crossOrigin?: boolean },
): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }

    const image = new window.Image();
    if (options?.crossOrigin) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });

const imageToPngDataUrl = (image: HTMLImageElement): string => {
  if (typeof document === "undefined") return "";

  try {
    const maxWidth = 540;
    const maxHeight = 240;
    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const scale = Math.min(
      maxWidth / naturalWidth,
      maxHeight / naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
};

const resolvePdfLogoSource = async (source: string): Promise<string> => {
  const normalizedSource = source.trim();
  if (!normalizedSource) return "";
  if (normalizedSource.startsWith("data:")) return normalizedSource;

  const imageWithCors = await loadImageElement(normalizedSource, {
    crossOrigin: true,
  });
  if (imageWithCors) {
    const dataUrl = imageToPngDataUrl(imageWithCors);
    if (dataUrl) return dataUrl;
    return normalizedSource;
  }

  const imageWithoutCors = await loadImageElement(normalizedSource);
  if (imageWithoutCors) return normalizedSource;

  return "";
};

const formatUnitPrefix = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const abbreviated = raw.slice(0, 3).toUpperCase();
  return `${abbreviated}. `;
};

const composeProductDescription = (name: unknown, brand?: unknown): string => {
  const normalizedName = String(name ?? "").trim();
  const normalizedBrand = String(brand ?? "").trim();

  if (!normalizedName) return normalizedBrand || "Producto";
  if (!normalizedBrand) return normalizedName;

  const lowerName = normalizedName.toLowerCase();
  const lowerBrand = normalizedBrand.toLowerCase();
  if (lowerName.includes(lowerBrand)) return normalizedName;

  return `${normalizedName} ${normalizedBrand}`.trim();
};

const splitTicketDescriptionTwoLines = (
  value: string,
  topLineMaxChars = 36,
): [string, string] => {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return ["", ""];

  if (normalized.length <= topLineMaxChars) return [normalized, ""];

  const probe = normalized.slice(0, topLineMaxChars + 1);
  const lastSpace = probe.lastIndexOf(" ");
  const cutAt =
    lastSpace >= Math.floor(topLineMaxChars * 0.5)
      ? lastSpace
      : topLineMaxChars;
  const line1 = normalized.slice(0, cutAt).trim();
  const remaining = normalized.slice(cutAt).trim();
  return [line1, remaining];
};

const splitTicketPvs = (value: string) => {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(
    /\|\*\*\|\s*PV\s*:\s*([0-9.,]+)\s*\|\*\*\|\s*SV\s*:\s*([0-9.,]+)/i,
  );
  if (!match) return { description: normalized, pv: "", sv: "" };

  return {
    description: normalized.replace(match[0], "").trim(),
    pv: match[1] ?? "",
    sv: match[2] ?? "",
  };
};

const toFirstName = (value: unknown): string => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return "-";
  return normalized.split(" ")[0] ?? "-";
};

const UNITS = [
  "",
  "UNO",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
];

const TENS = [
  "",
  "DIEZ",
  "VEINTE",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];

const SPECIALS: Record<number, string> = {
  10: "DIEZ",
  11: "ONCE",
  12: "DOCE",
  13: "TRECE",
  14: "CATORCE",
  15: "QUINCE",
  20: "VEINTE",
};

const HUNDREDS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

const threeDigitsToWords = (n: number) => {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;

  const hundredPart = HUNDREDS[hundreds];
  const twoDigit = n % 100;

  if (SPECIALS[twoDigit]) {
    return [hundredPart, SPECIALS[twoDigit]].filter(Boolean).join(" ").trim();
  }

  const tensPart = TENS[tens];
  const unitPart = units === 1 && tens === 0 ? "UNO" : UNITS[units];

  if (!tensPart) {
    return [hundredPart, unitPart].filter(Boolean).join(" ").trim();
  }

  if (tens === 2 && units > 0) {
    return [hundredPart, `VEINTI${unitPart.toLowerCase()}`]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toUpperCase();
  }

  const tensUnits =
    units > 0 ? `${tensPart} Y ${unitPart}` : `${tensPart}`.trim();

  return [hundredPart, tensUnits].filter(Boolean).join(" ").trim();
};

const numberToWords = (amount: number, currencyLabel = "SOLES") => {
  if (Number.isNaN(amount)) return "";
  const value = Math.max(0, Math.floor(amount * 100)) / 100;
  const integerPart = Math.floor(value);
  const cents = Math.round((value - integerPart) * 100)
    .toString()
    .padStart(2, "0");

  if (integerPart === 0) {
    return `CERO CON ${cents}/100 ${currencyLabel}`;
  }

  const millions = Math.floor(integerPart / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const hundreds = integerPart % 1_000;

  const parts: string[] = [];
  if (millions > 0) {
    parts.push(
      millions === 1 ? "UN MILLON" : `${threeDigitsToWords(millions)} MILLONES`,
    );
  }
  if (thousands > 0) {
    parts.push(
      thousands === 1 ? "MIL" : `${threeDigitsToWords(thousands)} MIL`,
    );
  }
  if (hundreds > 0) {
    parts.push(threeDigitsToWords(hundreds));
  }

  const integerWords = parts.join(" ").trim();

  return `${integerWords} CON ${cents}/100 ${currencyLabel}`.toUpperCase();
};

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#fff",
    paddingTop: 2,
    paddingBottom: 2,
    // zona segura: algunos drivers térmicos recortan borde izquierdo
    paddingLeft: 11,
    paddingRight: 7,
    fontFamily: "Helvetica",
    fontSize: 10,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start", // ← AGREGAR ESTO
  },
  header: {
    marginBottom: 8,
    textAlign: "center",
    width: "100%",
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  logo: {
    width: 130,
    height: 70,
    alignSelf: "center",
    objectFit: "contain",
  },
  subtitle: {
    fontSize: 8,
    color: "#666",
    marginBottom: 10,
  },
  companyBox: {
    borderWidth: 1,
    borderColor: "#000",
    borderRadius: 3,
    padding: 6,
    marginBottom: 8,
    fontWeight: "bold",
    //  backgroundColor: "#fffbeb",
  },
  companyText: {
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 8,
    textAlign: "center",
  },
  ticketNumber: {
    fontSize: 12,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginVertical: 8,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 4,
    fontSize: 9,
    textTransform: "uppercase",
  },
  infoLabel: {
    width: "35%",
    fontWeight: "bold",
  },
  infoValue: {
    width: "65%",
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingBottom: 4,
    marginBottom: 6,
    marginTop: 8,
  },
  tableHeaderText: {
    fontSize: 9,
    fontWeight: "bold",
  },
  colCant: {
    width: "12%",
  },
  colDesc: {
    width: "40%",
  },
  colPUni: {
    width: "20%",
    textAlign: "right",
  },
  colImporte: {
    width: "22%",
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    marginBottom: 6,
    fontSize: 9,
    fontWeight: "bold",
  },
  tableItemRow: {
    marginTop: 2,
    marginBottom: 0,
    fontSize: 9,
    fontWeight: "bold",
  },
  tableItemQuantity: {
    fontSize: 9,
    fontWeight: "bold",
  },
  tableItemDescription: {
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "left",
  },
  tableItemDescriptionSecondRow: {
    width: "52%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "left",
  },
  tableItemDescriptionFull: {
    width: "88%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "left",
  },
  pvsRow: {
    flexDirection: "row",
    marginTop: 2,
    fontSize: 9,
    fontWeight: "bold",
  },
  pvsLabel: {
    width: "70%",
    textAlign: "left",
  },
  pvsAmount: {
    width: "30%",
    textAlign: "right",
  },
  tableItemMetaRow: {
    flexDirection: "row",
    marginTop: 3,
    fontSize: 9,
    fontWeight: "bold",
  },
  tableItemSeparator: {
    borderBottomWidth: 1,
    borderBottomColor: "#201e1e",
    marginTop: 6,
    marginBottom: 6,
  },
  additionalDetailSeparator: {
    borderTopWidth: 1,
    borderTopColor: "#000",
    marginTop: 2,
    marginBottom: 4,
  },
  itemsCount: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 6,
    marginBottom: 6,
  },
  summaryRow: {
    flexDirection: "row",
    marginBottom: 3,
    fontSize: 10,
    alignItems: "center",
  },
  summaryLabel: {
    width: "55%",
    fontWeight: "bold",
  },
  summaryCurrency: {
    width: "10%",
    textAlign: "center",
  },
  summaryAmount: {
    width: "35%",
    fontWeight: "bold",
    textAlign: "right",
  },
  summaryDivider: {
    borderTopWidth: 1,
    borderTopColor: "#201e1e",
    marginTop: 4,
    marginBottom: 6,
  },
  totalRow: {
    flexDirection: "row",
    marginTop: 6,
    paddingTop: 6,
    alignItems: "center",
  },
  totalLabel: {
    width: "52%",
    fontSize: 12,
    fontWeight: "bold",
  },
  totalCurrency: {
    width: "8%",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
    marginLeft: 18,
  },
  totalAmount: {
    width: "40%",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "right",
  },
  footer: {
    marginTop: 12,
    fontSize: 8,
    fontWeight: "bold",
    textAlign: "center",
    color: "#111",
  },
  footerText: {
    marginBottom: 3,
  },
  qrPlaceholder: {
    width: 80,
    height: 80,
    borderWidth: 2,
    borderColor: "#000",
    alignSelf: "center",
    marginTop: 10,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  qrText: {
    fontSize: 8,
  },
});
const TicketDocument = ({
  clientName,
  clientId,
  clientAddress,
  notaUsuario,
  docType = "boleta",
  documentTitle,
  paymentMethod,
  items,
  totals,
  documentNumber,
  noteId,
  companyName,
  companyRuc,
  companyAddress,
  companyDistrict,
  companyLogo,
  summary,
  preGeneratedQrBase64,
}: TicketDocumentProps) => {
  const [generatedQrBase64, setGeneratedQrBase64] = useState("");
  const [resolvedCompanyLogoSrc, setResolvedCompanyLogoSrc] = useState(() =>
    typeof window === "undefined"
      ? FALLBACK_LOGO_SRC
      : toAbsoluteLogoUrl(FALLBACK_LOGO_SRC),
  );
  const companyPhoneFromStorage = useMemo(
    () => readCompanyPhoneFromStorage(),
    [],
  );
  const companyLogoFromStorage = useMemo(
    () => readCompanyLogoFromStorage(),
    [],
  );

  useEffect(() => {
    let active = true;
    const resolveLogo = async () => {
      const hasExplicitLogoProp = companyLogo !== undefined;
      const logoFromProp =
        typeof companyLogo === "string" ? companyLogo.trim() : "";
      const rawLogo = hasExplicitLogoProp
        ? logoFromProp
        : companyLogoFromStorage.trim();
      const fallbackAbsolute = toAbsoluteLogoUrl(FALLBACK_LOGO_SRC);
      const normalizedLogo = toAbsoluteLogoUrl(rawLogo);
      const proxiedLogo = mapLogoToDevProxyUrl(normalizedLogo);
      const candidates = [proxiedLogo, normalizedLogo, fallbackAbsolute].filter(
        Boolean,
      );

      for (const candidate of candidates) {
        const resolvedCandidate = await resolvePdfLogoSource(candidate);
        if (!resolvedCandidate) continue;
        if (active) setResolvedCompanyLogoSrc(resolvedCandidate);
        return;
      }

      if (active) {
        setResolvedCompanyLogoSrc(fallbackAbsolute || FALLBACK_LOGO_SRC);
      }
    };
    void resolveLogo();

    return () => {
      active = false;
    };
  }, [companyLogo, companyLogoFromStorage]);

  const ticketData = useMemo(() => {
    const hasItems = Boolean(items?.length);
    const fallbackOperacionGravada = hasItems
      ? Number(totals?.subTotal ?? 0)
      : 10000;
    const fallbackSubtotal = hasItems ? Number(totals?.total ?? 0) : 100.0;
    const fallbackTotal = hasItems ? Number(totals?.total ?? 0) : 100.0;

    const operacionGravadaValue = Number(summary?.operacionGravada);
    const cardAdditionalValue = Number(summary?.cardAdditional);
    const cardPercentageValue = Number(summary?.cardPercentage);
    const movilidadValue = Number(summary?.movilidad);
    const descuentoValue = Number(summary?.descuento);
    const subtotalValue = Number(summary?.subtotal);
    const igvValue = Number(summary?.igv);
    const totalValue = Number(summary?.total);

    const safeOperacionGravada = Number.isFinite(operacionGravadaValue)
      ? Math.max(0, operacionGravadaValue)
      : fallbackOperacionGravada;
    const safeDescuento = Number.isFinite(descuentoValue)
      ? Math.max(0, descuentoValue)
      : 0;
    const safeCardAdditional = Number.isFinite(cardAdditionalValue)
      ? Math.max(0, cardAdditionalValue)
      : 0;
    const safeCardPercentage = Number.isFinite(cardPercentageValue)
      ? Math.max(0, cardPercentageValue)
      : 0;
    const safeMovilidad = Number.isFinite(movilidadValue)
      ? Math.max(0, movilidadValue)
      : 0;
    const showCardAdditional =
      Boolean(summary?.showCardAdditional) && safeCardAdditional > 0;
    const showMovement = safeMovilidad > 0;
    const showDiscount = Boolean(summary?.showDiscount) || safeDescuento > 0;
    const detailAdjustments =
      docType === "proforma"
        ? []
        : [showMovement ? "MV" : "", showCardAdditional ? "CT" : ""].filter(
            Boolean,
          );
    const detailAdjustmentAmount = safeMovilidad + safeCardAdditional;
    const safeSubtotal = Number.isFinite(subtotalValue)
      ? Math.max(0, subtotalValue)
      : fallbackSubtotal;
    const safeIgv = Number.isFinite(igvValue)
      ? Math.max(0, igvValue)
      : Math.max(0, safeSubtotal - safeOperacionGravada);
    const safeTotal = Number.isFinite(totalValue)
      ? Math.max(0, totalValue)
      : fallbackTotal;
    const docLabel = docType === "factura" ? "RUC" : "DNI";
    const clientDoc =
      clientId?.trim() || (docLabel === "RUC" ? "00000000000" : "00000000");
    const now = new Date();
    const emissionDate = now.toLocaleDateString("es-PE");
    const emissionDateTime = now.toLocaleString("es-PE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const emissionDateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const amountInWords = numberToWords(safeTotal, "SOLES");
    const normalizedNoteId = String(noteId ?? "").trim();
    const qrDocTypeCode =
      docType === "factura" ? "01" : docType === "boleta" ? "03" : "";
    const qrClientDocTypeCode = docType === "factura" ? "06" : "01";
    const qrData = qrDocTypeCode
      ? [
          companyRuc?.trim() || "20601070155",
          qrDocTypeCode,
          documentNumber || "-",
          safeIgv.toFixed(2),
          safeTotal.toFixed(2),
          emissionDateISO,
          qrClientDocTypeCode,
          clientDoc,
        ].join("|")
      : "";
    const docLabelForAuthorization =
      docType === "factura"
        ? "Factura"
        : docType === "boleta"
          ? "Boleta"
          : "Comprobante";

    return {
      isFactura: docType === "factura",
      isProforma: docType === "proforma",
      logo: resolvedCompanyLogoSrc || FALLBACK_LOGO_SRC,
      qrData,
      companyName: companyName?.trim() || "CONSORCIO FERRETERO ROSITA E.I.R.L.",
      ruc: companyRuc?.trim() || "20601070155",
      address: companyAddress?.trim() || "Calle 2 Mz B Lote 1",
      district: companyDistrict?.trim() || "LIMA",
      phones:
        companyPhoneFromStorage ||
        "Telef: 607-1883 / 943-296-081 / 944-284-915",
      documentType:
        docType === "factura"
          ? "FACTURA ELECTRONICA"
          : docType === "proforma"
            ? documentTitle?.trim() || "PROFORMA"
            : "BOLETA DE VENTA ELECTRONICA",
      documentNumber: documentNumber || "",
      emissionDate,
      emissionDateTime,
      currency: "SOLES",
      paymentMethod: paymentMethod ?? "AL CONTADO",
      clientName: clientName || "Ultimo cliente",
      clientAddress: clientAddress?.trim() || "-",
      clientDNI: clientDoc,
      clientDocLabel: docLabel,
      seller: toFirstName(notaUsuario),
      items: hasItems
        ? (items ?? []).map((item) => ({
            quantity: Number(item.cantidad ?? 0),
            description: composeProductDescription(
              item.nombre,
              item.productoMarca,
            ),
            unitMeasure: item.unidadMedida ?? "",
            unitPrice: Number(item.precio ?? 0),
            total: Number(item.precio ?? 0) * Number(item.cantidad ?? 0),
          }))
        : [
            {
              quantity: 10.0,
              description: "UNI CHAPA CLASICA 250 CANTOL",
              unitMeasure: "",
              unitPrice: 79.0,
              total: 790.0,
            },
          ],
      operacionGravada: safeOperacionGravada,
      cardAdditional: safeCardAdditional,
      cardPercentage: safeCardPercentage,
      showCardAdditional,
      movilidad: safeMovilidad,
      showMovement,
      descuento: safeDescuento,
      showDiscount,
      detailAdjustmentsLabel: "MV/CT/OT",
      detailAdjustmentAmount,
      showDetailAdjustments: detailAdjustments.length > 0,
      subtotal: safeSubtotal,
      igv: safeIgv,
      total: safeTotal,
      son: amountInWords,
      authorization:
        docType === "proforma"
          ? "Nota: No es comprobante de pago, canjear por Boleta o Factura"
          : `Autorizado mediante Resolución de Intendencia SUNAT 0180050003180. Representación impresa de la ${docLabelForAuthorization} Electrónica. Consulta tu comprobante en: https://www.nubefact.com/buscar`,
      id: normalizedNoteId || "396548",
    };
  }, [
    clientId,
    clientAddress,
    clientName,
    notaUsuario,
    docType,
    documentTitle,
    documentNumber,
    noteId,
    items,
    paymentMethod,
    totals,
    companyName,
    companyRuc,
    companyAddress,
    companyDistrict,
    companyPhoneFromStorage,
    resolvedCompanyLogoSrc,
    summary,
  ]);

  useEffect(() => {
    if (preGeneratedQrBase64) {
      return;
    }

    if (ticketData.qrData) {
      let active = true;
      generateTicketQrBase64(ticketData.qrData).then((url) => {
        if (active) setGeneratedQrBase64(url);
      });
      return () => {
        active = false;
      };
    }
  }, [preGeneratedQrBase64, ticketData.qrData]);

  const qrBase64 =
    preGeneratedQrBase64 || (ticketData.qrData ? generatedQrBase64 : "");
  const pageHeight = useMemo(() => {
    // Medidas calibradas píxel a píxel en puntos PDF (1pt ≈ 1px en react-pdf)
    const LOGO = 60 + 6; // height + marginBottom
    const HEADER_MB = 8; // marginBottom del View header

    const COMPANY_LINES = 5; // 5 Text dentro del companyBox
    const COMPANY_LINE_H = 8 + 2; // fontSize + marginBottom
    const COMPANY_PADDING = 6 * 2;
    const COMPANY_MB = 8;
    const company =
      COMPANY_LINES * COMPANY_LINE_H + COMPANY_PADDING + COMPANY_MB;

    const SECTION_TITLE = 10 + 10 + 8; // fontSize + marginTop + marginBottom
    const TICKET_NUMBER = 11 + 10; // fontSize + marginBottom
    const DIVIDER = 1 + 8 * 2; // border + marginVertical x2

    const INFO_ROWS = ticketData.isFactura ? 8 : 7;
    const INFO_ROW_H = 8 + 4; // fontSize + marginBottom
    const clientNameLines = Math.ceil(
      (ticketData.clientName?.length ?? 0) / 28,
    );
    const infoSection =
      (INFO_ROWS - 1) * INFO_ROW_H +
      (clientNameLines * 8 + 4) + // fila cliente con wrap
      DIVIDER;

    const TABLE_HEADER = 8 + 4 + 6 + 8 + 1; // row + margins + padding + separator

    const rowsHeight = ticketData.items.reduce((acc, item) => {
      const pvs = splitTicketPvs(String(item.description ?? ""));
      const fullDescription = `${formatUnitPrefix(item.unitMeasure)}${pvs.description}`;
      const [, descriptionLine2] =
        splitTicketDescriptionTwoLines(fullDescription);
      const firstRowHeight = 9;
      const secondRowLines = Math.max(
        1,
        Math.ceil((descriptionLine2.length || 1) / 34),
      );
      const secondRowHeight = secondRowLines * 9 + 3;
      const pvsHeight = pvs.pv || pvs.sv ? 22 : 0;
      const separatorHeight = 1 + 6 + 6;
      return (
        acc + firstRowHeight + secondRowHeight + pvsHeight + separatorHeight
      );
    }, 0);
    const detailAdjustmentsRowHeight = ticketData.showDetailAdjustments
      ? 8 + 6
      : 0;

    const ITEMS_COUNT = 8 + 6 + 6; // fontSize + marginTop + marginBottom
    const DIVIDER2 = 1 + 8 * 2;

    const summaryRows = ticketData.isProforma
      ? 10
      : 3 + (ticketData.igv > 0 ? 1 : 0) + (ticketData.showDiscount ? 1 : 0);
    const summaryRowsHeight =
      summaryRows * (9 + 3) + (ticketData.isProforma ? 16 : 0);

    const TOTAL_ROW = 12 + 6 + 6 + 1; // fontSize + marginTop + paddingTop + border

    const authTextLength = ticketData.authorization?.length ?? 0;
    const authLines = Math.ceil(authTextLength / 42); // ~42 chars por línea en fontSize 7
    const footerLines = 1 + authLines + 1; // SON + auth + ID
    const FOOTER = 12 + footerLines * (7 + 3);
    const QR = qrBase64 ? 80 + 10 : 0; // height + marginTop

    const PADDING = 2 + 2; // paddingTop + paddingBottom

    return (
      LOGO +
      HEADER_MB +
      company +
      SECTION_TITLE +
      TICKET_NUMBER +
      DIVIDER +
      infoSection +
      TABLE_HEADER +
      rowsHeight +
      detailAdjustmentsRowHeight +
      ITEMS_COUNT +
      DIVIDER2 +
      summaryRowsHeight +
      TOTAL_ROW +
      FOOTER +
      QR +
      PADDING +
      40 // buffer extra para evitar recortes con tipografía más grande
    );
  }, [ticketData, qrBase64]);
  return (
    <Document>
      <Page size={[TICKET_PAGE_WIDTH_PT, pageHeight]} style={styles.page}>
        <View wrap={false}>
          <View style={styles.header}>
            {ticketData.logo && (
              <Image src={ticketData.logo} style={styles.logo} />
            )}
          </View>
          <View style={styles.companyBox}>
            <Text style={[styles.companyText]}>{ticketData.companyName}</Text>
            <Text style={styles.companyText}>{ticketData.ruc}</Text>
            <Text style={[styles.companyText, { textTransform: "lowercase" }]}>
              {ticketData.address}
            </Text>
            <Text style={styles.companyText}>{ticketData.district}</Text>
            <Text style={styles.companyText}>{ticketData.phones}</Text>
          </View>
          <Text style={styles.sectionTitle}>{ticketData.documentType}</Text>
          <Text style={styles.ticketNumber}>{ticketData.documentNumber}</Text>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Fecha y hora</Text>
            <Text style={styles.infoValue}>
              : {ticketData.emissionDateTime}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Tipo Moneda</Text>
            <Text style={styles.infoValue}>: {ticketData.currency}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Forma Pago</Text>
            <Text style={styles.infoValue}>: {ticketData.paymentMethod}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Cliente</Text>
            <Text style={styles.infoValue}>: {ticketData.clientName}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{ticketData.clientDocLabel}</Text>
            <Text style={styles.infoValue}>: {ticketData.clientDNI}</Text>
          </View>

          {ticketData.isFactura && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>DIRECCION</Text>
              <Text style={styles.infoValue}>: {ticketData.clientAddress}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Vendedor</Text>
            <Text style={styles.infoValue}>: {ticketData.seller}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colCant]}>Cant.</Text>
            <Text style={[styles.tableHeaderText, styles.colDesc]}>
              Descripción
            </Text>
            <Text style={[styles.tableHeaderText, styles.colPUni]}>P.Uni</Text>
            <Text style={[styles.tableHeaderText, styles.colImporte]}>
              Importe
            </Text>
          </View>
          {ticketData.items.map((item, index) => (
            <View key={index}>
              {(() => {
                const pvs = splitTicketPvs(String(item.description ?? ""));
                const fullDescription = `${formatUnitPrefix(item.unitMeasure)}${pvs.description}`;
                const [descriptionLine1, descriptionLine2] =
                  splitTicketDescriptionTwoLines(fullDescription);
                return (
                  <View style={styles.tableItemRow}>
                    <View style={styles.tableItemMetaRow}>
                      <Text style={styles.colCant}>
                        {item.quantity.toFixed(2)}
                      </Text>
                      <Text style={styles.tableItemDescriptionFull}>
                        {descriptionLine1}
                      </Text>
                    </View>
                    <View style={styles.tableItemMetaRow}>
                      <Text style={styles.tableItemDescriptionSecondRow}>
                        {descriptionLine2}
                      </Text>
                      <Text style={styles.colPUni}>
                        {formatTicketMoney(item.unitPrice)}
                      </Text>
                      <Text style={styles.colImporte}>
                        {formatTicketMoney(item.total)}
                      </Text>
                    </View>
                    {(pvs.pv || pvs.sv) && (
                      <View>
                        {pvs.pv && (
                          <View style={styles.pvsRow}>
                            <Text style={styles.pvsLabel}>
                              PVS TOTAL DE VENTA -----&gt;
                            </Text>
                            <Text style={styles.pvsAmount}>{pvs.pv}</Text>
                          </View>
                        )}
                        {pvs.sv && (
                          <View style={styles.pvsRow}>
                            <Text style={styles.pvsLabel}>
                              PVS TOTAL DEL MES -----&gt;
                            </Text>
                            <Text style={styles.pvsAmount}>{pvs.sv}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })()}
              <View style={styles.tableItemSeparator} />
            </View>
          ))}
          {ticketData.showDetailAdjustments && (
            <View>
              <View style={styles.tableItemRow}>
                <Text style={styles.tableItemDescription}>
                  {ticketData.detailAdjustmentsLabel}
                </Text>
                <View style={styles.tableItemMetaRow}>
                  <Text style={styles.colCant}></Text>
                  <Text style={styles.colDesc}></Text>
                  <Text style={styles.colPUni}></Text>
                  <Text style={styles.colImporte}>
                    {formatTicketMoney(ticketData.detailAdjustmentAmount)}
                  </Text>
                </View>
              </View>
              <View style={styles.tableItemSeparator} />
            </View>
          )}
          <Text style={styles.itemsCount}>
            items: {ticketData.items.length}
          </Text>
          {ticketData.isProforma ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Sub Total S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.subtotal)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Movilidad S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.movilidad)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Descuento S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.descuento)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Op Gravada S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.total)}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Acuenta S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>0.00</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Saldo S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.total)}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Adic. {ticketData.cardPercentage.toFixed(1)}%:
                </Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.cardAdditional)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>ICBPER S/.</Text>
                <Text style={styles.summaryCurrency}></Text>
                <Text style={styles.summaryAmount}>0.00</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total A Pagar S/.</Text>
                <Text style={styles.totalCurrency}></Text>
                <Text style={styles.totalAmount}>
                  {formatTicketMoney(ticketData.total)}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>OP.GRAVADA :</Text>
                <Text style={styles.summaryCurrency}>S/</Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.operacionGravada)}
                </Text>
              </View>
              {ticketData.showDiscount && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>DESCUENTO :</Text>
                  <Text style={styles.summaryCurrency}>S/</Text>
                  <Text style={styles.summaryAmount}>
                    {formatTicketMoney(ticketData.descuento)}
                  </Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>SUBTOTAL :</Text>
                <Text style={styles.summaryCurrency}>S/</Text>
                <Text style={styles.summaryAmount}>
                  {formatTicketMoney(ticketData.subtotal)}
                </Text>
              </View>
              {ticketData.igv > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>I.G.V. :</Text>
                  <Text style={styles.summaryCurrency}>S/</Text>
                  <Text style={styles.summaryAmount}>
                    {formatTicketMoney(ticketData.igv)}
                  </Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>ICBPER :</Text>
                <Text style={styles.summaryCurrency}>S/</Text>
                <Text style={styles.summaryAmount}>0.00</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TOTAL :</Text>
                <Text style={styles.totalCurrency}>S/</Text>
                <Text style={styles.totalAmount}>
                  {formatTicketMoney(ticketData.total)}
                </Text>
              </View>
            </>
          )}
          <View style={styles.footer}>
            <Text style={styles.footerText}>SON: {ticketData.son}</Text>
            {ticketData.authorization ? (
              <Text style={styles.footerText}>{ticketData.authorization}</Text>
            ) : null}
            <Text style={styles.footerText}>ID: {ticketData.id}</Text>
          </View>
          <View>
            {qrBase64 && (
              <Image
                src={qrBase64}
                style={{
                  width: 80,
                  height: 80,
                  alignSelf: "center",
                  marginTop: 10,
                }}
              />
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default TicketDocument;
