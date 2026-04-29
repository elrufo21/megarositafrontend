import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PosCartItem, PosTotals } from "@/types/pos";
import { generateTicketQrBase64 } from "@/components/ticketQr";

type TicketHTMLProps = {
  clientName?: string;
  clientId?: string;
  clientAddress?: string;
  docType?: "boleta" | "factura" | "proforma";
  paymentMethod?: string;
  items?: PosCartItem[];
  totals?: PosTotals;
  documentNumber?: string;
  noteId?: number | string | null;
  companyName?: string;
  companyRuc?: string;
  companyAddress?: string;
  companyDistrict?: string;
  summary?: {
    operacionGravada?: number;
    descuento?: number;
    showDiscount?: boolean;
    subtotal?: number;
    igv?: number;
    total?: number;
  };
  preGeneratedQrBase64?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTH_STORAGE_KEY = "sgo.auth.session";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalizePhoneLine = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lowerRaw = raw.toLowerCase();
  const telefIndex = lowerRaw.indexOf("telef:");
  if (telefIndex >= 0) return raw.slice(telefIndex).trim();
  const telIndex = lowerRaw.indexOf("tel:");
  if (telIndex >= 0) return raw.slice(telIndex).trim();
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

const formatUnitPrefix = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return `${raw.slice(0, 3).toUpperCase()}. `;
};

// ─── Number to words (Spanish) ───────────────────────────────────────────────

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

const threeDigitsToWords = (n: number): string => {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;
  const hundredPart = HUNDREDS[hundreds];
  const twoDigit = n % 100;
  if (SPECIALS[twoDigit])
    return [hundredPart, SPECIALS[twoDigit]].filter(Boolean).join(" ").trim();
  const tensPart = TENS[tens];
  const unitPart = units === 1 && tens === 0 ? "UNO" : UNITS[units];
  if (!tensPart)
    return [hundredPart, unitPart].filter(Boolean).join(" ").trim();
  if (tens === 2 && units > 0)
    return [hundredPart, `VEINTI${unitPart.toLowerCase()}`]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toUpperCase();
  const tensUnits = units > 0 ? `${tensPart} Y ${unitPart}` : tensPart.trim();
  return [hundredPart, tensUnits].filter(Boolean).join(" ").trim();
};

