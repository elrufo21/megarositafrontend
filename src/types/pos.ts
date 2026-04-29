export interface PosCartItem {
  productId: number;
  codigo: string;
  codigoSunat?: string;
  nombre: string;
  unidadMedida?: string;
  costo?: number;
  precio: number;
  precioMinimo?: number;
  cantidad: number;
  valorUM?: number;
  stock?: number;
  detalleId?: number;
}

export interface PosTotals {
  subTotal: number;
  total: number;
  itemCount: number;
}