const numberToWords = (amount: number, currencyLabel = "SOLES"): string => {
  if (Number.isNaN(amount)) return "";
  const value = Math.max(0, Math.floor(amount * 100)) / 100;
  const integerPart = Math.floor(value);
  const cents = Math.round((value - integerPart) * 100)
    .toString()
    .padStart(2, "0");
  if (integerPart === 0) return `CERO CON ${cents}/100 ${currencyLabel}`;
  const millions = Math.floor(integerPart / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const hundreds = integerPart % 1_000;
  const parts: string[] = [];
  if (millions > 0)
    parts.push(
      millions === 1 ? "UN MILLON" : `${threeDigitsToWords(millions)} MILLONES`,
    );
  if (thousands > 0)
    parts.push(
      thousands === 1 ? "MIL" : `${threeDigitsToWords(thousands)} MIL`,
    );
  if (hundreds > 0) parts.push(threeDigitsToWords(hundreds));
  return `${parts.join(" ").trim()} CON ${cents}/100 ${currencyLabel}`.toUpperCase();
};

// ─── Print styles injected once ──────────────────────────────────────────────

const PRINT_STYLE_ID = "ticket-html-print-style";

const injectPrintStyles = () => {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
      }
      body {
        margin: 0 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body > * { display: none !important; }
      #ticket-html-print-root { display: block !important; }
      #ticket-html-print-root * { visibility: visible !important; }

      @page {
        size: 80mm auto;
        margin: 0 !important;
      }

      #ticket-html-print-root {
        position: fixed;
        top: -1.5mm;
        left: 0;
        width: 80mm !important;
        margin: 0 !important;
        padding: 0 3mm 2mm 3mm !important;
        background: white;
        color: black;
      }
    }
  `;
  document.head.appendChild(style);
};

// ─── Component ───────────────────────────────────────────────────────────────

const TicketHTML = ({
  clientName,
  clientId,
  clientAddress,
  docType = "boleta",
  paymentMethod,
  items,
  totals,
  documentNumber,
  noteId,
  companyName,
  companyRuc,
  companyAddress,
  companyDistrict,
  summary,
  preGeneratedQrBase64,
}: TicketHTMLProps) => {
  const [generatedQrBase64, setGeneratedQrBase64] = useState("");
  const companyPhoneFromStorage = useMemo(
    () => readCompanyPhoneFromStorage(),
    [],
  );

  // Inject print styles once on mount
  useEffect(() => {
    injectPrintStyles();
  }, []);

  const ticketData = useMemo(() => {
    const hasItems = Boolean(items?.length);
    const fallbackOperacionGravada = hasItems
      ? Number(totals?.subTotal ?? 0)
      : 10000;
    const fallbackSubtotal = hasItems ? Number(totals?.total ?? 0) : 100.0;
    const fallbackTotal = hasItems ? Number(totals?.total ?? 0) : 100.0;

    const operacionGravadaValue = Number(summary?.operacionGravada);
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
    const showDiscount = Boolean(summary?.showDiscount);
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
      logo: "/LogoManuel.png",
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
            ? "PROFORMA DE VENTA"
            : "BOLETA DE VENTA ELECTRONICA",
      documentNumber: documentNumber || "",
      emissionDate,
      currency: "SOLES",
      paymentMethod: paymentMethod ?? "AL CONTADO",
      clientName: clientName || "Ultimo cliente",
      clientAddress: clientAddress?.trim() || "-",
      clientDNI: clientDoc,
      clientDocLabel: docLabel,
      items: hasItems
        ? (items ?? []).map((item) => ({
            quantity: Number(item.cantidad ?? 0),
            description: item.nombre ?? "Producto",
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
      descuento: safeDescuento,
      showDiscount,
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
    docType,
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
    summary,
  ]);

  useEffect(() => {
    if (preGeneratedQrBase64) return;
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

  // ─── Inline styles (mirror react-pdf StyleSheet exactly) ─────────────────

  const s = {
    page: {
      backgroundColor: "#fff",
      paddingTop: 0,
      paddingBottom: 2,
      paddingLeft: 8,
      paddingRight: 8,
      // react-pdf no soporta fallback list tipo CSS; necesita una familia registrada/unica
      fontFamily: "Helvetica",
      fontSize: 9,
      color: "#000",
      width: "100%",
    } as React.CSSProperties,

    logo: {
      width: 60,
      height: 60,
      marginBottom: 6,
      objectFit: "contain" as const,
      display: "block",
      margin: "0 auto 6px",
    } as React.CSSProperties,

    header: {
      marginBottom: 8,
      textAlign: "center" as const,
      width: "100%",
    } as React.CSSProperties,

    companyBox: {
      border: "1px solid #000",
      borderRadius: 3,
      padding: 6,
      marginBottom: 8,
      fontWeight: "bold" as const,
    } as React.CSSProperties,

    companyText: {
      fontSize: 8,
      textAlign: "center" as const,
      marginBottom: 2,
      display: "block",
    } as React.CSSProperties,

    sectionTitle: {
      fontSize: 10,
      fontWeight: "bold" as const,
      marginTop: 10,
      marginBottom: 8,
      textAlign: "center" as const,
    } as React.CSSProperties,

    ticketNumber: {
      fontSize: 11,
      fontWeight: "bold" as const,
      textAlign: "center" as const,
      marginBottom: 10,
    } as React.CSSProperties,

    divider: {
      borderBottom: "1px solid #ddd",
      marginTop: 8,
      marginBottom: 8,
    } as React.CSSProperties,

    infoRow: {
      display: "flex" as const,
      marginBottom: 4,
      fontSize: 8,
      textTransform: "uppercase" as const,
    } as React.CSSProperties,

    infoLabel: {
      width: "35%",
      fontWeight: "bold" as const,
    } as React.CSSProperties,

    infoValue: {
      width: "65%",
    } as React.CSSProperties,

    // Table header row
    tableHeader: {
      display: "flex" as const,
      borderBottom: "1px solid #000",
      paddingBottom: 4,
      marginBottom: 6,
      marginTop: 8,
    } as React.CSSProperties,

    tableHeaderText: {
      fontSize: 8,
      fontWeight: "bold" as const,
    } as React.CSSProperties,

    // Table data row
    tableRow: {
      display: "flex" as const,
      marginBottom: 6,
      fontSize: 8,
    } as React.CSSProperties,

    colCant: { width: "14%" } as React.CSSProperties,
    colDesc: { width: "42%" } as React.CSSProperties,
    colPUni: {
      width: "20%",
      textAlign: "right" as const,
    } as React.CSSProperties,
    colImporte: {
      width: "18%",
      textAlign: "right" as const,
      paddingRight: 2,
    } as React.CSSProperties,

    itemsCount: {
      fontSize: 8,
      marginTop: 6,
      marginBottom: 6,
    } as React.CSSProperties,

    summaryRow: {
      display: "flex" as const,
      marginBottom: 3,
      fontSize: 9,
      alignItems: "center" as const,
    } as React.CSSProperties,

    summaryLabel: {
      width: "55%",
      fontWeight: "bold" as const,
    } as React.CSSProperties,
    summaryCurrency: {
      width: "10%",
      textAlign: "center" as const,
    } as React.CSSProperties,
    summaryAmount: {
      width: "35%",
      textAlign: "right" as const,
    } as React.CSSProperties,

    totalRow: {
      display: "flex" as const,
      marginTop: 6,
      paddingTop: 6,
      borderTop: "1px solid #000",
      alignItems: "center" as const,
    } as React.CSSProperties,

    totalLabel: {
      width: "55%",
      fontSize: 11,
      fontWeight: "bold" as const,
    } as React.CSSProperties,
    totalCurrency: {
      width: "10%",
      fontSize: 12,
      fontWeight: "bold" as const,
      textAlign: "center" as const,
    } as React.CSSProperties,
    totalAmount: {
      width: "35%",
      fontSize: 12,
      fontWeight: "bold" as const,
      textAlign: "right" as const,
    } as React.CSSProperties,

    footer: {
      marginTop: 12,
      fontSize: 7,
      textAlign: "center" as const,
      color: "#333",
    } as React.CSSProperties,

    footerText: {
      marginBottom: 3,
      display: "block",
    } as React.CSSProperties,

    qrImage: {
      width: 80,
      height: 80,
      display: "block",
      margin: "10px auto 0",
    } as React.CSSProperties,
  };

  return (
    <div id="ticket-html-print-root" style={s.page}>
      {/* ── HEADER / LOGO ── */}
      <div style={s.header}>
        {ticketData.logo && (
          <img src={ticketData.logo} alt="Logo" style={s.logo} />
        )}
      </div>

      {/* ── COMPANY BOX ── */}
      <div style={s.companyBox}>
        <span style={s.companyText}>{ticketData.companyName}</span>
        <span style={s.companyText}>{ticketData.ruc}</span>
        <span style={s.companyText}>{ticketData.address}</span>
        <span style={s.companyText}>{ticketData.district}</span>
        <span style={s.companyText}>{ticketData.phones}</span>
      </div>

      {/* ── DOC TYPE & NUMBER ── */}
      <div style={s.sectionTitle}>{ticketData.documentType}</div>
      <div style={s.ticketNumber}>{ticketData.documentNumber}</div>

      {/* ── DIVIDER ── */}
      <div style={s.divider} />

      {/* ── INFO ROWS ── */}
      <div style={s.infoRow}>
        <span style={s.infoLabel}>Fecha Emision</span>
        <span style={s.infoValue}>: {ticketData.emissionDate}</span>
      </div>
      <div style={s.infoRow}>
        <span style={s.infoLabel}>Tipo Moneda</span>
        <span style={s.infoValue}>: {ticketData.currency}</span>
      </div>
      <div style={s.infoRow}>
        <span style={s.infoLabel}>Forma Pago</span>
        <span style={s.infoValue}>: {ticketData.paymentMethod}</span>
      </div>
      <div style={s.infoRow}>
        <span style={s.infoLabel}>Cliente</span>
        <span style={s.infoValue}>: {ticketData.clientName}</span>
      </div>
      <div style={s.infoRow}>
        <span style={s.infoLabel}>{ticketData.clientDocLabel}</span>
        <span style={s.infoValue}>: {ticketData.clientDNI}</span>
      </div>
      {ticketData.isFactura && (
        <div style={s.infoRow}>
          <span style={s.infoLabel}>DIRECCION</span>
          <span style={s.infoValue}>: {ticketData.clientAddress}</span>
        </div>
      )}

      {/* ── DIVIDER ── */}
      <div style={s.divider} />

      {/* ── TABLE HEADER ── */}
      <div style={s.tableHeader}>
        <span style={{ ...s.tableHeaderText, ...s.colCant }}>Cant.</span>
        <span style={{ ...s.tableHeaderText, ...s.colDesc }}>Descripción</span>
        <span style={{ ...s.tableHeaderText, ...s.colPUni }}>P.Uni</span>
        <span style={{ ...s.tableHeaderText, ...s.colImporte }}>Importe</span>
      </div>

      {/* ── ITEMS ── */}
      {ticketData.items.map((item, index) => (
        <div key={index} style={s.tableRow}>
          <span style={s.colCant}>{item.quantity.toFixed(2)}</span>
          <span style={s.colDesc}>
            {`${formatUnitPrefix(item.unitMeasure)}${item.description}`}
          </span>
          <span style={s.colPUni}>{item.unitPrice.toFixed(2)}</span>
          <span style={s.colImporte}>{item.total.toFixed(2)}</span>
        </div>
      ))}

      <span style={s.itemsCount}>items: {ticketData.items.length}</span>

      {/* ── DIVIDER ── */}
      <div style={s.divider} />

      {/* ── SUMMARY (no para proforma) ── */}
      {!ticketData.isProforma && (
        <>
          <div style={s.summaryRow}>
            <span style={s.summaryLabel}>OP.GRAVADA :</span>
            <span style={s.summaryCurrency}>S/</span>
            <span style={s.summaryAmount}>
              {ticketData.operacionGravada.toFixed(2)}
            </span>
          </div>
          {ticketData.showDiscount && (
            <div style={s.summaryRow}>
              <span style={s.summaryLabel}>DESCUENTO :</span>
              <span style={s.summaryCurrency}>S/</span>
              <span style={s.summaryAmount}>
                {ticketData.descuento.toFixed(2)}
              </span>
            </div>
          )}
          <div style={s.summaryRow}>
            <span style={s.summaryLabel}>SUBTOTAL :</span>
            <span style={s.summaryCurrency}>S/</span>
            <span style={s.summaryAmount}>
              {ticketData.subtotal.toFixed(2)}
            </span>
          </div>
          <div style={s.summaryRow}>
            <span style={s.summaryLabel}>I.G.V. :</span>
            <span style={s.summaryCurrency}>S/</span>
            <span style={s.summaryAmount}>{ticketData.igv.toFixed(2)}</span>
          </div>
        </>
      )}

      {/* ── TOTAL ── */}
      <div style={s.totalRow}>
        <span style={s.totalLabel}>TOTAL :</span>
        <span style={s.totalCurrency}>S/</span>
        <span style={s.totalAmount}>{ticketData.total.toFixed(2)}</span>
      </div>

      {/* ── FOOTER ── */}
      <div style={s.footer}>
        <span style={s.footerText}>SON: {ticketData.son}</span>
        {ticketData.authorization && (
          <span style={s.footerText}>{ticketData.authorization}</span>
        )}
        <span style={s.footerText}>ID: {ticketData.id}</span>
      </div>

      {/* ── QR CODE ── */}
      {qrBase64 && <img src={qrBase64} alt="QR" style={s.qrImage} />}
    </div>
  );
};

// ─── Print helper ─────────────────────────────────────────────────────────────
// Llama a esto desde tu botón de imprimir:
//
//   import { printTicket } from "./TicketHTML";
//   <button onClick={printTicket}>Imprimir</button>
//
export const printTicket = () => window.print();

export default TicketHTML;
